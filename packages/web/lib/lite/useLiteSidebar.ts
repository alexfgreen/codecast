// The Lite sidebar's data, computed once per window and shared. The sidebar
// draws it, the next/previous session keys walk its order, and the palette
// lists its recents and projects, so all three see the same rows in the same
// order. One provider (components/lite/LiteSidebarModel) runs the hook below
// and hands the result down through context; the readers re-render when the
// model changes and nothing else does.
//
// Store reads follow the house rules: the placement comes from the one
// classifier (placeInboxRows via useMinePlacement), every subscription is a
// wake signature, and the clock is a shared coarse one.
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  getProjectName,
  isSub,
  ownTeamRowsSig,
  sessionUnreadMap,
  sessionUnreadWakeSig,
  sessionWorkState,
  sessionsWakeSig,
  useTrackedStore,
  type InboxSession,
} from "../../store/inboxStore";
import { makeCollectionSig } from "../../store/wakeSig";
import { useMinePlacement, useWaitingOnPerson } from "../../hooks/useNeedsInputCount";
import { useDecisionQueue } from "../../hooks/useDecisionQueue";
import { useCoarseNow } from "../../hooks/useCoarseNow";
import { liteTeammateSessionIds } from "../../hooks/useLiteFeeders";
import { waitingOnPerson } from "../decisionQueue";
import { sessionCardTitle } from "../sessionCard";
import { deviceDisplayName } from "@codecast/shared/contracts";
import type { Device } from "../../components/DeviceBadge";
import {
  LITE_SECTIONS,
  groupLiteProjects,
  groupLiteTeammates,
  liteMarkOf,
  liteNeedsYouCount,
  liteProjectOf,
  liteSidebarOrder,
  liteTeammateMarkOf,
  type LiteProjectGroup,
  type LiteRowFacts,
  type LiteTeammateGroup,
  type LiteTeammateRow,
} from "./sidebarModel";
import { readLitePref, writeLitePref } from "./liteLayout";

export type LiteSidebarModel = {
  /** The viewer's sessions by project, most recent project first. */
  projects: LiteProjectGroup[];
  /** Teammates' live sessions in the active team (empty on Personal). */
  teammates: LiteTeammateGroup[];
  /** Every session id the sidebar draws, top to bottom. */
  order: string[];
  /** The session the route has open, or null. */
  activeId: string | null;
  /** Things waiting on the viewer (asks, waiting sessions). */
  needsYouCount: number;
  /** The active workspace is a team. */
  onTeam: boolean;
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (projectKey: string) => void;
  showAll: ReadonlySet<string>;
  toggleShowAll: (projectKey: string) => void;
};

const EMPTY: LiteSidebarModel = {
  projects: [],
  teammates: [],
  order: [],
  activeId: null,
  needsYouCount: 0,
  onTeam: false,
  collapsed: new Set(),
  toggleCollapsed: () => {},
  showAll: new Set(),
  toggleShowAll: () => {},
};

export const LiteSidebarModelCtx = createContext<LiteSidebarModel>(EMPTY);

/** The shared sidebar model (an empty one outside the Lite shell). */
export function useLiteSidebarModel(): LiteSidebarModel {
  return useContext(LiteSidebarModelCtx);
}

// What a row's face reads that the structural signature leaves out: its
// title and where it lives. A rename or a move wakes the sidebar; a heartbeat
// does not (neither field moves on one).
const liteFaceSig = makeCollectionSig<InboxSession>(
  (r) => `${r.title ?? ""}|${r.title ? "" : r.last_user_message ?? ""}|${r.agent_type ?? ""}|${r.git_root ?? ""}|${r.project_path ?? ""}`,
);

// The machine roster's names, memoized by the roster's ref: a push that
// only moves a heartbeat (online, last_seen) changes no name.
const rosterNameMemo = new WeakMap<object, string>();
function rosterNamesSig(roster: readonly Device[] | null | undefined): string {
  if (!roster) return "";
  const hit = rosterNameMemo.get(roster);
  if (hit !== undefined) return hit;
  const sig = roster.map((d) => `${d.device_id}:${d.label}:${d.platform}:${d.is_remote ? 1 : 0}`).join("\x1f");
  rosterNameMemo.set(roster, sig);
  return sig;
}

const COLLAPSED_PREF = "collapsedProjects";

