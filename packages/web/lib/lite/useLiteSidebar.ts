// The Lite sidebar's data, computed once per window and shared. The sidebar
// draws it, the next/previous session keys walk its order, and the palette
// lists its recents and projects, so all three see the same rows in the same
// order. One provider (components/lite/LiteSidebarModel) runs the hook below
// and hands the result down through context; the readers re-render when the
// model changes and nothing else does.
//
// Store reads follow the house rules: the placement comes from the one
// classifier (placeInboxRows via useMinePlacement), every subscription is a
// wake signature, and the clock is a shared coarse one. A row's mark is
// decided here once (liteMarkOf over its section, its unread state and the
// store's hard-block test) and read everywhere else through the model:
// useLiteSessionMark for one session, Needs you for the whole list.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  getProjectName,
  isForeignRow,
  isSessionHardBlocked,
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
import { useMinePlacement } from "../../hooks/useNeedsInputCount";
import { useDecisionQueue } from "../../hooks/useDecisionQueue";
import { useCoarseNow } from "../../hooks/useCoarseNow";
import { liteTeammateSessionIds } from "../../hooks/useLiteFeeders";
import { sessionHasOpenQuestion, waitingOnPerson } from "../decisionQueue";
import { sessionCardTitle } from "../sessionCard";
import { deviceDisplayName, inboxSortTimeOfRow } from "@codecast/shared/contracts";
import type { Device } from "../../components/DeviceBadge";
import {
  LITE_SECTIONS,
  groupLiteProjects,
  groupLiteTeammates,
  liteMarkLabel,
  liteMarkOf,
  liteProjectOf,
  liteSidebarOrder,
  liteTeammateMarkOf,
  type LiteMark,
  type LiteProjectGroup,
  type LiteRowFacts,
  type LiteTeammateGroup,
  type LiteTeammateRow,
} from "./sidebarModel";
import {
  LITE_MENTION_TYPES,
  liteNeedsYouAttention,
  liteNeedsYouCount,
  liteNeedsYouItems,
  liteStoppedReason,
  type LiteHandedFact,
  type LiteNeedsItem,
  type LiteNotificationFact,
  type LiteStoppedFact,
} from "./needsYou";
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
  /** Everything waiting on the viewer, most urgent first, as Needs you
   *  lists it (lib/lite/needsYou). */
  needsYou: LiteNeedsItem[];
  /** The number beside Needs you: needsYou less its finished turns
   *  (liteNeedsYouCount), so the number and the list never disagree. */
  needsYouCount: number;
  /** The number wears the attention color: a question or a stopped session
   *  is among them (liteNeedsYouAttention). */
  needsYouAttention: boolean;
  /** The store holds the viewer's sessions, from this visit's sync or an
   *  earlier one: until then an empty list means "not known yet", never
   *  "nothing". */
  ready: boolean;
  /** Every mark the model knows, by session id: each row it draws, and the
   *  open session even when it draws no row for it. Read one through
   *  useLiteSessionMark. */
  marks: ReadonlyMap<string, LiteSessionMark>;
  /** The active workspace is a team. */
  onTeam: boolean;
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (projectKey: string) => void;
  showAll: ReadonlySet<string>;
  toggleShowAll: (projectKey: string) => void;
};

/** A session's mark and the words for it ("Needs you", "Failed", "Done",
 *  "Working", "Waiting on Maya"), or null words for no mark. */
export type LiteSessionMark = { mark: LiteMark; label: string | null };

const NO_MARK: LiteSessionMark = { mark: null, label: null };

// One object per distinct mark and label, so a reader holding one sees the
// same ref until the mark itself changes.
const markMemo = new Map<string, LiteSessionMark>();
function sessionMark(mark: LiteMark, ownerName?: string | null): LiteSessionMark {
  if (!mark) return NO_MARK;
  const label = liteMarkLabel(mark, ownerName);
  const key = `${mark}\x1f${label ?? ""}`;
  let hit = markMemo.get(key);
  if (!hit) markMemo.set(key, hit = { mark, label });
  return hit;
}

