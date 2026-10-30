import { describe, expect, it } from "bun:test";
import { isInboxRoute, isInboxSessionView, liteNavigationTarget, liteSessionIdFromPath, liteSessionPath, pageOwnsRailHighlight, railPointerOnNavigate, resolveSessionSelectKind, sessionFocusKind } from "../inboxRouting";

describe("inboxRouting", () => {
  it("detects real inbox routes", () => {
    expect(isInboxRoute("/inbox")).toBe(true);
    expect(isInboxRoute("/inbox/team")).toBe(true);
    expect(isInboxRoute("/conversation/abc")).toBe(false);
  });

  it("keeps inbox-backed conversation views separate from real inbox routes", () => {
    expect(isInboxRoute("/conversation/abc")).toBe(false);
    expect(isInboxSessionView("/conversation/abc", "inbox")).toBe(true);
    expect(isInboxSessionView("/conversation/abc", "sessions")).toBe(false);
  });
});

// The decision queue writes the rail pointer itself; the layout's
// leave-the-inbox carry-over must not overwrite it (it did: the queue's effect
// commits first, the layout's default landed on top, and the rail highlighted
// the inbox's conversation instead of the question).
describe("pageOwnsRailHighlight", () => {
  it("is the Decisions page, and nothing else", () => {
    expect(pageOwnsRailHighlight("/decisions")).toBe(true);
    expect(pageOwnsRailHighlight("/decisions/sd-4")).toBe(false);
    expect(pageOwnsRailHighlight("/inbox")).toBe(false);
    expect(pageOwnsRailHighlight("/tasks")).toBe(false);
    expect(pageOwnsRailHighlight("/conversation/abc")).toBe(false);
    expect(pageOwnsRailHighlight(null)).toBe(false);
    expect(pageOwnsRailHighlight(undefined)).toBe(false);
  });
});

// Regression: opening /tasks (or any page with no conversation on the stage)
// left a session row lit in the rail, because leaving the inbox copied the
// attended conversation into the rail pointer and leaving a conversation page
// copied the session you had just left. A lit row reads as "this session is
// open" when nothing is.
describe("railPointerOnNavigate", () => {
  it("clears the pointer on pages that show no conversation", () => {
    expect(railPointerOnNavigate("/tasks")).toBe("clear");
    expect(railPointerOnNavigate("/docs")).toBe("clear");
    expect(railPointerOnNavigate("/plans")).toBe("clear");
    expect(railPointerOnNavigate("/org")).toBe("clear");
  });

  it("keeps it where the surface highlights its own pointer", () => {
    expect(railPointerOnNavigate("/inbox")).toBe("keep");
    expect(railPointerOnNavigate("/conversation/abc")).toBe("keep");
    expect(railPointerOnNavigate("/conversation/abc", "inbox")).toBe("keep");
  });

  it("leaves the Decisions page alone: its stepper publishes the pointer itself", () => {
    expect(railPointerOnNavigate("/decisions")).toBe("keep");
  });
});

describe("resolveSessionSelectKind", () => {
  it("promotes to the stage (leave) on plain pages with no working surface", () => {
    expect(resolveSessionSelectKind({
      isOnSettingsPage: false, isOnInboxPage: false,
    })).toBe("leave");
  });

  // A working page (tasks/docs/plans) is no different: a click takes the
  // conversation to the stage. Side by side is a drag, never a click.
  it("leaves the page on a working surface too", () => {
    expect(resolveSessionSelectKind({
      isOnSettingsPage: false, isOnInboxPage: false,
    })).toBe("leave");
  });

  it("selects in place on the inbox", () => {
    expect(resolveSessionSelectKind({
      isOnSettingsPage: false, isOnInboxPage: true,
    })).toBe("inboxInPlace");
  });

  // Regression: in Settings the tab-aware pathname reports the carried "/inbox"
  // tab, so isOnInboxPage is spuriously true. Settings must still win and leave
  // the page — otherwise clicking a session selects in place and you stay stuck
  // in Settings (the reported bug).
  it("leaves Settings even when isOnInboxPage is spuriously true", () => {
    expect(resolveSessionSelectKind({
      isOnSettingsPage: true, isOnInboxPage: true,
    })).toBe("leave");
  });
});

// Codecast Lite's addresses: /lite/<id> opens one session, and its own pages
// (home, Needs you, Team) open none. None of them is a classic inbox route or
// conversation page, so the classic rail's rules leave them alone.
describe("Codecast Lite paths", () => {
  it("reads the session from /lite/<id> only", () => {
    expect(liteSessionIdFromPath("/lite/jx7abc")).toBe("jx7abc");
    expect(liteSessionIdFromPath("/lite/jx7abc/")).toBe("jx7abc");
    expect(liteSessionIdFromPath("/lite/jx7abc?x=1#m")).toBe("jx7abc");
    for (const p of ["/lite", "/lite/", "/lite/needs-you", "/lite/team", "/lite/jx7abc/diff", "/conversation/jx7abc", "/inbox", "/literal/x", null, undefined]) {
      expect({ p, id: liteSessionIdFromPath(p) }).toEqual({ p, id: null });
    }
  });

  it("builds the address it reads back", () => {
    expect(liteSessionPath("jx7abc")).toBe("/lite/jx7abc");
    expect(liteSessionIdFromPath(liteSessionPath("stub-1"))).toBe("stub-1");
  });

  it("leads a reused component's classic session addresses to Lite, and nothing else", () => {
    expect(liteNavigationTarget("/conversation/jx7abc")).toBe("/lite/jx7abc");
    expect(liteNavigationTarget("/conversation/jx7abc#msg-m1")).toBe("/lite/jx7abc#msg-m1");
    expect(liteNavigationTarget("/conversation/jx7abc?share=tok")).toBe("/lite/jx7abc?share=tok");
    expect(liteNavigationTarget("/conversation/jx7abc/diff")).toBe("/lite/jx7abc");
    expect(liteNavigationTarget("/inbox?s=jx7abc")).toBe("/lite/jx7abc");
    expect(liteNavigationTarget("/inbox?s=jx7abc&m=m1")).toBe("/lite/jx7abc?m=m1");
    expect(liteNavigationTarget("/inbox")).toBe("/lite");
    for (const p of ["/tasks/ct-1", "/lite/needs-you", "/docs?x=1", "/inboxes", "#top", "https://example.com/conversation/x", "//evil.example/inbox"]) {
      expect({ p, to: liteNavigationTarget(p) }).toEqual({ p, to: p });
    }
  });

  it("is no inbox route or conversation page to the classic rail", () => {
    expect(isInboxRoute("/lite/jx7abc")).toBe(false);
    expect(sessionFocusKind("/lite/jx7abc")).toBe("panel");
  });
});
