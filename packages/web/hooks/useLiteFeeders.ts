import { useCallback } from "react";
import { api } from "@codecast/convex/convex/_generated/api";
import { useInboxStore, isForeignRow, isSub, type InboxSession } from "../store/inboxStore";
import { useIsSyncHost } from "./useSyncRole";
import { useSyncTeams } from "./useSyncTeams";
import { useSyncTeamMembers } from "./useSyncTeamMembers";
import { useSyncDevices } from "./useSyncDevices";
import { useQueryNoThrow } from "./useQueryNoThrow";
import { useConvexSync } from "./useConvexSync";
import { useLitePresenceLock } from "./useLiteTeammateSessions";

/**
 * What Codecast Lite needs fed beyond DashboardSyncEffects. The classic shell
 * gets these from its chrome (the sidebar's teams, the header's roster pump
 * and bell, the device badges); Lite mounts none of that chrome. The teams,
 * the active team's roster, this account's machines and the notification list
 * are global feeds, so only the sync host runs them, and a follower reads
 * what the host replicates. Teammates' sessions are the host's to feed too
 * (useSyncLiteTeamSessions in HostFeeders), whichever shell the host is: this
 * hook only says Lite is open, by holding its lock.
 */
export function useLiteFeeders(): void {
  const isSyncHost = useIsSyncHost();
  const activeTeamId = useInboxStore((s) => s.clientState.ui?.active_team_id) as string | undefined;
  useLitePresenceLock();
  // Host-gated inside: teamHasFeature reads it, so chat and calls need it.
  useSyncTeams();
  // useSyncTeamMembers skips a team's optimistic stub id itself.
  useSyncTeamMembers(isSyncHost ? activeTeamId : null);
  useSyncDevices(isSyncHost);
  // The notification list (the newest 50 of every kind): Needs you's
  // mentions and replies. The collection registers no feed, as the bell's
  // own subscription shows; the bell and the desktop banner share it.
  const notifications = useQueryNoThrow(api.notifications.list, isSyncHost ? {} : "skip").data;
  useConvexSync(notifications, useCallback((d: any) => useInboxStore.getState().syncTable("notifications", d), []));
}

let teammatesCache: {
  sessions: Record<string, InboxSession>;
  teamId: string;
  meId: string;
  ids: string[];
} | null = null;

/**
 * Codecast Lite's teammates' sessions in the active team, newest first. A row
 * is one when it routes to that team (team_id), is not the viewer's own
 * (isForeignRow, the inbox scope's own rule: an owned seat is mine, a session
 * handed to someone else is theirs) and is top level (no subagent or
 * agent-spawned child, which nest under their parent). Read off the rows
 * themselves, so the fact has one home; classify the result with
 * placeInboxRows / sessionWorkState like any other surface. The same array
 * comes back while the sessions map, team and viewer are unchanged.
 */
export function liteTeammateSessionIds(
  state: { sessions: Record<string, InboxSession> },
  activeTeamId: string | null | undefined,
  meId: string | null | undefined,
): string[] {
  if (!activeTeamId || !meId) return [];
  const teamId = String(activeTeamId);
  const hit = teammatesCache;
  if (hit && hit.sessions === state.sessions && hit.teamId === teamId && hit.meId === meId) return hit.ids;
  const rows: InboxSession[] = [];
  for (const row of Object.values(state.sessions)) {
    if (!row || String(row.team_id ?? "") !== teamId) continue;
    if (!isForeignRow(row, meId) || isSub(row)) continue;
    rows.push(row);
  }
  rows.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
  const ids = rows.map((row) => String(row._id));
  teammatesCache = { sessions: state.sessions, teamId, meId, ids };
  return ids;
}
