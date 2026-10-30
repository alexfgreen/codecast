// Codecast Lite's Needs you, as data: every thing waiting on the person, in
// the order the page lists it, and the number the sidebar shows beside it.
// Pure on purpose. What counts as an ask comes from the decision queue
// (useDecisionQueue, ranked by its sortQueue); a handoff from the inbox row's
// assigned_ping; a mention from the notification list; a finished turn from
// the sidebar's own "done, not read yet" mark. This file only gathers them,
// so the page, its count and the sidebar can never disagree.
import type { QueueItem } from "../decisionQueue";
import { notificationActor, notificationRoute, sessionLabel } from "../notificationTypes";
import { liteSessionPath } from "../inboxRouting";

/** The page's sections, most urgent first. */
export type LiteNeedsSection = "questions" | "handed" | "mentions" | "finished";

/** The notification types addressed to the person by name: someone mentioned
 *  them, replied to them, commented on their session, wrote to them, or handed
 *  them a session, a task or a decision. */
export const LITE_MENTION_TYPES: ReadonlySet<string> = new Set([
  "mention",
  "chat_mention",
  "comment_reply",
  "conversation_comment",
  "chat_dm",
  "session_assigned",
  "task_assigned",
  "decision_passed",
  "decision_escalated",
  "decision_assigned",
  "decision_comment",
  "decision_answered_for_you",
]);

/** Where a mention opens: a session in Lite, a page Lite does not have (the
 *  classic one), or a page outside the app (`external`, a new tab). */
export type LiteNoticeTarget = { href: string; external: boolean; sessionId: string | null };

type ItemBase = { key: string; at: number };

/** An ask aimed at the person: a decision, a terminal question or a
 *  permission prompt, as the decision queue holds it. */
export type LiteQuestionItem = ItemBase & { section: "questions"; sessionId: string; title: string; ask: QueueItem };
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

export type LiteNeedsItem = LiteQuestionItem | LiteHandedItem | LiteMentionItem | LiteFinishedItem;

/** A handed session, off its inbox row (assigned_ping). */
export type LiteHandedFact = { sessionId: string; title: string; by: string; note: string | null; at: number };
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
  link?: string;
  actor?: { name?: string; github_username?: string; github_avatar_url?: string } | null;
  actor_name?: string;
  actor_avatar?: string;
  actor_session?: { id: string; agent_type: string } | null;
  conversation?: { title?: string; project_path?: string; agent_type?: string } | null;
};

/** Where a notification opens from Lite: a deep link outside the app in a new
 *  tab, a page with its own route (a task, a chat line) in the classic app,
 *  a session in Lite. Null when it names nothing to open. */
export function liteNoticeTarget(n: LiteNotificationFact): LiteNoticeTarget | null {
  if (n.link) return { href: n.link, external: true, sessionId: null };
  const route = notificationRoute(n.entity_type, n.entity_id, n.chat_message_id);
  if (route) return { href: route, external: false, sessionId: null };
  const sessionId = n.conversation_id || (n.entity_type === "conversation" ? n.entity_id : null);
  return sessionId ? { href: liteSessionPath(sessionId), external: false, sessionId } : null;
}

/**
 * Everything waiting on the person, most urgent first:
 *  - questions, in the decision queue's own order (blocking and reachable,
 *    then blocking, then advisory; oldest first inside each);
 *  - sessions handed to them, newest first;
 *  - unread notifications addressed to them, newest first (a session_assigned
 *    one whose handoff is listed already says nothing more, and is left out);
 *  - finished turns they have not read, newest first, except a session
 *    already listed above.
 */
export function liteNeedsYouItems(input: {
  asks: readonly QueueItem[];
  titleOf: (sessionId: string, session?: QueueItem["session"]) => string;
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
  const handedIds = new Set<string>();
  for (const h of [...input.handed].sort((a, b) => b.at - a.at)) {
    out.push({ key: `handed:${h.sessionId}`, section: "handed", sessionId: h.sessionId, title: h.title, by: h.by, note: h.note, at: h.at });
    handedIds.add(h.sessionId);
    listed.add(h.sessionId);
  }
  const mentions = input.notifications
    .filter((n) => !n.read && LITE_MENTION_TYPES.has(n.type))
    .filter((n) => !(n.type === "session_assigned" && n.conversation_id && handedIds.has(n.conversation_id)))
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

/** The number beside Needs you: everything the person owes an answer, an
 *  acknowledgment or a read of a message to them. A finished turn is listed
 *  but not counted; it asks nothing of anyone. */
export function liteNeedsYouCount(items: readonly LiteNeedsItem[]): number {
  let n = 0;
  for (const item of items) if (item.section !== "finished") n++;
  return n;
}

/** The items under each section, in the page's order, each section only
 *  when it holds something. */
export function liteNeedsSections(items: readonly LiteNeedsItem[]): { section: LiteNeedsSection; items: LiteNeedsItem[] }[] {
  const order: LiteNeedsSection[] = ["questions", "handed", "mentions", "finished"];
  return order
    .map((section) => ({ section, items: items.filter((i) => i.section === section) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Whether a decision is answered by one press on an option where it is
 * listed: a single choice whose ask says nothing beyond its question and its
 * options' names. Anything more (several choices, a rank, a form, a change
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
