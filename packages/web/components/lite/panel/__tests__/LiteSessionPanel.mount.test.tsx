// The session panel a person opens: the files the session changed with their
// counts, a diff that opens under its row, a place held for a file still on
// its way, the session's commits, a Task tab only when the session works a
// task, and an edit row's "open in changes" landing on its file.

import type { Root } from "react-dom/client";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, useState } from "react";
import { JSDOM } from "jsdom";
import { MemoryRouter } from "react-router";
import { getFunctionName } from "convex/server";
import { replaceGlobals } from "../../../../test-helpers/globals";
import { closeDomWindow } from "../../../../test-helpers/domGlobals";
import { useInboxStore } from "../../../../store/inboxStore";
import { useDiffViewerStore } from "../../../../store/diffViewerStore";
import { LiteLayoutCtx, type LiteLayoutState, type LiteRightPanelTab } from "../../../../lib/lite/liteLayout";
import type { FileChangeRef } from "../../../../lib/fileChangeExtractor";

let index: FileChangeRef[] | undefined;
let gitDiff: { git_diff: string | null; git_diff_staged: string | null } | null | undefined;
const realNoThrow = await import("../../../../hooks/useQueryNoThrow");
mock.module("../../../../hooks/useQueryNoThrow", () => ({
  ...realNoThrow,
  useQueryNoThrow: (query: any, args: unknown) => {
    const name = getFunctionName(query);
    const data = args === "skip" ? undefined
      : name === "messages:getConversationFileChangeIndex" ? index
      : name === "conversations:getConversationGitDiff" ? gitDiff
      : undefined;
    return { data, error: undefined, retry: () => {} };
  },
}));
let commits: any[] = [];
const realTimeline = await import("../../../../hooks/useSyncTimeline");
mock.module("../../../../hooks/useSyncTimeline", () => ({
  ...realTimeline,
  useSyncConversationCommits: () => undefined,
  useConversationCommits: () => commits,
}));

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://codecast.sh/lite" });
const scrolled: string[] = [];
dom.window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
  scrolled.push(this.querySelector("button")?.getAttribute("title") ?? "");
};
const restoreGlobals = replaceGlobals({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  Event: dom.window.Event,
  KeyboardEvent: dom.window.KeyboardEvent,
  MutationObserver: dom.window.MutationObserver,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
const { LiteSessionPanel } = await import("../LiteSessionPanel");

afterAll(() => {
  mock.module("../../../../hooks/useQueryNoThrow", () => realNoThrow);
  mock.module("../../../../hooks/useSyncTimeline", () => realTimeline);
  closeDomWindow(dom);
  restoreGlobals();
});

const ID = "j57a7h3q8m9w2x4c6v1b0n5z3k8d2f6g";
const ROOT = "/w/app";
const edit = (id: string, file: string, ts: number, oldStr: string, newStr: string) => ({
  _id: id,
  role: "assistant",
  timestamp: ts,
  tool_calls: [{ id: `tc-${id}`, name: "Edit", input: JSON.stringify({ file_path: file, old_string: oldStr, new_string: newStr }) }],
});
const prompt = (id: string, ts: number) => ({ _id: id, role: "user", content: "next step please", timestamp: ts });
const TASK = { _id: "task1", short_id: "ct-7", title: "Fix the auth race", status: "in_progress" };

let frame: { setFocus: (file: string) => void; setTab: (t: LiteRightPanelTab) => void };
let slot: HTMLElement;
function Harness() {
  const [tab, setTab] = useState<LiteRightPanelTab>("changes");
  const [focus, setFocusState] = useState<{ file: string; nonce: number } | null>(null);
  const setFocus = (file: string) => setFocusState((prev) => ({ file, nonce: (prev?.nonce ?? 0) + 1 }));
  frame = { setFocus, setTab };
  const noop = () => {};
  const value: LiteLayoutState = {
    isPhone: false, sidebarOpen: true, setSidebarOpen: noop, toggleSidebar: noop,
    rightPanelOpen: true, setRightPanelOpen: noop, toggleRightPanel: noop, rightPanelSheet: false,
    paletteOpen: false, setPaletteOpen: noop, togglePalette: noop,
    rightPanelHost: slot, rightPanelTab: tab, setRightPanelTab: setTab, rightPanelFocus: focus,
    openRightPanel: (t, opts) => { setTab(t); if (opts?.file) setFocus(opts.file); },
  };
  return (
    <MemoryRouter>
      <LiteLayoutCtx.Provider value={value}>
        <LiteSessionPanel sessionId={ID} />
      </LiteLayoutCtx.Provider>
    </MemoryRouter>
  );
}

let root: Root;
async function mount(session: Record<string, unknown>, messages: any[]) {
  useInboxStore.setState((s: any) => ({
    sessions: { ...s.sessions, [ID]: { _id: ID, session_id: "s1", git_root: ROOT, ...session } },
    messages: { ...s.messages, [ID]: messages },
  }));
  slot = document.body.appendChild(document.createElement("aside"));
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
}
const rows = () => [...slot.querySelectorAll<HTMLButtonElement>("button.lt-file-row")];
const text = () => slot.textContent ?? "";
const click = (el: Element) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

describe("the session panel", () => {
  beforeEach(async () => {
    if (root) await act(async () => root.unmount());
    document.body.innerHTML = "";
    index = [];
    gitDiff = undefined;
    commits = [];
    scrolled.length = 0;
    useDiffViewerStore.setState({ conversationId: null, changes: [], bodies: {}, missingBodies: {} });
  });

  test("lists each changed file with its counts and the tally, and no tab strip without a task", async () => {
    await mount({}, [edit("m1", `${ROOT}/src/auth.ts`, 10, "a\nb", "a\nc\nd"), edit("m2", `${ROOT}/lib/lock.ts`, 20, "x", "y")]);
    expect(slot.querySelector("[role=tablist]")).toBeNull();
    expect(slot.querySelector(".lt-panel-head")?.textContent).toContain("Changes");
    expect(rows().map((r) => r.title)).toEqual([`${ROOT}/lib/lock.ts`, `${ROOT}/src/auth.ts`]);
    // Paths read relative to the repository, the folder apart from the name.
    expect(rows()[1].querySelector(".lt-path-dir")?.textContent).toBe("src/");
    expect(rows()[1].querySelector(".lt-path-base")?.textContent).toBe("auth.ts");
    expect(rows()[1].querySelector(".lt-file-status")?.textContent).toBe("M");
    expect(slot.querySelector(".lt-diff-sum")?.textContent).toBe("2 files+3−2");
  });

  test("a row opens its diff in place and closes again", async () => {
    await mount({}, [edit("m1", `${ROOT}/src/auth.ts`, 10, "a", "b")]);
    const [row] = rows();
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(slot.querySelector(".lt-file-diff")).not.toBeNull();
    await click(row);
    expect(slot.querySelector(".lt-file-diff")).toBeNull();
  });

  test("a file whose text is still on its way holds a place, and nothing changed reads as one line", async () => {
    index = [{ id: "srv-1", sequenceIndex: 0, messageId: "srv", filePath: `${ROOT}/big.ts`, changeType: "write", timestamp: 1, newBytes: 9000 }];
    await mount({}, []);
    expect(slot.querySelector(".lt-file[aria-busy=true]")?.textContent).toContain("big.ts");
    expect(slot.querySelector(".lt-diff-sum")?.textContent).toContain("1 file");

    await act(async () => root.unmount());
    document.body.innerHTML = "";
    index = [];
    useDiffViewerStore.setState({ conversationId: null, changes: [], bodies: {}, missingBodies: {} });
    await mount({}, []);
    expect(text()).toContain("No changes yet");
    expect(rows()).toEqual([]);
  });

  test("the session's commits follow its files, newest first, each opening its commit", async () => {
    commits = [
      { _id: "c2", sha: "bbbbbbbbbbbb", message: "fix: lock the refresh\n\nbody", repository: "acme/app", timestamp: 2 },
      { _id: "c1", sha: "aaaaaaaaaaaa", message: "chore: first", timestamp: 1 },
    ];
    await mount({}, [edit("m1", `${ROOT}/src/auth.ts`, 10, "a", "b")]);
    const shown = [...slot.querySelectorAll(".lt-commit")];
    expect(shown.map((c) => c.textContent)).toEqual(["bbbbbbbfix: lock the refresh", "aaaaaaachore: first"]);
    expect(shown[0].getAttribute("href")).toBe("/commit/acme/app/bbbbbbbbbbbb");
    expect(shown[1].tagName).toBe("DIV");
  });

  test("a session working a task gets the Task tab: its title, id, and the way to the full task", async () => {
    await mount({ active_task: TASK }, [edit("m1", `${ROOT}/src/auth.ts`, 10, "a", "b")]);
    const tabs = [...slot.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    expect(tabs.map((t) => [t.textContent, t.getAttribute("aria-selected")])).toEqual([["Changes", "true"], ["Task", "false"]]);
    await click(tabs[1]);
    expect(slot.querySelector(".lt-task-title")?.textContent).toBe("Fix the auth race");
    expect(slot.querySelector(".lt-task-id")?.textContent).toBe("ct-7");
    expect(slot.querySelector<HTMLAnchorElement>(".lt-task a.lt-btn")?.getAttribute("href")).toBe("/tasks/ct-7");
    expect(rows()).toEqual([]);
  });

  test("arrow keys move between the tabs", async () => {
    await mount({ active_task: TASK }, []);
    const list = slot.querySelector("[role=tablist]")!;
    await act(async () => { list.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(slot.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Task");
  });

  test("open in changes switches to the tab, opens the file and brings it into view, once", async () => {
    await mount({ active_task: TASK }, [edit("m1", `${ROOT}/src/auth.ts`, 10, "a", "b"), edit("m2", `${ROOT}/lib/lock.ts`, 20, "x", "y")]);
    await act(async () => frame.setTab("task"));
    await act(async () => { frame.setTab("changes"); frame.setFocus(`${ROOT}/src/auth.ts`); });
    const auth = rows().find((r) => r.title.endsWith("auth.ts"))!;
    expect(auth.getAttribute("aria-expanded")).toBe("true");
    expect(scrolled).toEqual([`${ROOT}/src/auth.ts`]);
    // Closing it and re-rendering does not reopen it: that ask was answered.
    await click(auth);
    await act(async () => frame.setTab("changes"));
    expect(auth.getAttribute("aria-expanded")).toBe("false");
    expect(scrolled.length).toBe(1);
  });

  test("a file asked for while the Task tab shows brings the changes tab back", async () => {
    await mount({ active_task: TASK }, [edit("m1", `${ROOT}/src/auth.ts`, 10, "a", "b")]);
    await act(async () => frame.setTab("task"));
    expect(slot.querySelector(".lt-task")).not.toBeNull();
    await act(async () => frame.setFocus(`${ROOT}/src/auth.ts`));
    expect(slot.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Changes");
    expect(rows()[0].getAttribute("aria-expanded")).toBe("true");
  });

  test("a file outside the last turn sends the tab to the whole session", async () => {
    dom.window.localStorage.setItem("codecast.lite.diffScope", JSON.stringify("turn"));
    try {
      await mount({}, [edit("m1", `${ROOT}/src/auth.ts`, 10, "a", "b"), prompt("u1", 15), edit("m2", `${ROOT}/lib/lock.ts`, 20, "x", "y")]);
      expect(slot.querySelector(".lt-scope")?.textContent).toBe("Last turn");
      expect(rows().map((r) => r.title)).toEqual([`${ROOT}/lib/lock.ts`]);
      await act(async () => frame.setFocus("src/auth.ts"));
      expect(slot.querySelector(".lt-scope")?.textContent).toBe("Session");
      expect(rows().find((r) => r.title.endsWith("auth.ts"))?.getAttribute("aria-expanded")).toBe("true");
    } finally {
      dom.window.localStorage.removeItem("codecast.lite.diffScope");
    }
  });

  test("uncommitted reads the working tree's diff, staged first", async () => {
    dom.window.localStorage.setItem("codecast.lite.diffScope", JSON.stringify("uncommitted"));
    try {
      gitDiff = {
        git_diff: ["diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-a", "+b"].join("\n"),
        git_diff_staged: ["diff --git a/src/s.ts b/src/s.ts", "--- a/src/s.ts", "+++ b/src/s.ts", "@@ -1 +1,2 @@", " a", "+b"].join("\n"),
      };
      await mount({}, []);
      expect(rows().map((r) => [r.title, r.querySelector(".lt-file-tag")?.textContent ?? ""])).toEqual([["src/s.ts", "staged"], ["src/a.ts", ""]]);
      expect(slot.querySelector(".lt-commits")).toBeNull();
    } finally {
      dom.window.localStorage.removeItem("codecast.lite.diffScope");
    }
  });
});
