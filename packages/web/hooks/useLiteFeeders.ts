import { api } from "@codecast/convex/convex/_generated/api";
import { useInboxStore, isForeignRow, isSub, type InboxSession } from "../store/inboxStore";
import { useSyncTeamMembers } from "./useSyncTeamMembers";
import { useSyncDevices } from "./useSyncDevices";
import { useSyncCollection } from "./useSyncCollection";
import { useServerAuthSettled } from "./useServerAuthSettled";
import { useLiteOpenAnywhere, useLitePresenceLock, useSyncLiteTeamSessions } from "./useLiteTeammateSessions";

/**
 * Mounted by the Lite shell. Lite reads what the classic shell's chrome feeds
 * (the header's roster pump and bell, the device badges) and mounts none of
 * that chrome, and those are global feeds, which only the sync host runs. The
 * host is often a classic window, and one without that header (/welcome, a
 * settings flow page) feeds none of them. So this hook only says Lite is open,
 * by holding its lock, and the host feeds what Lite reads while any window
 * holds one (useSyncLiteFeeds), whichever shell the host is, this window
 * included when it is the host itself.
 */
export function useLiteFeeders(): void {
  useLitePresenceLock();
}

/**
 * The sync host's feeds for Codecast Lite, mounted in HostFeeders: while any
 * window of this account has Lite open, the active team's roster, this
 * account's machines, the notification list (Needs you's mentions and
 * replies) and the team's sessions. A classic host's own header may feed the
 * first three too; Convex shares an identical subscription within a window,
 * and the store applies an unchanged answer as a no-op.
 */
export function useSyncLiteFeeds(): void {
  const liteOpen = useLiteOpenAnywhere();
  const activeTeamId = useInboxStore((s) => s.clientState.ui?.active_team_id) as string | undefined;
  // Both lists answer an anonymous caller with `[]`, which would wipe the
  // cached roster and notifications while the server confirms sign-in
  // (useServerAuthSettled). useSyncCollection holds its own until then.
  const authSettled = useServerAuthSettled();
  // useSyncTeamMembers skips a team's optimistic stub id itself.
  useSyncTeamMembers(liteOpen ? activeTeamId : null);
  useSyncDevices(liteOpen && authSettled);
  // The newest 50 of every kind; the collection is a snapshot of them.
  useSyncCollection("notifications", api.notifications.list, liteOpen ? {} : "skip");
  useSyncLiteTeamSessions(liteOpen);
}

type TeammateState = {
  sessions: Record<string, InboxSession>;
  teamInboxIds?: ReadonlySet<string>;
  teamInboxIdSnapshot?: { team_id: string | null } | null;
};

let teammatesCache: {
  sessions: Record<string, InboxSession>;
  members: ReadonlySet<string> | null;
  teamId: string;
  meId: string;
  ids: string[];
} | null = null;

/**
 * Codecast Lite's teammates' sessions in the active team, newest first. A row
 * is one when the server's team list holds it now (teamInboxIds, while that
 * set is the active team's), routes to that team (team_id), is not the
 * viewer's own (isForeignRow, the inbox scope's own rule: an owned seat is
 * mine, a session handed to someone else is theirs) and is top level (no
 * subagent or agent-spawned child, which nest under their parent). The set is
 * the one home of membership: the sessions cache never drops a row, so a
 * session a teammate made private or moved keeps its old team_id there. Until
 * the team's first list lands, the rows' own team_id stands in, as the board
 * falls back before its first payload. Classify the result with
 * placeInboxRows / sessionWorkState like any other surface. The same array
 * comes back while the sessions map, the set, team and viewer are unchanged.
 */
export function liteTeammateSessionIds(
  state: TeammateState,
  activeTeamId: string | null | undefined,
  meId: string | null | undefined,
): string[] {
  if (!activeTeamId || !meId) return [];
  const teamId = String(activeTeamId);
  const set = state.teamInboxIds;
  const members = set && set.size > 0 && String(state.teamInboxIdSnapshot?.team_id ?? "") === teamId ? set : null;
  const hit = teammatesCache;
  if (hit && hit.sessions === state.sessions && hit.members === members && hit.teamId === teamId && hit.meId === meId) return hit.ids;
  const rows: InboxSession[] = [];
  for (const row of Object.values(state.sessions)) {
    if (!row || String(row.team_id ?? "") !== teamId) continue;
    if (members && !members.has(String(row._id))) continue;
    if (!isForeignRow(row, meId) || isSub(row)) continue;
    rows.push(row);
  }
  rows.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
  const ids = rows.map((row) => String(row._id));
  teammatesCache = { sessions: state.sessions, members, teamId, meId, ids };
  return ids;
}
