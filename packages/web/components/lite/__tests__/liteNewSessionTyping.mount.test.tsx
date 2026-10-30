// Lite's new-session box holds the composer's typing budget
// (components/__tests__/composerTypingBudget.mount.test.tsx): once it holds
// text, a keystroke commits React once, writes nothing to the store, changes
// nothing in the DOM tree (its text node included) and reads no layout,
// with a busy account's cache in the store. And a send starts the session
// and opens it in Lite under its stub id.
import { dom, w, restoreGlobals } from "../../__tests__/fixtures/composeDom";
import { afterAll, beforeAll, expect, mock, test } from "bun:test";

mock.module("sonner", () => {
  const noop = () => 1;
  return { toast: Object.assign(noop, { error: noop, info: noop, success: noop, warning: noop, dismiss: () => {}, loading: noop, custom: noop, promise: (p: any) => p }), Toaster: () => null };
});
import { act, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { MemoryRouter, useLocation } from "react-router";
import { useInboxStore } from "../../../store/inboxStore";
import { closeDomWindow } from "../../../test-helpers/domGlobals";
import { offlineConvexClient } from "../../../test-helpers/offlineConvex";

afterAll(() => {
  closeDomWindow(dom);
  restoreGlobals();
});

const SESSIONS = 7000;
const KEYS = 30;

function fakeConvex() {
  const client = offlineConvexClient("https://example.convex.cloud");
  (client as any).mutation = async () => null;
  (client as any).query = async () => null;
  (client as any).watchQuery = () => ({ onUpdate: () => () => {}, localQueryResult: () => undefined, localQueryLogs: () => undefined, journal: () => undefined });
  return client;
}

function syntheticSessions(n: number): Record<string, any> {
  const out: Record<string, any> = {};
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const id = `jx7${String(i).padStart(29, "0")}`;
    out[id] = { _id: id, session_id: `s-${i}`, title: `Session ${i}`, user_id: "user_lite_typing", agent_type: "claude_code", status: i % 9 ? "completed" : "active", is_idle: i % 9 !== 0, message_count: 20 + (i % 50), updated_at: now - i * 60_000, started_at: now - i * 120_000, project_path: `/src/p${i % 40}` };
  }
  return out;
}

(globalThis as any).CSS = { supports: (prop: string) => prop === "field-sizing" };
// The box takes focus on mount. When react-dom loaded before this file's DOM
// it falls back to the old-IE input polyfill on focus; give that path the
// two methods it calls (the keystrokes below drive React's handlers directly).
(w.HTMLElement.prototype as any).attachEvent ??= () => {};
(w.HTMLElement.prototype as any).detachEvent ??= () => {};

const LAYOUT_GETTERS: Array<[any, string]> = [
  [w.HTMLElement.prototype, "offsetWidth"], [w.HTMLElement.prototype, "offsetHeight"],
  [w.Element.prototype, "clientWidth"], [w.Element.prototype, "clientHeight"],
  [w.Element.prototype, "scrollWidth"], [w.Element.prototype, "scrollHeight"],
];
let layoutReads: string[] = [];
const readSite = (name: string) => `${name} ${new Error().stack!.split("\n").find((l) => l.includes("/packages/web/") && !l.includes("__tests__"))?.trim() ?? "?"}`;
for (const [proto, name] of LAYOUT_GETTERS) {
  const desc = Object.getOwnPropertyDescriptor(proto, name)!;
  Object.defineProperty(proto, name, { ...desc, get() { layoutReads.push(readSite(name)); return desc.get!.call(this); } });
}
for (const [owner, name] of [[w.Element.prototype, "getBoundingClientRect"], [w, "getComputedStyle"], [globalThis, "getComputedStyle"]] as Array<[any, string]>) {
  const real = owner[name];
  owner[name] = function (this: unknown, ...args: unknown[]) { layoutReads.push(readSite(name)); return real.apply(this, args); };
}

type Tally = { commits: number; storeWrites: number; outsideMutations: string[]; layoutReads: string[] };
let measure: (fn: () => void) => Promise<Tally>;
let totalCommits = 0;
let textarea: HTMLTextAreaElement;
let container: HTMLElement;
let path = "";

function Where() {
  path = useLocation().pathname;
  return null;
}

