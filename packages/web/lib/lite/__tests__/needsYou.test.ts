import { describe, expect, it } from "bun:test";
import type { QueueItem } from "../../decisionQueue";
import {
  LITE_DECISION_NOTICE_TYPES,
  LITE_MENTION_TYPES,
  liteAnswersInline,
  liteNeedsActs,
  liteNeedsKey,
  liteNeedsSections,
  liteNeedsYouAttention,
  liteNeedsYouCount,
  liteNeedsYouItems,
  liteNoticeTarget,
  liteStoppedReason,
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
    stopped: [
      { sessionId: "s1", title: "Mobile build", project: "codecast", reason: "Usage limit", detail: null, at: 20 },
      { sessionId: "b", title: "Asking too", project: "codecast", reason: "Signed out", detail: null, at: 30 },
    ],
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
      notice("n7", "decision_passed", { created_at: 80, conversation_id: "a" }),
      notice("n8", "decision_assigned", { created_at: 90, conversation_id: "q" }),
    ],
    finished: [
      { sessionId: "f1", title: "Old", project: "codecast", at: 1 },
      { sessionId: "f2", title: "New", project: "notes", at: 9 },
      { sessionId: "a", title: "Asking", project: "codecast", at: 99 },
      { sessionId: "h2", title: "Docs", project: "codecast", at: 99 },
      { sessionId: "s1", title: "Mobile build", project: "codecast", at: 99 },
    ],
  });

  it("lists questions in the queue's order, then stopped sessions, handoffs, mentions and finished turns, newest first inside each", () => {
    expect(items.map((i) => i.key)).toEqual([
      "ask:k1", "ask:k2",
      "stopped:s1",
      "handed:h2", "handed:h1",
      "notice:n2", "notice:n1",
      "finished:f2", "finished:f1",
    ]);
  });

  it("a stopped session already asking above shows once, under its question", () => {
    const stopped = items.flatMap((i) => (i.section === "stopped" ? [i.sessionId] : []));
    expect(stopped).toEqual(["s1"]);
  });

  it("names each ask's session", () => {
    const first = items[0]!;
    expect(first.section === "questions" && first.title).toBe("Session a");
  });

  it("leaves out read notices, notices not addressed to the person, and the notices of asks listed by their own home", () => {
    const ids = items.flatMap((i) => (i.section === "mentions" ? [i.notificationId] : []));
    expect(ids).not.toContain("n3");
    expect(ids).not.toContain("n4");
    // A handoff's notice, listed or acknowledged elsewhere: assigned_ping is its home.
    expect(ids).not.toContain("n5");
    expect(ids).not.toContain("n6");
    // A decision passed or shared to the person: the queue is its home.
    expect(ids).not.toContain("n7");
    expect(ids).not.toContain("n8");
  });

  it("a finished session already listed above shows once", () => {
    const finished = items.flatMap((i) => (i.section === "finished" ? [i.sessionId] : []));
    expect(finished).toEqual(["f2", "f1"]);
  });

  it("the count is the list less its finished turns", () => {
    expect(liteNeedsYouCount(items)).toBe(7);
    expect(liteNeedsYouCount([])).toBe(0);
  });

  it("the count wears the attention color only while a question or a stopped session is among them", () => {
    expect(liteNeedsYouAttention(items)).toBe(true);
    const quiet = liteNeedsYouItems({ asks: [], titleOf, handed: [], notifications: [notice("m", "mention")], finished: [] });
    expect(liteNeedsYouCount(quiet)).toBe(1);
    expect(liteNeedsYouAttention(quiet)).toBe(false);
    const stoppedOnly = liteNeedsYouItems({ asks: [], titleOf, stopped: [{ sessionId: "s", title: "S", project: "p", reason: "Usage limit", detail: null, at: 1 }], handed: [], notifications: [], finished: [] });
    expect(liteNeedsYouAttention(stoppedOnly)).toBe(true);
  });

  it("groups into the page's sections, each only when it holds something", () => {
    expect(liteNeedsSections(items).map((g) => [g.section, g.items.length])).toEqual([
      ["questions", 2], ["stopped", 1], ["handed", 2], ["mentions", 2], ["finished", 2],
    ]);
    const onlyFinished = liteNeedsYouItems({ asks: [], titleOf, handed: [], notifications: [], finished: [{ sessionId: "f", title: "F", project: "p", at: 1 }] });
    expect(liteNeedsSections(onlyFinished).map((g) => g.section)).toEqual(["finished"]);
    expect(liteNeedsYouCount(onlyFinished)).toBe(0);
  });

  it("the mention types are the ones addressed to the person by name, less the asks with a home of their own", () => {
    for (const t of ["mention", "chat_mention", "comment_reply", "conversation_comment", "chat_dm", "task_assigned", "decision_comment"]) {
      expect(LITE_MENTION_TYPES.has(t)).toBe(true);
    }
    for (const t of ["session_idle", "chat_post", "team_session_start", "task_status_changed", "session_assigned", ...LITE_DECISION_NOTICE_TYPES]) {
      expect(LITE_MENTION_TYPES.has(t)).toBe(false);
    }
  });
});