/** Compute the model. Run once per window, by the model's provider. */
export function useLiteSidebarData(activeId: string | null): LiteSidebarModel {
  const placed = useMinePlacement();
  const s = useTrackedStore([
    (st) => sessionsWakeSig(st.sessions),
    (st) => ownTeamRowsSig(st.sessions),
    (st) => liteFaceSig(st.sessions),
    (st) => sessionUnreadWakeSig(st),
    (st) => rosterNamesSig(st.machineRoster as Device[]),
    (st) => st.clientState.ui?.active_team_id,
    (st) => st.currentUser?._id,
    (st) => st.teamMembers.length,
  ]);
  // Ages and the time-driven verdicts (a stale "working" retiring) move with
  // the clock, not with a field: the shared 15s clock the inbox uses.
  const now = useCoarseNow(15_000);
  const activeTeamId = (s.clientState.ui?.active_team_id as string | undefined) ?? null;
  const meId = s.currentUser?._id ? String(s.currentUser._id) : null;

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(readLitePref<string[]>(COLLAPSED_PREF, [])));
  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeLitePref(COLLAPSED_PREF, [...next]);
      return next;
    });
  }, []);
  // "Show N more" is a glance, not a setting: it resets with the page.
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set());
  const toggleShowAll = useCallback((key: string) => {
    setShowAll((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const faceSig = liteFaceSig(s.sessions);
  const unreadSig = sessionUnreadWakeSig(s);
  const rosterSig = rosterNamesSig(s.machineRoster as Device[]);
  const rows = useMemo<LiteRowFacts[]>(() => {
    if (!placed) return [];
    const unread = sessionUnreadMap(s);
    const roster = (s.machineRoster ?? []) as Device[];
    // One machine says nothing a row needs to repeat.
    const machines = roster.length > 1;
    const out: LiteRowFacts[] = [];
    const seen = new Set<string>();
    const add = (row: InboxSession) => {
      if (seen.has(row._id) || isSub(row)) return;
      seen.add(row._id);
      const project = liteProjectOf(row, getProjectName);
      const device = machines && row.owner_device_id ? roster.find((d) => d.device_id === row.owner_device_id) : undefined;
      out.push({
        id: row._id,
        title: sessionCardTitle(row),
        projectKey: project.key,
        projectLabel: project.label,
        projectDetail: project.detail,
        activityAt: row.updated_at || 0,
        mark: liteMarkOf(placed.placements.get(row._id), !!unread[row._id]),
        machine: device ? deviceDisplayName(device) : null,
      });
    };
    for (const section of LITE_SECTIONS) for (const row of placed[section]) add(row);
    // The session open stays in the list even when it was set aside, so the
    // sidebar never loses the row the person is looking at.
    if (activeId && !seen.has(activeId)) {
      const shelved = [...placed.stashed, ...placed.snoozed, ...placed.dismissed].find((r) => r._id === activeId);
      if (shelved) add(shelved);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, faceSig, unreadSig, rosterSig, activeId, now]);

  const projects = useMemo(() => groupLiteProjects(rows, { showAll, activeId }), [rows, showAll, activeId]);

  const teamSig = ownTeamRowsSig(s.sessions);
  const wakeSig = sessionsWakeSig(s.sessions);
  const teammates = useMemo<LiteTeammateGroup[]>(() => {
    if (!activeTeamId) return [];
    const members = (s.teamMembers ?? []) as Array<{ _id?: unknown; name?: string; image?: string; github_avatar_url?: string }>;
    const memberOf = (id: string) => members.find((m) => String(m._id) === id);
    const out: LiteTeammateRow[] = [];
    for (const id of liteTeammateSessionIds(s, activeTeamId, meId)) {
      const row = s.sessions[id];
      if (!row) continue;
      const mark = liteTeammateMarkOf(sessionWorkState(row, now));
      if (!mark) continue;
      // The person it belongs to: its owner when it was handed on, else its author.
      const ownerId = String(row.owner_user_id || row.user_id || "");
      if (!ownerId) continue;
      const member = memberOf(ownerId);
      const authored = ownerId === String(row.user_id ?? "");
      out.push({
        id,
        title: sessionCardTitle(row),
        mark,
        activityAt: row.updated_at || 0,
        ownerId,
        ownerName: member?.name || (authored ? row.author_name : null) || "Teammate",
        ownerImage: member?.image || member?.github_avatar_url || (authored ? row.author_avatar : null) || null,
      });
    }
    return groupLiteTeammates(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId, meId, teamSig, wakeSig, faceSig, s.teamMembers.length, now]);

  const order = useMemo(
    () => liteSidebarOrder(projects, collapsed, activeId, teammates.flatMap((g) => g.rows.map((r) => r.id))),
    [projects, collapsed, activeId, teammates],
  );

  const asks = waitingOnPerson(useDecisionQueue());
  const waiting = useWaitingOnPerson();
  const needsYouCount = liteNeedsYouCount(asks, waiting);

  return useMemo(
    () => ({ projects, teammates, order, activeId, needsYouCount, onTeam: !!activeTeamId, collapsed, toggleCollapsed, showAll, toggleShowAll }),
    [projects, teammates, order, activeId, needsYouCount, activeTeamId, collapsed, toggleCollapsed, showAll, toggleShowAll],
  );
}
