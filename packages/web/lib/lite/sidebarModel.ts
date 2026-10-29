// Codecast Lite's sidebar, as data: which project a session files under, the
// one mark a row wears, the order projects and rows sit in, and the order the
// next/previous keys walk. Pure on purpose. The rows' verdicts come in from
// the store's one classifier (placeInboxRows / sessionWorkState); this file
// only arranges what that classifier already decided, so the sidebar and the
// classic inbox can never disagree about what needs you.
import { sessionRepository } from "../repoNavigation";

/** The one status mark a row wears. `needs`: waiting on a person; `done`: a
 *  finished turn nobody has read yet; null: nothing to say. */
export type LiteMark = "working" | "needs" | "done" | null;

/** The placeInboxRows sections the sidebar lists. The triaged ones (stashed,
 *  snoozed, dismissed) are the person's own "not now" and stay out, and a
 *  killed row is placed in none of these. */
export const LITE_SECTIONS = ["questions", "needsInput", "working", "done", "dormant", "pinned", "newSessions"] as const;

/** A project shows this many sessions until the person asks for the rest. */
export const LITE_PROJECT_CAP = 8;

/**
 * The mark for one of the viewer's rows, from the placeInboxRows section it
 * was filed in. An ask aimed at the person (questions) needs them even while
 * the agent works on; a done turn is only worth marking until it has been
 * read. A pinned or new row, or a set-aside one shown because it is open,
 * says nothing about its state by its section, so it reads its own work
 * state (sessionWorkState) instead.
 */
export function liteMarkOf(section: string, workState: string | null | undefined, unread: boolean): LiteMark {
  switch (section) {
    case "questions":
    case "needsInput":
      return "needs";
    case "working":
      return "working";
    case "done":
      return unread ? "done" : null;
    case "dormant":
      return null;
    default:
      if (workState === "needs_input") return "needs";
      if (workState === "working") return "working";
      return workState === "done" && unread ? "done" : null;
  }
}

/** The mark of a teammate's session: what it is doing, never whether the
 *  viewer has read it (the unread marks are the viewer's own sessions'). */
export function liteTeammateMarkOf(workState: string | null | undefined): Exclude<LiteMark, "done"> {
  if (workState === "needs_input") return "needs";
  if (workState === "working") return "working";
  return null;
}

type ProjectSource = {
  git_remote_url?: string | null;
  git_root?: string | null;
  project_path?: string | null;
  pr_status?: { repository?: string } | null;
};

/**
 * The project a session files under: its GitHub repository when it has one
 * (so worktrees and clones of one repo share a group, and two repos that
 * happen to share a folder name do not), else the folder name the classic
 * inbox groups by (`nameOf` is the store's getProjectName).
 */
export function liteProjectOf(
  row: ProjectSource,
  nameOf: (gitRoot?: string, projectPath?: string) => string,
): { key: string; label: string; detail: string } {
  const repo = sessionRepository(row);
  if (repo) return { key: `repo:${repo.toLowerCase()}`, label: repo.split("/").pop() || repo, detail: repo };
  const name = nameOf(row.git_root ?? undefined, row.project_path ?? undefined);
  return { key: `dir:${name}`, label: name, detail: row.git_root || row.project_path || name };
}

/** One of the viewer's sessions, as the sidebar draws it. */
export type LiteRowFacts = {
  id: string;
  title: string;
  projectKey: string;
  projectLabel: string;
  /** The repository (owner/name) or the folder, for a tooltip and to tell two
   *  same-named projects apart. */
  projectDetail: string;
  /** Last activity, newest first everywhere. */
  activityAt: number;
  mark: LiteMark;
  /** The machine it runs on, when the viewer has more than one. */
  machine: string | null;
};

export type LiteProjectGroup = {
  key: string;
  label: string;
  detail: string;
  /** Every session in the project, newest activity first. */
  all: LiteRowFacts[];
  /** The ones drawn while the project is open: the newest LITE_PROJECT_CAP,
   *  plus any further row that needs the person or is the one open. */
  shown: LiteRowFacts[];
  hiddenCount: number;
  latestAt: number;
  /** The strongest mark inside, for a closed project's header. */
  mark: LiteMark;
};

const MARK_RANK: Record<NonNullable<LiteMark>, number> = { needs: 3, done: 2, working: 1 };

/** The mark that outranks the others: needs you, then unread, then working. */
export function strongestMark(marks: Iterable<LiteMark>): LiteMark {
  let best: LiteMark = null;
  for (const m of marks) if (m && (!best || MARK_RANK[m] > MARK_RANK[best])) best = m;
  return best;
}

const byActivity = (a: { activityAt: number; id: string }, b: { activityAt: number; id: string }) =>
  b.activityAt - a.activityAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Group rows into projects, most recently active project first, each
 * project's sessions newest first. A project shows `cap` rows unless it is in
 * `showAll`; a row past the cap still shows when it needs the person (a row
 * that needs you never hides) or when it is the session open (`activeId`).
 */