describe("liteStoppedReason", () => {
  it("says why in a few words, with what fixes it", () => {
    const limit = liteStoppedReason({ pending_api_error: true, pending_api_error_kind: "limit" });
    expect(limit.reason).toBe("Usage limit");
    expect(limit.detail).toContain("Usage limit reached");
    expect(liteStoppedReason({ pending_api_error: true, pending_api_error_kind: "auth", agent_type: "claude_code" }).reason).toBe("Signed out");
    expect(liteStoppedReason({ is_unresponsive: true })).toEqual({ reason: "Not responding", detail: null });
    expect(liteStoppedReason({ pending_api_error: true, pending_api_error_kind: "something_new" })).toEqual({ reason: "Stopped", detail: null });
  });
});

describe("liteNoticeTarget", () => {
  it("opens a session in Lite", () => {
    expect(liteNoticeTarget(notice("n", "mention", { conversation_id: "abc" }))).toEqual({ href: "/lite/abc", external: false, sessionId: "abc" });
    // At the comment it is about.
    expect(liteNoticeTarget(notice("n", "mention", { conversation_id: "abc", comment_id: "c1" }))).toEqual({ href: "/lite/abc?comment=c1", external: false, sessionId: "abc" });
    expect(liteNoticeTarget(notice("n", "conversation_comment", { entity_type: "conversation", entity_id: "xyz" }))).toEqual({ href: "/lite/xyz", external: false, sessionId: "xyz" });
  });

  it("a page Lite does not have opens in the classic app, a page outside the app in a new tab", () => {
    expect(liteNoticeTarget(notice("n", "task_assigned", { entity_type: "task", entity_id: "ct-1", conversation_id: "abc" }))).toEqual({ href: "/tasks/ct-1", external: false, sessionId: null });
    expect(liteNoticeTarget(notice("n", "chat_dm", { entity_type: "chat_channel", entity_id: "c1", chat_message_id: "m1" }))).toEqual({ href: "/chat/c1?m=m1", external: false, sessionId: null });
    expect(liteNoticeTarget(notice("n", "mention", { link: "https://codecast.sh/a/x", conversation_id: "abc" }))?.external).toBe(true);
  });

  it("a link inside the app opens in place, never in a new tab", () => {
    expect(liteNoticeTarget(notice("n", "decision_comment", { link: "/decisions/dc-12", conversation_id: "abc" }))).toEqual({ href: "/decisions/dc-12", external: false, sessionId: null });
    expect(liteNoticeTarget(notice("n", "mention", { link: "/vault?s=x" }))?.external).toBe(false);
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

  it("only an answer, an allow, a deny or a clear writes; a move or an open does not", () => {
    expect(["1", "y", "n", "e"].map((key) => liteNeedsActs(liteNeedsKey({ key })!))).toEqual([true, true, true, true]);
    expect(["j", "Enter", "Home"].map((key) => liteNeedsActs(liteNeedsKey({ key })!))).toEqual([false, false, false]);
  });

  it("leaves a chord to the shortcuts", () => {
    expect(liteNeedsKey({ key: "j", ctrlKey: true })).toBeNull();
    expect(liteNeedsKey({ key: "k", metaKey: true })).toBeNull();
    expect(liteNeedsKey({ key: "1", altKey: true })).toBeNull();
    expect(liteNeedsKey({ key: "x" })).toBeNull();
  });
});
