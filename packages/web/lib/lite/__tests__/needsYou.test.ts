import { describe, expect, it } from "bun:test";
import type { QueueItem } from "../../decisionQueue";
import {
  LITE_MENTION_TYPES,
  liteAnswersInline,
  liteNeedsKey,
  liteNeedsSections,
  liteNeedsYouCount,
  liteNeedsYouItems,
  liteNoticeTarget,
  type LiteNotificationFact,
} from "../needsYou";

const ask = (key: string, conversationId: string, extra: Partial<QueueItem> = {}): QueueItem => ({
  key,
  source: "decide",
  conversationId,
  question: `Question ${key}`,
  options: [{ label: "Yes" }, { label: "No" }],
  blocking: true,
  createdAt: 10,
  decisionId: `d-${key}`,
  ...extra,
} as QueueItem);

const notice = (id: string, type: string, extra: Partial<LiteNotificationFact> = {}): LiteNotificationFact => ({
  _id: id,
  type,
  read: false,
  message: `${id} message`,
  created_at: 100,
  ...extra,
});

const titleOf = (id: string) => `Session ${id}`;

describe("liteNeedsYouItems", () => {
  const items = liteNeedsYouItems({
    asks: [ask("k1", "a"), ask("k2", "b", { source: "permission" })],
    titleOf,
    handed: [
      { sessionId: "h1", title: "Ship mobile", by: "Maya Kim", note: "can you take the tests?", at: 5 },
      { sessionId: "h2", title: "Docs", by: "Jon", note: null, at: 50 },
    ],
    notifications: [
      notice("n1", "mention", { created_at: 10, conversation_id: "a" }),
      notice("n2", "chat_dm", { created_at: 30 }),
      notice("n3", "session_idle", { created_at: 40 }),
      notice("n4", "mention", { created_at: 50, read: true }),
      notice("n5", "session_assigned", { created_at: 60, conversation_id: "h1" }),
      notice("n6", "session_assigned", { created_at: 70, conversation_id: "z" }),
    ],
    finished: [
      { sessionId: "f1", title: "Old", project: "codecast", at: 1 },
      { sessionId: "f2", title: "New", project: "notes", at: 9 },
      { sessionId: "a", title: "Asking", project: "codecast", at: 99 },
      { sessionId: "h2", title: "Docs", project: "codecast", at: 99 },
    ],
  });

  it("lists questions in the queue's order, then handoffs, mentions and finished turns, newest first inside each", () => {
    expect(items.map((i) => i.key)).toEqual([
      "ask:k1", "ask:k2",
      "handed:h2", "handed:h1",
      "notice:n6", "notice:n2", "notice:n1",
      "finished:f2", "finished:f1",
    ]);
  });

  it("names each ask's session", () => {
    const first = items[0]!;
    expect(first.section === "questions" && first.title).toBe("Session a");
  });

  it("leaves out read notices, notices not addressed to the person, and a handoff's own notice", () => {
    const ids = items.flatMap((i) => (i.section === "mentions" ? [i.notificationId] : []));
    expect(ids).not.toContain("n3");
    expect(ids).not.toContain("n4");
    expect(ids).not.toContain("n5");
  });

  it("a finished session already listed above shows once", () => {
    const finished = items.flatMap((i) => (i.section === "finished" ? [i.sessionId] : []));
    expect(finished).toEqual(["f2", "f1"]);
  });

  it("the count is the list less its finished turns", () => {
    expect(liteNeedsYouCount(items)).toBe(7);
    expect(liteNeedsYouCount([])).toBe(0);
  });

  it("groups into the page's sections, each only when it holds something", () => {
    expect(liteNeedsSections(items).map((g) => [g.section, g.items.length])).toEqual([
      ["questions", 2], ["handed", 2], ["mentions", 3], ["finished", 2],
    ]);
    const onlyFinished = liteNeedsYouItems({ asks: [], titleOf, handed: [], notifications: [], finished: [{ sessionId: "f", title: "F", project: "p", at: 1 }] });
    expect(liteNeedsSections(onlyFinished).map((g) => g.section)).toEqual(["finished"]);
    expect(liteNeedsYouCount(onlyFinished)).toBe(0);
  });

  it("the mention types are the ones addressed to the person by name", () => {
    for (const t of ["mention", "chat_mention", "comment_reply", "conversation_comment", "chat_dm", "session_assigned", "task_assigned", "decision_passed"]) {
      expect(LITE_MENTION_TYPES.has(t)).toBe(true);
    }
    for (const t of ["session_idle", "chat_post", "team_session_start", "task_status_changed"]) {
      expect(LITE_MENTION_TYPES.has(t)).toBe(false);
    }
  });
});

