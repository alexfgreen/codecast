// Codecast Lite's Needs you, as data: every thing waiting on the person, in
// the order the page lists it, and the number the sidebar shows beside it.
// Pure on purpose. What counts as an ask comes from the decision queue
// (useDecisionQueue, ranked by its sortQueue); a handoff from the inbox row's
// assigned_ping; a stopped session from the sidebar's failed mark; a mention
// from the notification list; a finished turn from the sidebar's own "done,
// not read yet" mark. This file only gathers them, so the page, its count and
// the sidebar can never disagree.
import type { QueueItem } from "../decisionQueue";
import { notificationActor, notificationRoute, sessionLabel } from "../notificationTypes";
import { liteSessionPath } from "../inboxRouting";
import { apiErrorBadge } from "../apiErrorBadge";

/** The page's sections, most urgent first. */
export type LiteNeedsSection = "questions" | "stopped" | "handed" | "mentions" | "finished";

/** The notification types addressed to the person by name: someone mentioned
 *  them, replied to them, commented on their session, wrote to them, handed
 *  them a task, or wrote on or answered a decision of theirs. A handed
 *  session and a decision passed, escalated or shared to them are not here:
 *  their homes are the inbox row's assigned_ping and the decision queue,
 *  which list them while they wait and drop them once answered, wherever the
 *  answer came from; their notices only point at them. */
export const LITE_MENTION_TYPES: ReadonlySet<string> = new Set([
  "mention",
  "chat_mention",
  "comment_reply",
  "conversation_comment",
  "chat_dm",
  "task_assigned",
  "decision_comment",
  "decision_answered_for_you",
]);

/** The decision notices whose ask the queue holds: read together with the
 *  ask they announce, so answering it leaves nothing behind in the bell. */
export const LITE_DECISION_NOTICE_TYPES: ReadonlySet<string> = new Set([
  "decision_passed",
  "decision_escalated",
  "decision_assigned",
]);

/** Where a mention opens: a session in Lite (at the comment it is about, when
 *  it is one), a page Lite does not have (the classic one, in place), or a
 *  page outside the app (`external`, a new tab). */
export type LiteNoticeTarget = { href: string; external: boolean; sessionId: string | null };

type ItemBase = { key: string; at: number };

/** An ask aimed at the person: a decision, a terminal question or a
 *  permission prompt, as the decision queue holds it. */
export type LiteQuestionItem = ItemBase & { section: "questions"; sessionId: string; title: string; ask: QueueItem };
/** One of the person's sessions stopped on something only they can fix (a
 *  login, a usage limit, an agent gone quiet): opened, not cleared. */
export type LiteStoppedItem = ItemBase & { section: "stopped"; sessionId: string; title: string; project: string; reason: string; detail: string | null };
/** A session a teammate handed the person, not yet acknowledged. */
export type LiteHandedItem = ItemBase & { section: "handed"; sessionId: string; title: string; by: string; note: string | null };
/** An unread notification addressed to the person. */
export type LiteMentionItem = ItemBase & {
  section: "mentions";
  notificationId: string;
  message: string;
  actorName: string | null;
  actorImage: string | null;
  /** The session it is about, by name. */
  where: string | null;
  target: LiteNoticeTarget | null;
};
/** One of the person's sessions whose finished turn they have not read. */
export type LiteFinishedItem = ItemBase & { section: "finished"; sessionId: string; title: string; project: string };

export type LiteNeedsItem = LiteQuestionItem | LiteStoppedItem | LiteHandedItem | LiteMentionItem | LiteFinishedItem;

/** A handed session, off its inbox row (assigned_ping). */
export type LiteHandedFact = { sessionId: string; title: string; by: string; note: string | null; at: number };
/** A stopped session, off the sidebar's row and its banner's kind. */
export type LiteStoppedFact = { sessionId: string; title: string; project: string; reason: string; detail: string | null; at: number };
/** A finished, unread session, off the sidebar's row. */
export type LiteFinishedFact = { sessionId: string; title: string; project: string; at: number };
/** The notification fields a mention reads (a store row of `notifications`). */
export type LiteNotificationFact = {
  _id: string;
  type: string;
  read?: boolean;
  message?: string;
  created_at?: number;
  conversation_id?: string | null;
  entity_type?: string;
  entity_id?: string;
  chat_message_id?: string;
  comment_id?: string;
  link?: string;
  actor?: { name?: string; github_username?: string; github_avatar_url?: string } | null;
  actor_name?: string;
  actor_avatar?: string;
  actor_session?: { id: string; agent_type: string } | null;
  conversation?: { title?: string; project_path?: string; agent_type?: string } | null;
};

