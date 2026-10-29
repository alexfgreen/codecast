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
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
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
import { deviceDisplayName, inboxSortTimeOfRow } from "@codecast/shared/contracts";
import type { Device } from "../../components/DeviceBadge";
import {
  LITE_SECTIONS,
  groupLiteProjects,
  groupLiteTeammates,
  liteMarkOf,
  liteNeedsYouItems,
  liteProjectOf,
  liteSidebarOrder,
  liteTeammateMarkOf,
  type LiteNeedsItem,
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
  /** Everything waiting on the viewer (asks first, then waiting sessions),
   *  as Needs you lists it. */
  needsYou: LiteNeedsRow[];
  /** needsYou's length: the number and the list never disagree. */
  needsYouCount: number;
  /** The active workspace is a team. */
  onTeam: boolean;
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (projectKey: string) => void;
  showAll: ReadonlySet<string>;
  toggleShowAll: (projectKey: string) => void;
};

/** One Needs you row: the ask's question when it is one, else the session's
 *  title, and the session it opens. */
export type LiteNeedsRow = LiteNeedsItem & { title: string; sessionTitle: string; activityAt: number };

const EMPTY: LiteSidebarModel = {
  projects: [],
  teammates: [],
  order: [],
  activeId: null,
  needsYou: [],
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

// The machine roster's names, as a short digest memoized by the roster's
// ref: a push that only moves a heartbeat (online, last_seen) changes no
// name, and a subscription never compares a long string.
const rosterNameMemo = new WeakMap<object, string>();
function rosterNamesSig(roster: readonly Device[] | null | undefined): string {
  if (!roster) return "";
  const hit = rosterNameMemo.get(roster);
  if (hit !== undefined) return hit;
  let h = 0x811c9dc5;
  for (const d of roster) {
    const part = `${d.device_id}:${d.label}:${d.platform}:${d.is_remote ? 1 : 0}\x1f`;
    for (let i = 0; i < part.length; i++) h = Math.imul(h ^ part.charCodeAt(i), 0x01000193);
  }
  const sig = `${roster.length}:${(h >>> 0).toString(36)}`;
  rosterNameMemo.set(roster, sig);
  return sig;
}

// The team roster's faces, the same way: what a teammate row reads (id, name,
// photo), so a rename or a same-sized roster from another team re-renders,
// and a presence heartbeat on the roster does not.
const membersMemo = new WeakMap<object, string>();
type RosterMember = { _id?: unknown; name?: string; image?: string; github_avatar_url?: string };
function teamMembersSig(members: readonly RosterMember[] | null | undefined): string {
  if (!members) return "";
  const hit = membersMemo.get(members);
  if (hit !== undefined) return hit;
  let h = 0x811c9dc5;
  for (const m of members) {
    const part = `${String(m?._id ?? "")}:${m?.name ?? ""}:${m?.image ?? ""}:${m?.github_avatar_url ?? ""}\x1f`;
    for (let i = 0; i < part.length; i++) h = Math.imul(h ^ part.charCodeAt(i), 0x01000193);
  }
  const sig = `${members.length}:${(h >>> 0).toString(36)}`;
  membersMemo.set(members, sig);
  return sig;
}

const COLLAPSED_PREF = "collapsedProjects";

// The sections whose name is the row's state; any other (pinned, new, a
// set-aside row) reads the row's own.
const SECTION_SAYS_STATE = new Set<string>(["questions", "needsInput", "working", "done", "dormant"]);

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
    (st) => teamMembersSig(st.teamMembers as RosterMember[]),
    // The server's current team list: who is a teammate now
    // (liteTeammateSessionIds).
    (st) => st.teamInboxIds,
    (st) => st.teamInboxIdSnapshot?.team_id,
  ]);
  // Ages and the time-driven verdicts (a stale "working" retiring) move with
  // the clock, not with a field: the shared 15s clock the inbox uses.
  const now = useCoarseNow(15_000);
  const activeTeamId = (s.clientState.ui?.active_team_id as string | undefined) ?? null;
  const meId = s.currentUser?._id ? String(s.currentUser._id) : null;

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    const saved = readLitePref<unknown>(COLLAPSED_PREF, []);
    return new Set(Array.isArray(saved) ? saved.filter((k): k is string => typeof k === "string") : []);
  });
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
    const add = (row: InboxSession, section: string) => {
      if (seen.has(row._id) || isSub(row)) return;
      seen.add(row._id);
      const project = liteProjectOf(row, getProjectName);
      const workState = sessionWorkState(row, now);
      const device = machines && row.owner_device_id ? roster.find((d) => d.device_id === row.owner_device_id) : undefined;
      out.push({
        id: row._id,
        title: sessionCardTitle(row),
        projectKey: project.key,
        projectLabel: project.label,
        projectDetail: project.detail,
        activityAt: row.updated_at || 0,
        sortAt: inboxSortTimeOfRow(row, workState, now).at || row.updated_at || 0,
        mark: liteMarkOf(section, SECTION_SAYS_STATE.has(section) ? null : workState, !!unread[row._id]),
        machine: device ? deviceDisplayName(device) : null,
      });
    };
    for (const section of LITE_SECTIONS) for (const row of placed[section]) add(row, section);
    // The session open stays in the list even when it was set aside, so the
    // sidebar never loses the row the person is looking at.
    if (activeId && !seen.has(activeId)) {
      const shelved = [...placed.stashed, ...placed.snoozed, ...placed.dismissed].find((r) => r._id === activeId);
      if (shelved) add(shelved, "shelved");
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, faceSig, unreadSig, rosterSig, activeId, now]);

  const projects = useMemo(() => groupLiteProjects(rows, { showAll, activeId }), [rows, showAll, activeId]);

  const teamSig = ownTeamRowsSig(s.sessions);
  const wakeSig = sessionsWakeSig(s.sessions);
  const membersSig = teamMembersSig(s.teamMembers as RosterMember[]);
  const teammates = useMemo<LiteTeammateGroup[]>(() => {
    if (!activeTeamId) return [];
    const members = (s.teamMembers ?? []) as RosterMember[];
    const memberOf = (id: string) => members.find((m) => String(m._id) === id);
    const out: LiteTeammateRow[] = [];
    for (const id of liteTeammateSessionIds(s, activeTeamId, meId)) {
      const row = s.sessions[id];
      if (!row) continue;
      const workState = sessionWorkState(row, now);
      const mark = liteTeammateMarkOf(workState);
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
        sortAt: inboxSortTimeOfRow(row, workState, now).at || row.updated_at || 0,
        ownerId,
        ownerName: member?.name || (authored ? row.author_name : null) || "Teammate",
        ownerImage: member?.image || member?.github_avatar_url || (authored ? row.author_avatar : null) || null,
      });
    }
    return groupLiteTeammates(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId, meId, teamSig, wakeSig, faceSig, membersSig, s.teamInboxIds, s.teamInboxIdSnapshot?.team_id, now]);

  const order = useMemo(
    () => liteSidebarOrder(projects, collapsed, activeId, teammates.flatMap((g) => g.rows.map((r) => r.id))),
    [projects, collapsed, activeId, teammates],
  );

  const queue = useDecisionQueue();
  const waiting = useWaitingOnPerson();
  // The queue is rebuilt whenever this re-renders, so the rows are kept by
  // what they say: the same list keeps the same array, and the model with it.
  const needsYouHeld = useRef<{ sig: string; rows: LiteNeedsRow[] }>({ sig: "", rows: [] });
  const needsYou = useMemo<LiteNeedsRow[]>(() => {
    const asks = waitingOnPerson(queue);
    const rows = liteNeedsYouItems(asks, waiting).map((item) => {
      const row = s.sessions[item.sessionId] ?? asks.find((a) => a.conversationId === item.sessionId)?.session;
      const sessionTitle = row ? sessionCardTitle(row) : "Session";
      return { ...item, title: item.question ?? sessionTitle, sessionTitle, activityAt: row?.updated_at || 0 };
    });
    const sig = rows.map((r) => `${r.key}\x1f${r.title}\x1f${r.sessionTitle}\x1f${r.activityAt}`).join("\x1e");
    if (sig === needsYouHeld.current.sig) return needsYouHeld.current.rows;
    needsYouHeld.current = { sig, rows };
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, waiting, faceSig]);

  return useMemo(
    () => ({ projects, teammates, order, activeId, needsYou, needsYouCount: needsYou.length, onTeam: !!activeTeamId, collapsed, toggleCollapsed, showAll, toggleShowAll }),
    [projects, teammates, order, activeId, needsYou, activeTeamId, collapsed, toggleCollapsed, showAll, toggleShowAll],
  );
}