describe("liteNoticeTarget", () => {
  it("opens a session in Lite", () => {
    expect(liteNoticeTarget(notice("n", "mention", { conversation_id: "abc" }))).toEqual({ href: "/lite/abc", external: false, sessionId: "abc" });
    expect(liteNoticeTarget(notice("n", "conversation_comment", { entity_type: "conversation", entity_id: "xyz" }))).toEqual({ href: "/lite/xyz", external: false, sessionId: "xyz" });
  });

  it("a page Lite does not have opens in the classic app, a page outside the app in a new tab", () => {
    expect(liteNoticeTarget(notice("n", "task_assigned", { entity_type: "task", entity_id: "ct-1", conversation_id: "abc" }))).toEqual({ href: "/tasks/ct-1", external: false, sessionId: null });
    expect(liteNoticeTarget(notice("n", "chat_dm", { entity_type: "chat_channel", entity_id: "c1", chat_message_id: "m1" }))).toEqual({ href: "/chat/c1?m=m1", external: false, sessionId: null });
    expect(liteNoticeTarget(notice("n", "mention", { link: "https://codecast.sh/a/x", conversation_id: "abc" }))?.external).toBe(true);
  });

  it("names nothing to open when the notice names nothing", () => {
    expect(liteNoticeTarget(notice("n", "decision_assigned"))).toBeNull();
  });
});

describe("liteAnswersInline", () => {
  it("a single choice with only option names is answered in the list", () => {
    expect(liteAnswersInline(ask("k", "a"), false)).toBe(true);
  });

  it("anything richer opens its session", () => {
    expect(liteAnswersInline(ask("k", "a", { kind: "multi" }), false)).toBe(false);
    expect(liteAnswersInline(ask("k", "a"), true)).toBe(false);
    expect(liteAnswersInline(ask("k", "a", { contextMd: "Why this matters" }), false)).toBe(false);
    expect(liteAnswersInline(ask("k", "a", { trial: true }), false)).toBe(false);
    expect(liteAnswersInline(ask("k", "a", { options: [{ label: "A", cost: "$4" } as never] }), false)).toBe(false);
    expect(liteAnswersInline(ask("k", "a", { options: [] }), false)).toBe(false);
  });

  it("a terminal question or a permission prompt is never a decision's options", () => {
    expect(liteAnswersInline(ask("k", "a", { source: "ask", decisionId: undefined }), false)).toBe(false);
    expect(liteAnswersInline(ask("k", "a", { source: "permission", decisionId: undefined }), false)).toBe(false);
  });
});

describe("liteNeedsKey", () => {
  it("moves with the arrows and j/k, Home and End", () => {
    expect(liteNeedsKey({ key: "ArrowDown" })).toEqual({ kind: "move", to: "next" });
    expect(liteNeedsKey({ key: "j" })).toEqual({ kind: "move", to: "next" });
    expect(liteNeedsKey({ key: "k" })).toEqual({ kind: "move", to: "prev" });
    expect(liteNeedsKey({ key: "Home" })).toEqual({ kind: "move", to: "first" });
    expect(liteNeedsKey({ key: "End" })).toEqual({ kind: "move", to: "last" });
  });

  it("answers by digit, allows, denies, clears and opens", () => {
    expect(liteNeedsKey({ key: "1" })).toEqual({ kind: "answer", index: 0 });
    expect(liteNeedsKey({ key: "9" })).toEqual({ kind: "answer", index: 8 });
    expect(liteNeedsKey({ key: "0" })).toBeNull();
    expect(liteNeedsKey({ key: "y" })).toEqual({ kind: "allow" });
    expect(liteNeedsKey({ key: "n" })).toEqual({ kind: "deny" });
    expect(liteNeedsKey({ key: "e" })).toEqual({ kind: "clear" });
    expect(liteNeedsKey({ key: "Enter" })).toEqual({ kind: "open" });
  });

  it("leaves a chord to the shortcuts", () => {
    expect(liteNeedsKey({ key: "j", ctrlKey: true })).toBeNull();
    expect(liteNeedsKey({ key: "k", metaKey: true })).toBeNull();
    expect(liteNeedsKey({ key: "1", altKey: true })).toBeNull();
    expect(liteNeedsKey({ key: "x" })).toBeNull();
  });
});
