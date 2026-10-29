import { useCallback, useRef } from "react";
import { useQueryNoThrow } from "./useQueryNoThrow";
import { useConvex } from "convex/react";
import { api } from "@codecast/convex/convex/_generated/api";
import { Id } from "@codecast/convex/convex/_generated/dataModel";
import { useInboxStore, InboxSession, isConvexId } from "../store/inboxStore";
import { useConvexSync } from "./useConvexSync";
import { INBOX_RECOVERY_STALE_MS, useRecoveryPoll } from "./useRecoveryPoll";
import { queryWithSignal } from "../lib/queryWithSignal";
import { warmVisibleSessions } from "./inboxWarm";

import { useWatchEffect } from "./useWatchEffect";
// Record the team-mode active id set, change-guarded so an identical payload
// doesn't allocate a new Set and re-render every subscriber. The panel gates the
// visible list on this while inbox_scope is "team" (see filterInboxScope). Mirror
// of applyLiveInboxIds for the team board — including the persistence rule: the
// write goes through the sync() action (never raw setState) so the team-keyed
// IDB snapshot stays current and the next boot's first frame can seed from it.
export function applyTeamInboxIds(sessions: any[], teamId: string | null) {
  const ids = sessions.map((x: any) => x._id.toString());
  const next = new Set<string>(ids);
  const prev = useInboxStore.getState().teamInboxIds;
  if (prev.size === next.size && ids.every((id) => prev.has(id))) return;
  useInboxStore.getState().setTeamInboxIds(ids, teamId);
}

// The feeds that keep teamInboxIds current: the team board's (in team scope)
// and Codecast Lite's (while a Lite window is open, whatever the scope). Each
// holds the set while it runs. When the last one stops, the set clears, so
// nothing reads a team membership no subscription keeps fresh: the fleet
// counts team rows whenever the set is non-empty (fleetCountedSessions). The
// rows themselves stay in the never-prune cache either way.
const teamInboxIdHolders = new Set<string>();

export function useHoldTeamInboxIds(holder: string, active: boolean): void {
  useWatchEffect(() => {
    if (active) {
      teamInboxIdHolders.add(holder);
      return () => { teamInboxIdHolders.delete(holder); };
    }
    if (teamInboxIdHolders.size > 0) return;
    if (useInboxStore.getState().teamInboxIds.size === 0) return;
    useInboxStore.setState({ teamInboxIds: new Set<string>() });
  }, [holder, active]);
}

// One listTeamInboxSessions payload into the store: the rows through the same
// never-prune syncTable as the personal inbox, then the team's active id set.
// The subscription, the recovery probe and the simulator's host apply through
// it. False when the payload held no row list.
export function applyTeamListPayload(data: any, teamId: string | null): boolean {
  const sessions = data?.sessions ?? [];
  if (!Array.isArray(sessions)) return false;
  useInboxStore.getState().syncTable("sessions", sessions as unknown as InboxSession[]);
  applyTeamInboxIds(sessions, teamId);
  return true;
}

// The team list's args, shared by the subscription and the recovery probe.
export function teamInboxArgs(teamId: string | undefined) {
  return { activeTeamId: teamId as Id<"teams"> | undefined, include_liveness: false, fast_fields_in_overlay: true };
}

// Facts merge onto rows; stamps + the projection envelope land in the TEAM
// slot of sessionsProjection, keyed by team id, so the personal overlay and
// the team overlay never write the same slot (sync-convergence C1). Team
// stamps ship but are not compared (the replica lacks team visibility
// inputs); they exist for freshness scheduling. False when the payload held
// no liveness map and nothing was applied.
export function applyTeamLivenessPayload(teamId: string | undefined, data: any): boolean {
  const liveness = data?.liveness ?? data;
  if (!liveness || typeof liveness !== "object") return false;
  useInboxStore.getState().applyInboxLivenessPayload(`team:${teamId ?? ""}`, data);
  return true;
}

/**
 * One team's list and its liveness overlay: the two live subscriptions and
 * their recovery probes. The team board (useSyncTeamInboxSessions, per scope)
 * and Codecast Lite's teammates (hooks/useLiteTeammateSessions) both mount it,
 * so the args, the overlay's slot and the recovery rules exist once.
 * `applyList` is what the mounter does with a list payload (false when it held
 * no rows); the overlay always lands in the team's projection slot.
 */