export function groupLiteProjects(
  rows: readonly LiteRowFacts[],
  opts: { cap?: number; showAll?: ReadonlySet<string>; activeId?: string | null } = {},
): LiteProjectGroup[] {
  const cap = opts.cap ?? LITE_PROJECT_CAP;
  const byKey = new Map<string, LiteRowFacts[]>();
  for (const row of rows) {
    const list = byKey.get(row.projectKey);
    if (list) list.push(row);
    else byKey.set(row.projectKey, [row]);
  }
  const groups: LiteProjectGroup[] = [];
  for (const [key, list] of byKey) {
    const all = [...list].sort(byActivity);
    const openAll = opts.showAll?.has(key) ?? false;
    const shown = openAll ? all : all.filter((r, i) => i < cap || r.mark === "needs" || r.id === opts.activeId);
    groups.push({
      key,
      label: all[0]!.projectLabel,
      detail: all[0]!.projectDetail,
      all,
      shown,
      hiddenCount: all.length - shown.length,
      latestAt: all[0]!.activityAt,
      mark: strongestMark(all.map((r) => r.mark)),
    });
  }
  groups.sort((a, b) => b.latestAt - a.latestAt || (a.key < b.key ? -1 : 1));
  // Two projects that share a name (a GitHub repo and an unrelated local
  // folder, or two owners' forks) read by their fuller name instead.
  const labelCount = new Map<string, number>();
  for (const g of groups) labelCount.set(g.label, (labelCount.get(g.label) ?? 0) + 1);
  for (const g of groups) if ((labelCount.get(g.label) ?? 0) > 1) g.label = g.detail;
  return groups;
}

/** The rows a project draws in its current state. A closed project still
 *  shows the session that is open, so the highlight never disappears. */
export function visibleRowsOf(group: LiteProjectGroup, collapsed: boolean, activeId: string | null): LiteRowFacts[] {
  if (!collapsed) return group.shown;
  return activeId ? group.all.filter((r) => r.id === activeId) : [];
}

/** Every session id the sidebar draws, top to bottom: what the next and
 *  previous session keys walk. */
export function liteSidebarOrder(
  groups: readonly LiteProjectGroup[],
  collapsed: ReadonlySet<string>,
  activeId: string | null,
  teammateIds: readonly string[] = [],
): string[] {
  const out: string[] = [];
  for (const g of groups) for (const r of visibleRowsOf(g, collapsed.has(g.key), activeId)) out.push(r.id);
  for (const id of teammateIds) if (!out.includes(id)) out.push(id);
  return out;
}

/** The session one step from `currentId` in `order`, or null at either end.
 *  From a page with no session open, next starts at the top and previous at
 *  the bottom. */
export function liteStep(order: readonly string[], currentId: string | null, dir: 1 | -1): string | null {
  if (order.length === 0) return null;
  const at = currentId ? order.indexOf(currentId) : -1;
  if (at === -1) return dir === 1 ? order[0]! : order[order.length - 1]!;
  const next = at + dir;
  return next >= 0 && next < order.length ? order[next]! : null;
}

/** A teammate's live session, as the sidebar draws it. */
export type LiteTeammateRow = {
  id: string;
  title: string;
  mark: "working" | "needs";
  activityAt: number;
  ownerId: string;
  ownerName: string;
  ownerImage: string | null;
};

export type LiteTeammateGroup = {
  ownerId: string;
  ownerName: string;
  ownerImage: string | null;
  rows: LiteTeammateRow[];
};

/** Teammates' live sessions under each teammate: the one waiting on a person
 *  first, then by activity; teammates by their most recent activity. */
export function groupLiteTeammates(rows: readonly LiteTeammateRow[]): LiteTeammateGroup[] {
  const byOwner = new Map<string, LiteTeammateGroup>();
  for (const row of rows) {
    let g = byOwner.get(row.ownerId);
    if (!g) byOwner.set(row.ownerId, g = { ownerId: row.ownerId, ownerName: row.ownerName, ownerImage: row.ownerImage, rows: [] });
    g.rows.push(row);
  }
  const groups = [...byOwner.values()];
  for (const g of groups) {
    g.rows.sort((a, b) => (a.mark === b.mark ? byActivity(a, b) : a.mark === "needs" ? -1 : 1));
  }
  const latest = (g: LiteTeammateGroup) => Math.max(...g.rows.map((r) => r.activityAt));
  groups.sort((a, b) => latest(b) - latest(a) || a.ownerName.localeCompare(b.ownerName));
  return groups;
}

/** A row's age at a glance: "now", "5m", "3h", "2d", "6w". Empty for a row
 *  with no activity stamp yet (its fast fields have not landed). */
export function liteAge(ts: number | null | undefined, now: number): string {
  if (!ts) return "";
  const minutes = Math.floor(Math.max(0, now - ts) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/**
 * How many things wait on the person: every ask in the decision queue, plus
 * each waiting session the queue does not already hold (a session asking a
 * question sits in both, and counts once).
 */
export function liteNeedsYouCount(
  asks: readonly { conversationId: string }[],
  waiting: readonly { _id: string }[],
): number {
  const asked = new Set(asks.map((a) => a.conversationId));
  let n = asks.length;
  for (const row of waiting) if (!asked.has(row._id)) n++;
  return n;
}
