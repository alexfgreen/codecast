// A session's changes reach the diff viewer store: the server's index merged
// with what the loaded messages say, the conversation's own each time, and
// an unchanged list (a streamed reply re-extracting the same edits) never
// handed back as a new one.

import type { Root } from "react-dom/client";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { replaceGlobals } from "../../test-helpers/globals";
import { closeDomWindow } from "../../test-helpers/domGlobals";
import type { FileChangeRef } from "../../lib/fileChangeExtractor";

let index: FileChangeRef[] | undefined;
const asked: unknown[] = [];
const realNoThrow = await import("../useQueryNoThrow");
mock.module("../useQueryNoThrow", () => ({
  ...realNoThrow,
  useQueryNoThrow: (_query: unknown, args: unknown) => {
    asked.push(args);
    return { data: args === "skip" ? undefined : index, error: undefined, retry: () => {} };
  },
}));

// The stores load before the DOM does, so the inbox store boots without a
// window and never tries to hydrate from IndexedDB.
const { useDiffViewerStore } = await import("../../store/diffViewerStore");
const { sameChangeEntries, sessionChangeEntries, useSessionFileChanges } = await import("../useSessionFileChanges");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
const restoreGlobals = replaceGlobals({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");

afterAll(() => {
  mock.module("../useQueryNoThrow", () => realNoThrow);
  closeDomWindow(dom);
  restoreGlobals();
});

// Convex-shaped ids, so the hook subscribes.
const A = "j57a7h3q8m9w2x4c6v1b0n5z3k8d2f6g";
const B = "j57b7h3q8m9w2x4c6v1b0n5z3k8d2f6g";

const edit = (id: string, file: string, ts: number, oldStr: string, newStr: string) => ({
  _id: id,
  timestamp: ts,
  tool_calls: [{ id: `tc-${id}`, name: "Edit", input: JSON.stringify({ file_path: file, old_string: oldStr, new_string: newStr }) }],
});
const ref = (id: string, file: string, seq: number): FileChangeRef => ({
  id, sequenceIndex: seq, messageId: "srv", filePath: file, changeType: "write", timestamp: seq, newBytes: 4,
});

let root: Root;
let settled: boolean | undefined;
function Probe({ id, messages }: { id: string | undefined; messages: any[] }) {
  settled = useSessionFileChanges(id, messages).indexSettled;
  return null;
}
async function render(id: string | undefined, messages: any[]) {
  await act(async () => root.render(<Probe id={id} messages={messages} />));
}

describe("useSessionFileChanges", () => {
  beforeEach(() => {
    index = undefined;
    asked.length = 0;
    useDiffViewerStore.setState({ conversationId: null, changes: [], bodies: {}, missingBodies: {} });
    root = createRoot(dom.window.document.body.appendChild(dom.window.document.createElement("div")));
  });

  test("the loaded messages fill the store before the index answers, their text seeding the bodies", async () => {
    const messages = [edit("m1", "/r/a.ts", 10, "x", "y")];
    await render(A, messages);
    const dv = useDiffViewerStore.getState();
    expect(dv.conversationId).toBe(A);
    expect(dv.changes.map((c) => c.filePath)).toEqual(["/r/a.ts"]);
    expect(dv.bodies[dv.changes[0].id]?.newContent).toBe("y");
    expect(settled).toBe(false);
  });

  test("the index joins the client's changes, in order, and settles", async () => {
    const messages = [edit("m1", "/r/a.ts", 10, "x", "y")];
    await render(A, messages);
    index = [ref("srv-1", "/r/old.ts", 1)];
    await render(A, [...messages]);
    expect(useDiffViewerStore.getState().changes.map((c) => c.filePath)).toEqual(["/r/old.ts", "/r/a.ts"]);
    expect(settled).toBe(true);
  });

  test("an equal list leaves the store's list as it was", async () => {
    index = [ref("srv-1", "/r/old.ts", 1)];
    await render(A, [edit("m1", "/r/a.ts", 10, "x", "y")]);
    const before = useDiffViewerStore.getState().changes;
    const beforeBodies = useDiffViewerStore.getState().bodies;
    // A new array of equal messages, as a streaming tick hands it.
    await render(A, [edit("m1", "/r/a.ts", 10, "x", "y")]);
    expect(useDiffViewerStore.getState().changes).toBe(before);
    expect(useDiffViewerStore.getState().bodies).toBe(beforeBodies);
    // A real change replaces it.
    await render(A, [edit("m1", "/r/a.ts", 10, "x", "y"), edit("m2", "/r/b.ts", 11, "p", "q")]);
    expect(useDiffViewerStore.getState().changes).not.toBe(before);
    expect(useDiffViewerStore.getState().changes.map((c) => c.filePath)).toEqual(["/r/old.ts", "/r/a.ts", "/r/b.ts"]);
  });

  test("another session takes the store over, its bodies starting empty", async () => {
    await render(A, [edit("m1", "/r/a.ts", 10, "x", "y")]);
    useDiffViewerStore.getState().addBodies(A, [{ id: "srv-x", newContent: "fetched" }]);
    await render(B, []);
    const dv = useDiffViewerStore.getState();
    expect(dv.conversationId).toBe(B);
    expect(dv.changes).toEqual([]);
    expect(dv.bodies["srv-x"]).toBeUndefined();
  });

  test("an id the server cannot know is never asked about, and counts as settled", async () => {
    await render("local-stub", [edit("m1", "/r/a.ts", 10, "x", "y")]);
    expect(asked.every((a) => a === "skip")).toBe(true);
    expect(settled).toBe(true);
    expect(useDiffViewerStore.getState().changes.length).toBe(1);
  });
});

describe("sessionChangeEntries / sameChangeEntries", () => {
  test("merge sorts by time and renumbers", () => {
    const merged = sessionChangeEntries([ref("s", "/r/z.ts", 5)], [edit("m1", "/r/a.ts", 1, "x", "y")]);
    expect(merged.map((c) => [c.filePath, c.sequenceIndex])).toEqual([["/r/a.ts", 0], ["/r/z.ts", 1]]);
  });

  test("equal field by field, different on any field a fold reads", () => {
    const a = sessionChangeEntries(undefined, [edit("m1", "/r/a.ts", 1, "x", "y")]);
    const b = sessionChangeEntries(undefined, [edit("m1", "/r/a.ts", 1, "x", "y")]);
    expect(a[0]).not.toBe(b[0]);
    expect(sameChangeEntries(a, b)).toBe(true);
    const c = sessionChangeEntries(undefined, [edit("m1", "/r/a.ts", 1, "x", "z")]);
    expect(sameChangeEntries(a, c)).toBe(false);
    expect(sameChangeEntries(a, [])).toBe(false);
  });
});