export function useTeamSessionsFeed(teamId: string | undefined, active: boolean, applyList: (data: any) => boolean) {
  const convex = useConvex();
  const teamArgs = active ? teamInboxArgs(teamId) : "skip";

  const teamSessions = useQueryNoThrow(api.conversations.listTeamInboxSessions, teamArgs as any).data;
  const teamLiveness = useQueryNoThrow(
    api.conversations.teamSessionsLiveness,
    active ? { activeTeamId: teamId as Id<"teams"> | undefined } : "skip",
  ).data;

  const lastSyncRef = useRef(Date.now());
  const lastLivenessRef = useRef(Date.now());

  useConvexSync(teamSessions, useCallback((data: any) => {
    if (!applyList(data)) return;
    lastSyncRef.current = Date.now();
  }, [applyList]), { coalesceMs: 300 });

  // Liveness overlay into the team projection slot (applyTeamLivenessPayload).
  useConvexSync(teamLiveness, useCallback((data: any) => {
    if (!applyTeamLivenessPayload(teamId, data)) return;
    lastLivenessRef.current = Date.now();
  }, [teamId]), { coalesceMs: 300 });

  // Recovery: a Convex subscription can silently stall after sleep/reconnect. When
  // the feed is active, probe a novel-token round-trip to re-sync the list
  // (same pattern as the personal inbox recovery poll). The `_probe` arg dodges
  // the stalled live cache. No-op while inactive.
  useRecoveryPoll(lastSyncRef, useCallback(async (signal: AbortSignal) => {
    if (!active) return;
    const fresh: any = await queryWithSignal(convex, api.conversations.listTeamInboxSessions, {
      ...teamInboxArgs(teamId),
      _probe: Date.now(),
    }, signal);
    if (signal.aborted) return;
    if (!applyList(fresh)) return;
    lastSyncRef.current = Date.now();
  }, [convex, active, teamId, applyList]), INBOX_RECOVERY_STALE_MS);

  useRecoveryPoll(lastLivenessRef, useCallback(async (signal: AbortSignal) => {
    if (!active) return;
    const fresh: any = await queryWithSignal(convex, api.conversations.teamSessionsLiveness, {
      activeTeamId: teamId as Id<"teams"> | undefined,
      _probe: Date.now(),
    }, signal);
    if (signal.aborted) return;
    const liveness = fresh?.liveness;
    if (!liveness) return;
    // Same applier as the subscription: a recovery pass must not fork shapes.
    if (!applyTeamLivenessPayload(teamId, fresh)) return;
    lastLivenessRef.current = Date.now();
  }, [convex, active, teamId]), INBOX_RECOVERY_STALE_MS);

  return teamSessions;
}

/**
 * Inbox "team mode" sync. When the user's scope is "team", subscribe to the
 * team-scoped inbox (every team-visible session across the active team) and
 * merge those rows into the SAME never-prune `sessions` cache the personal inbox
 * uses — they're schema-identical (both come from enrichInboxSessionRow), so the
 * card, bucketing, and sort all just work. The reported id set becomes
 * `teamInboxIds`, the active set the panel gates on in team scope.
 *
 * Mirrors the personal inbox's liveness split: the list subscription opts out of
 * heartbeat-derived liveness (include_liveness:false) and a tiny
 * teamSessionsLiveness overlay carries the per-second live status, so team mode
 * is as heartbeat-cheap as the personal inbox.
 *
 * All subscriptions pass "skip" when scope isn't "team", so nothing runs (and no
 * team rows are fetched) until the user actually opens the team board.
 */
export function useSyncTeamInboxSessions() {
  const convex = useConvex();
  const scope = useInboxStore((s) => s.clientState.ui?.inbox_scope ?? "mine");
  const activeTeamId = useInboxStore((s) => s.clientState.ui?.active_team_id);
  // A freshly created team holds an optimistic stub id until the server
  // echoes; a stub is not an Id<"teams">, so skip rather than throw.
  const active = scope === "team" && (!activeTeamId || isConvexId(String(activeTeamId)));

  const teamSessions = useTeamSessionsFeed(activeTeamId, active, useCallback((data: any) => {
    if (!applyTeamListPayload(data, (activeTeamId as string | undefined) ?? null)) return false;
    // Team rows warm through the same rendered-order loop as the personal
    // inbox — the board's cards are the rows on screen in team scope.
    warmVisibleSessions(convex);
    return true;
  }, [activeTeamId, convex]));

  // Leaving team mode clears the active set unless Codecast Lite's feed still
  // keeps it (useHoldTeamInboxIds; the teammate rows stay in the never-prune
  // cache, and the "mine" scope filter is what hides them). Hygiene, not
  // correctness for the board — filterInboxScope only reads teamInboxIds in
  // team scope — but it keeps the set honest so a later switch back to team
  // can't briefly render another team's stale membership after an active-team
  // change.
  useHoldTeamInboxIds("board", active);

  return teamSessions;
}