beforeAll(async () => {
  (useInboxStore.getState() as any)._setDispatch(async () => undefined);
  useInboxStore.setState({ sessions: syntheticSessions(SESSIONS), conversations: {}, pendingMessages: {}, drafts: {}, currentUser: { _id: "user_lite_typing", name: "Typist" }, recentProjects: [{ path: "/src/p1", count: 3, lastActive: Date.now() }] } as any);
  const { LiteNewSession } = await import("../thread/LiteNewSession");
  container = w.document.createElement("div");
  w.document.body.appendChild(container);
  let commits = 0;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ConvexProvider client={fakeConvex()}>
        <MemoryRouter initialEntries={["/lite"]}>
          <Where />
          <Profiler id="hero" onRender={() => { commits++; totalCommits++; }}>
            <LiteNewSession />
          </Profiler>
        </MemoryRouter>
      </ConvexProvider>,
    );
  });
  for (let i = 0; i < 400 && !useInboxStore.getState().clientStateInitialized; i++) await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  textarea = container.querySelector("textarea") as HTMLTextAreaElement;
  measure = async (fn) => {
    commits = 0;
    let storeWrites = 0;
    const unsub = useInboxStore.subscribe(() => { storeWrites++; });
    const outsideMutations: string[] = [];
    const record = (records: MutationRecord[]) => {
      for (const r of records) {
        const target = r.target as Node;
        const el = (target.nodeType === 1 ? target : target.parentNode) as Element;
        outsideMutations.push(`${r.type}${r.attributeName ? `:${r.attributeName}` : ""} on <${el?.tagName?.toLowerCase()} class="${String(el?.getAttribute?.("class") ?? "").slice(0, 60)}">`);
      }
    };
    const mo = new w.MutationObserver(record);
    mo.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
    layoutReads = [];
    await act(async () => { fn(); });
    const reads = layoutReads;
    record(mo.takeRecords());
    mo.disconnect();
    unsub();
    return { commits, storeWrites, outsideMutations, layoutReads: reads };
  };
});

async function settle() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const before = totalCommits;
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    if (totalCommits === before) return;
  }
}

const reactProps = (el: Element) => (el as any)[Object.keys(el).find((k) => k.startsWith("__reactProps"))!];

function typeChar(ch: string) {
  const props = reactProps(textarea);
  props.onKeyDown?.({ key: ch, shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {} });
  Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, textarea.value + ch);
  props.onChange?.({ target: textarea, currentTarget: textarea, nativeEvent: new w.Event("input") });
}

test("a keystroke into the box commits once, writes nothing to the store, changes nothing in the DOM tree, and reads no layout", async () => {
  expect(textarea).toBeTruthy();
  // The first character turns send on (one attribute); then the budget.
  await measure(() => typeChar("h"));
  await settle();
  const text = "ello, fix the flaky retry test in the webhook worker".slice(0, KEYS);
  let worstCommits = 0;
  let storeWrites = 0;
  const outside = new Set<string>();
  const reads = new Set<string>();
  for (const ch of text) {
    const t = await measure(() => typeChar(ch));
    worstCommits = Math.max(worstCommits, t.commits);
    storeWrites += t.storeWrites;
    for (const m of t.outsideMutations) outside.add(m);
    for (const r of t.layoutReads) reads.add(r);
  }
  expect(textarea.value.startsWith("hello, fix")).toBe(true);
  expect({ worstCommitsPerKey: worstCommits }).toEqual({ worstCommitsPerKey: 1 });
  expect({ storeWritesWhileTyping: storeWrites }).toEqual({ storeWritesWhileTyping: 0 });
  expect([...outside]).toEqual([]);
  expect({ layoutReadsWhileTyping: [...reads] }).toEqual({ layoutReadsWhileTyping: [] });
});

test("Enter starts the session in the picked folder and opens it in Lite under its stub id", async () => {
  const before = new Set(Object.keys(useInboxStore.getState().sessions));
  await act(async () => {
    reactProps(textarea).onKeyDown?.({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {} });
  });
  const stubId = Object.keys(useInboxStore.getState().sessions).find((id) => !before.has(id));
  expect(stubId).toBeTruthy();
  expect(useInboxStore.getState().sessions[stubId!].project_path).toBe("/src/p1");
  expect(path).toBe(`/lite/${stubId}`);
  const bubble = (useInboxStore.getState().pendingMessages[stubId!] ?? [])[0];
  expect(bubble?.content).toStartWith("hello, fix");
  expect(textarea.value).toBe("");
});