const EMPTY: LiteSidebarModel = {
  projects: [],
  teammates: [],
  order: [],
  activeId: null,
  needsYou: [],
  needsYouCount: 0,
  needsYouAttention: false,
  ready: false,
  marks: new Map(),
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

/**
 * One session's mark, as the sidebar draws it: the one derivation every
 * surface shows (the sidebar's rows, the session header's pill, Needs you).
 * `label` is the mark in words ("Needs you", "Failed", "Done", "Working",
 * "Waiting on {first name}"), null when there is no mark.
 */
export function useLiteSessionMark(sessionId: string | null | undefined): LiteSessionMark {
  const { marks } = useLiteSidebarModel();
  return (sessionId ? marks.get(sessionId) : undefined) ?? NO_MARK;
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

// What the failure mark reads that the structural signature leaves out: an
// API error banner landing on a row already waiting on input, or the agent
// going quiet under a message, moves no section. Neither moves on a heartbeat.
const failureSig = makeCollectionSig<InboxSession>(
  (r) => `${r.pending_api_error ? 1 : 0}${r.is_unresponsive ? 1 : 0}${r.pending_api_error_kind ?? ""}`,
);

/** Stuck on something the person must fix: the store's hard-block test
 *  (which also stands down for a row with a send on its way, or a killed
 *  one), on its failure arms only. Its ask arms (an open question, a
 *  permission prompt) are questions, and a process that merely exited is a
 *  finished session. */
function rowFailed(row: InboxSession, queued: Set<string> | undefined, now: number): boolean {
  if (row.pending_api_error !== true && !row.is_unresponsive) return false;
  return isSessionHardBlocked(row, queued, now);
}

// The handoffs waiting on the viewer: who, when and the note, on the rows the
// list keeps (a killed session or a subagent is left out, so killing a handed
// session takes it off). Changes on a handoff, an acknowledgment or a kill
// only.
const handedSig = makeCollectionSig<InboxSession>(
  (r) => (r.assigned_ping && !r.inbox_killed_at && !isSub(r) ? `${r.assigned_ping.at}|${r.assigned_ping.by_name}|${r.assigned_ping.note ?? ""}` : null),
);

/** The store holds the viewer's sessions: a row is cached, or a sessions
 *  floor has completed (a new account with none). Before either, nothing is
 *  known yet. Stops at the first hit. */
function sessionsKnown(st: { sessions: Record<string, unknown>; syncMeta: Record<string, { backfilledAt?: number } | undefined> }): boolean {
  for (const _ in st.sessions) return true;
  for (const key in st.syncMeta) if (key.startsWith("sessions:") && st.syncMeta[key]?.backfilledAt) return true;
  return false;
}

// The unread notifications Needs you lists. A read one leaves the signature.
const mentionsSig = makeCollectionSig<LiteNotificationFact>(
  (n) => (!n.read && LITE_MENTION_TYPES.has(n.type) ? `${n.created_at ?? 0}|${n.message ?? ""}` : null),
);

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
    (st) => teamMembersSig(st.teamMembers as RosterMember[]),
    // The server's current team list: who is a teammate now
    // (liteTeammateSessionIds).
    (st) => st.teamInboxIds,
    (st) => st.teamInboxIdSnapshot?.team_id,
    (st) => failureSig(st.sessions),
    (st) => st.sessionsWithQueuedMessages,
    // A teammate's session asking its owner (sessionHasOpenQuestion) reads
    // the questions the viewer resolved here.
    (st) => st.questionResolutions,
    (st) => handedSig(st.sessions),
    (st) => mentionsSig(st.notifications as Record<string, LiteNotificationFact>),
    (st) => sessionsKnown(st),
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
  const failSig = failureSig(s.sessions);
  const rows = useMemo<LiteRowFacts[]>(() => {
    if (!placed) return [];
    const unread = sessionUnreadMap(s);
    const queued = s.sessionsWithQueuedMessages;
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
        mark: liteMarkOf(section, { workState, unread: !!unread[row._id], failed: rowFailed(row, queued, now) }),
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
  }, [placed, faceSig, unreadSig, rosterSig, failSig, s.sessionsWithQueuedMessages, activeId, now]);

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
      const mark = liteTeammateMarkOf(workState, sessionHasOpenQuestion(row, s.questionResolutions));
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
  }, [activeTeamId, meId, teamSig, wakeSig, faceSig, membersSig, s.teamInboxIds, s.teamInboxIdSnapshot?.team_id, s.questionResolutions, now]);

  const order = useMemo(
    () => liteSidebarOrder(projects, collapsed, activeId, teammates.flatMap((g) => g.rows.map((r) => r.id))),
    [projects, collapsed, activeId, teammates],
  );

  // Every mark by session id: the rows drawn, and the open session when no
  // row is drawn for it (a teammate's finished session, one from a link, a
  // subagent), by the same rules: a foreign row reads as a teammate's, one of
  // the viewer's own as a set-aside row does.
  const marks = useMemo<ReadonlyMap<string, LiteSessionMark>>(() => {
    const out = new Map<string, LiteSessionMark>();
    for (const r of rows) out.set(r.id, sessionMark(r.mark));
    for (const g of teammates) for (const r of g.rows) out.set(r.id, sessionMark(r.mark, g.ownerName));
    const open = activeId && !out.has(activeId) ? s.sessions[activeId] : undefined;
    if (open) {
      const workState = sessionWorkState(open, now);
      if (isForeignRow(open, meId)) {
        const ownerId = String(open.owner_user_id || open.user_id || "");
        const member = ((s.teamMembers ?? []) as RosterMember[]).find((m) => String(m._id) === ownerId);
        out.set(open._id, sessionMark(liteTeammateMarkOf(workState, sessionHasOpenQuestion(open, s.questionResolutions)), member?.name || open.author_name));
      } else {
        const unread = !!sessionUnreadMap(s)[open._id];
        out.set(open._id, sessionMark(liteMarkOf("shelved", { workState, unread, failed: rowFailed(open, s.sessionsWithQueuedMessages, now) })));
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, teammates, activeId, meId, wakeSig, unreadSig, failSig, membersSig, s.questionResolutions, now]);

  // Sessions handed to the viewer and not yet acknowledged (the inbox row's
  // assigned_ping, stamped for the viewer alone), walked only when one is
  // handed, acknowledged or renamed.
  const handedKey = handedSig(s.sessions);
  const handed = useMemo<LiteHandedFact[]>(() => {
    const out: LiteHandedFact[] = [];
    for (const id in s.sessions) {
      const row = s.sessions[id];
      const ping = row?.assigned_ping;
      if (!ping || row.inbox_killed_at || isSub(row)) continue;
      out.push({ sessionId: id, title: sessionCardTitle(row), by: ping.by_name, note: ping.note || null, at: ping.at });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handedKey, faceSig]);

  // The viewer's sessions stopped on something only they can fix: the rows
  // the sidebar marks failed, with why (the banner's kind, read off the row).
  const stopped = useMemo<LiteStoppedFact[]>(() => {
    const out: LiteStoppedFact[] = [];
    for (const r of rows) {
      if (r.mark !== "error") continue;
      const row = s.sessions[r.id];
      if (!row) continue;
      out.push({ sessionId: r.id, title: r.title, project: r.projectLabel, at: r.sortAt, ...liteStoppedReason(row) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, failSig]);

  const queue = useDecisionQueue();
  const mentions = mentionsSig(s.notifications as Record<string, LiteNotificationFact>);
  // The queue is rebuilt whenever this re-renders, so the items are kept by
  // what they say: the same list keeps the same array, and the page with it.
  const needsYouHeld = useRef<{ sig: string; items: LiteNeedsItem[] }>({ sig: "", items: [] });
  const needsYou = useMemo<LiteNeedsItem[]>(() => {
    const titleOf = (id: string, session?: InboxSession) => {
      const row = s.sessions[id] ?? session;
      return row ? sessionCardTitle(row) : "Session";
    };
    const items = liteNeedsYouItems({
      asks: waitingOnPerson(queue),
      titleOf,
      stopped,
      handed,
      notifications: Object.values((s.notifications ?? {}) as Record<string, LiteNotificationFact>),
      finished: rows.filter((r) => r.mark === "done").map((r) => ({ sessionId: r.id, title: r.title, project: r.projectLabel, at: r.sortAt })),
    });
    const sig = items.map(needsItemSig).join("\x1e");
    if (sig === needsYouHeld.current.sig) return needsYouHeld.current.items;
    needsYouHeld.current = { sig, items };
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, rows, stopped, handed, mentions, faceSig]);

  const ready = sessionsKnown(s);
  return useMemo(
    () => ({
      projects, teammates, order, activeId, needsYou,
      needsYouCount: liteNeedsYouCount(needsYou), needsYouAttention: liteNeedsYouAttention(needsYou), ready,
      marks, onTeam: !!activeTeamId, collapsed, toggleCollapsed, showAll, toggleShowAll,
    }),
    [projects, teammates, order, activeId, needsYou, ready, marks, activeTeamId, collapsed, toggleCollapsed, showAll, toggleShowAll],
  );
}

// What an item shows and answers with: two lists that say the same keep one
// array. A question's options and kind are in it, so an ask the agent
// rewrote is a new item.
function needsItemSig(item: LiteNeedsItem): string {
  switch (item.section) {
    case "questions": {
      const a = item.ask;
      return `${item.key}\x1f${item.title}\x1f${a.question}\x1f${a.source}\x1f${a.kind ?? ""}\x1f${a.blocking ? 1 : 0}\x1f${a.decisionId ?? ""}\x1f${a.options.map((o) => `${o.label}\x1c${o.description ?? ""}`).join("\x1d")}`;
    }
    case "stopped":
      return `${item.key}\x1f${item.title}\x1f${item.project}\x1f${item.reason}\x1f${item.detail ?? ""}\x1f${item.at}`;
    case "handed":
      return `${item.key}\x1f${item.title}\x1f${item.by}\x1f${item.note ?? ""}\x1f${item.at}`;
    case "mentions":
      return `${item.key}\x1f${item.message}\x1f${item.where ?? ""}\x1f${item.actorName ?? ""}\x1f${item.actorImage ?? ""}\x1f${item.target?.href ?? ""}`;
    case "finished":
      return `${item.key}\x1f${item.title}\x1f${item.project}\x1f${item.at}`;
  }
}