/** Where a notification opens from Lite: its own link (an address outside
 *  the app in a new tab, one inside it, a page Lite does not have, in place),
 *  a page with its own route (a task, a chat line) in the classic app, a
 *  session in Lite, at the comment the notice is about when it names one.
 *  Null when it names nothing to open. */
export function liteNoticeTarget(n: LiteNotificationFact): LiteNoticeTarget | null {
  if (n.link) return { href: n.link, external: /^[a-z][a-z0-9+.-]*:/i.test(n.link), sessionId: null };
  const route = notificationRoute(n.entity_type, n.entity_id, n.chat_message_id);
  if (route) return { href: route, external: false, sessionId: null };
  const sessionId = n.conversation_id || (n.entity_type === "conversation" ? n.entity_id : null);
  if (!sessionId) return null;
  const at = n.comment_id ? `?comment=${encodeURIComponent(n.comment_id)}` : "";
  return { href: `${liteSessionPath(sessionId)}${at}`, external: false, sessionId };
}

const STOPPED_REASON: Record<string, string> = {
  auth: "Signed out",
  limit: "Usage limit",
  throttle: "Throttled",
  context: "Context full",
  safety: "Stopped for safety review",
  fatal: "Request failed",
  connection: "Connection dropped",
};

/** Why a session the sidebar marks failed has stopped, in a few words, and
 *  what fixes it (the banner's own explanation, apiErrorBadge). */
export function liteStoppedReason(row: {
  pending_api_error?: boolean | null;
  pending_api_error_kind?: string | null;
  is_unresponsive?: boolean | null;
  agent_type?: string | null;
}): { reason: string; detail: string | null } {
  if (row.pending_api_error === true) {
    const kind = row.pending_api_error_kind ?? "";
    return { reason: STOPPED_REASON[kind] ?? "Stopped", detail: apiErrorBadge(kind, row.agent_type)?.title ?? null };
  }
  if (row.is_unresponsive) return { reason: "Not responding", detail: null };
  return { reason: "Stopped", detail: null };
}

/**
 * Everything waiting on the person, most urgent first:
 *  - questions, in the decision queue's own order (blocking and reachable,
 *    then blocking, then advisory; oldest first inside each);
 *  - their sessions stopped on something only they can fix, newest first,
 *    except one already asking above;
 *  - sessions handed to them, newest first;
 *  - unread notifications addressed to them, newest first;
 *  - finished turns they have not read, newest first, except a session
 *    already listed above.
 */
export function liteNeedsYouItems(input: {
  asks: readonly QueueItem[];
  titleOf: (sessionId: string, session?: QueueItem["session"]) => string;
  stopped?: readonly LiteStoppedFact[];
  handed: readonly LiteHandedFact[];
  notifications: readonly LiteNotificationFact[];
  finished: readonly LiteFinishedFact[];
}): LiteNeedsItem[] {
  const out: LiteNeedsItem[] = [];
  const listed = new Set<string>();
  for (const ask of input.asks) {
    out.push({ key: `ask:${ask.key}`, section: "questions", sessionId: ask.conversationId, title: input.titleOf(ask.conversationId, ask.session), ask, at: ask.createdAt });
    listed.add(ask.conversationId);
  }
  for (const f of [...(input.stopped ?? [])].sort((a, b) => b.at - a.at)) {
    if (listed.has(f.sessionId)) continue;
    out.push({ key: `stopped:${f.sessionId}`, section: "stopped", sessionId: f.sessionId, title: f.title, project: f.project, reason: f.reason, detail: f.detail, at: f.at });
    listed.add(f.sessionId);
  }
  for (const h of [...input.handed].sort((a, b) => b.at - a.at)) {
    out.push({ key: `handed:${h.sessionId}`, section: "handed", sessionId: h.sessionId, title: h.title, by: h.by, note: h.note, at: h.at });
    listed.add(h.sessionId);
  }
  const mentions = input.notifications
    .filter((n) => !n.read && LITE_MENTION_TYPES.has(n.type))
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  for (const n of mentions) {
    const actor = notificationActor(n);
    out.push({
      key: `notice:${n._id}`,
      section: "mentions",
      notificationId: n._id,
      message: n.message ?? "",
      actorName: actor.name ?? null,
      actorImage: actor.avatar ?? null,
      where: sessionLabel(n.conversation),
      target: liteNoticeTarget(n),
      at: n.created_at ?? 0,
    });
  }
  for (const f of [...input.finished].sort((a, b) => b.at - a.at)) {
    if (listed.has(f.sessionId)) continue;
    out.push({ key: `finished:${f.sessionId}`, section: "finished", sessionId: f.sessionId, title: f.title, project: f.project, at: f.at });
  }
  return out;
}

/** The number beside Needs you: everything the person owes an answer, a fix,
 *  an acknowledgment or a read of a message to them. A finished turn is
 *  listed but not counted; it asks nothing of anyone. */
export function liteNeedsYouCount(items: readonly LiteNeedsItem[]): number {
  let n = 0;
  for (const item of items) if (item.section !== "finished") n++;
  return n;
}

/** Whether the number wears the attention color: only while something waits
 *  on the person's answer or fix (a question, a stopped session); handoffs
 *  and mentions are counted in a neutral one. */
export function liteNeedsYouAttention(items: readonly LiteNeedsItem[]): boolean {
  return items.some((item) => item.section === "questions" || item.section === "stopped");
}

/** The items under each section, in the page's order, each section only
 *  when it holds something. */
export function liteNeedsSections(items: readonly LiteNeedsItem[]): { section: LiteNeedsSection; items: LiteNeedsItem[] }[] {
  const order: LiteNeedsSection[] = ["questions", "stopped", "handed", "mentions", "finished"];
  return order
    .map((section) => ({ section, items: items.filter((i) => i.section === section) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Whether a decision is answered by one press on an option where it is
 * listed: a single choice whose ask says nothing beyond its question and its
 * options' names and one-line descriptions (the row shows those whole, under
 * each option). Anything more (several choices, a rank, a form, a change
 * card, the agent's context, a document, an option's body, cost, risk or
 * evidence, a trial run) opens its session, whose docked card carries those
 * controls and shows that context whole.
 */
export function liteAnswersInline(ask: QueueItem, hasCard: boolean): boolean {
  if (ask.source !== "decide" || !ask.decisionId || ask.options.length === 0) return false;
  if ((ask.kind ?? "single") !== "single" || hasCard) return false;
  if (ask.contextMd?.trim() || ask.docId || ask.reportSlug || ask.trial) return false;
  return !ask.options.some((o) => !!(o.body_md?.trim() || o.cost || o.risk || o.evidence?.length || o.page_slug));
}

/** What a key does on the list: move the focus between rows, open the
 *  focused row, answer its decision by an option's digit, allow or deny its
 *  permission prompt, or clear it (mark a mention or a finished turn read,
 *  acknowledge a handoff). */
export type LiteNeedsKey =
  | { kind: "move"; to: "next" | "prev" | "first" | "last" }
  | { kind: "open" }
  | { kind: "answer"; index: number }
  | { kind: "allow" }
  | { kind: "deny" }
  | { kind: "clear" };

/** The key's meaning on the list, or null when it is not the list's: a key
 *  held with Cmd, Ctrl or Alt is a shortcut's. The caller leaves keys typed
 *  into a field alone, and lets only a move auto-repeat (liteNeedsActs). */
export function liteNeedsKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): LiteNeedsKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case "ArrowDown":
    case "j":
      return { kind: "move", to: "next" };
    case "ArrowUp":
    case "k":
      return { kind: "move", to: "prev" };
    case "Home":
      return { kind: "move", to: "first" };
    case "End":
      return { kind: "move", to: "last" };
    case "Enter":
      return { kind: "open" };
    case "y":
      return { kind: "allow" };
    case "n":
      return { kind: "deny" };
    case "e":
      return { kind: "clear" };
  }
  return /^[1-9]$/.test(e.key) ? { kind: "answer", index: Number(e.key) - 1 } : null;
}

/** A key that writes (answers, allows, denies, clears), as against one that
 *  moves or opens: it never auto-repeats, and it waits a beat after its row
 *  takes the focus or changes under it, so a held or doubled key never
 *  answers what the person has not read. */
export function liteNeedsActs(key: LiteNeedsKey): boolean {
  return key.kind === "answer" || key.kind === "allow" || key.kind === "deny" || key.kind === "clear";
}
