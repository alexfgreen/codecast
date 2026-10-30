// Lite's session page holds the composer's typing budget
// (components/__tests__/composerTypingBudget.mount.test.tsx) with its thread
// beside it: once the box holds text, a keystroke commits the composer once
// and the thread never, writes nothing to the store, changes nothing in the
// DOM tree (the thread's rows and the box's text node included) and reads no
// layout, with a busy account's cache in the store and a transcript in the
// virtual list. The pairing is what this holds: Lite's restyled frame around
// MessageInput, its `:focus-within` rule, and the rows the list keeps placed.
import { dom, w, restoreGlobals } from "../../__tests__/fixtures/composeDom";
import { afterAll, beforeAll, expect, mock, test } from "bun:test";

mock.module("sonner", () => {
  const noop = () => 1;
  return { toast: Object.assign(noop, { error: noop, info: noop, success: noop, warning: noop, dismiss: () => {}, loading: noop, custom: noop, promise: (p: any) => p }), Toaster: () => null };
});
// The draft save runs on a pause (300ms debounce), not per key: held here so
// a slow test keystroke cannot let it fire mid-burst.
const realDraftWrites = await import("../../../lib/pendingDraftWrites");
mock.module("../../../lib/pendingDraftWrites", () => ({ ...realDraftWrites, scheduleDraftWrite: () => {} }));
// The thread's data hook, answered from the fixture: its feeders (Convex,
// IDB) are not what this test holds. Its other exports stay real.
const SESSION = "jx70000000000000000000000litetyp"; // 32 chars => isConvexId
const T0 = 1_800_000_000_000;
const transcript: any[] = [];
for (let i = 0; i < 40; i++) {
  const call = { id: `c${i}`, name: i % 2 ? "Bash" : "Read", input: JSON.stringify(i % 2 ? { command: `bun test ${i}` } : { file_path: `/repo/src/f${i}.ts` }) };
  transcript.push(
    { _id: `p${i}`, role: "user", content: `prompt ${i}: fix the flaky retry test in the webhook worker`, timestamp: T0 + i * 60_000 },
    { _id: `a${i}`, role: "assistant", content: "", timestamp: T0 + i * 60_000 + 1000, tool_calls: [call] },
    { _id: `r${i}`, role: "user", content: "", timestamp: T0 + i * 60_000 + 2000, tool_results: [{ tool_use_id: call.id, content: "ok" }] },
    { _id: `t${i}`, role: "assistant", content: `Done with step ${i}; the retry worker no longer races.`, timestamp: T0 + i * 60_000 + 30_000 },
  );
}
const realConversationMessages = await import("../../../hooks/useConversationMessages");
const conversation = { _id: SESSION, agent_type: "claude_code", status: "active", messages: transcript };
const hookResult = { conversation, hasMoreAbove: false, isLoadingOlder: false, loadOlder: () => {} };
mock.module("../../../hooks/useConversationMessages", () => ({ ...realConversationMessages, useConversationMessages: () => hookResult }));

import { act, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { useInboxStore } from "../../../store/inboxStore";
import { closeDomWindow } from "../../../test-helpers/domGlobals";
import { offlineConvexClient } from "../../../test-helpers/offlineConvex";

afterAll(() => {
  mock.module("../../../lib/pendingDraftWrites", () => realDraftWrites);
  mock.module("../../../hooks/useConversationMessages", () => realConversationMessages);
  closeDomWindow(dom);
  restoreGlobals();
});

const SESSIONS = 7000;
const KEYS = 30;
const ME = "user_lite_session_typing";

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
    out[id] = { _id: id, session_id: `s-${i}`, title: `Session ${i}`, user_id: ME, agent_type: "claude_code", status: i % 9 ? "completed" : "active", is_idle: i % 9 !== 0, message_count: 20 + (i % 50), updated_at: now - i * 60_000, started_at: now - i * 120_000, project_path: `/src/p${i % 40}` };
  }
  out[SESSION] = { _id: SESSION, session_id: "s-litetyp", title: "Lite typing", user_id: ME, agent_type: "claude_code", status: "active", is_idle: true, agent_status: "idle", message_count: transcript.length, updated_at: now, started_at: now };
  return out;
}

(w.HTMLCanvasElement.prototype as any).getContext = () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) });
(globalThis as any).CSS = { supports: (prop: string) => prop === "field-sizing" };
(w.HTMLElement.prototype as any).attachEvent ??= () => {};
(w.HTMLElement.prototype as any).detachEvent ??= () => {};
w.HTMLElement.prototype.scrollTo ??= function () {};
w.HTMLElement.prototype.scrollIntoView ??= function () {};

const readSite = (name: string) => `${name} ${new Error().stack!.split("\n").find((l) => l.includes("/packages/web/") && !l.includes("__tests__"))?.trim() ?? "?"}`;
const LAYOUT_GETTERS: Array<[any, string]> = [
  [w.HTMLElement.prototype, "offsetWidth"], [w.HTMLElement.prototype, "offsetHeight"],
  [w.Element.prototype, "clientWidth"], [w.Element.prototype, "clientHeight"],
  [w.Element.prototype, "scrollWidth"], [w.Element.prototype, "scrollHeight"],
];
let layoutReads: string[] = [];
for (const [proto, name] of LAYOUT_GETTERS) {
  const desc = Object.getOwnPropertyDescriptor(proto, name)!;
  Object.defineProperty(proto, name, { ...desc, get() { layoutReads.push(readSite(name)); return desc.get!.call(this); } });
}
for (const [owner, name] of [[w.Element.prototype, "getBoundingClientRect"], [w, "getComputedStyle"], [globalThis, "getComputedStyle"]] as Array<[any, string]>) {
  const real = owner[name];
  owner[name] = function (this: unknown, ...args: unknown[]) { layoutReads.push(readSite(name)); return real.apply(this, args); };
}

type Tally = { composerCommits: number; threadCommits: number; storeWrites: number; outsideMutations: string[]; layoutReads: string[] };
let measure: (fn: () => void) => Promise<Tally>;
let totalCommits = 0;
let textarea: HTMLTextAreaElement;
let container: HTMLElement;

beforeAll(async () => {
  (useInboxStore.getState() as any)._setDispatch(async () => undefined);
  useInboxStore.setState({ sessions: syntheticSessions(SESSIONS), conversations: {}, pendingMessages: {}, drafts: {}, currentUser: { _id: ME, name: "Typist" } } as any);
  const { LiteThread } = await import("../thread/LiteThread");
  const { LiteComposer } = await import("../thread/LiteComposer");
  container = w.document.createElement("div");
  w.document.body.appendChild(container);
  let composerCommits = 0;
  let threadCommits = 0;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ConvexProvider client={fakeConvex()}>
        <div data-lite="">
          <Profiler id="thread" onRender={() => { threadCommits++; totalCommits++; }}>
            <LiteThread sessionId={SESSION} />
          </Profiler>
          <Profiler id="composer" onRender={() => { composerCommits++; totalCommits++; }}>
            <LiteComposer sessionId={SESSION} />
          </Profiler>
        </div>
      </ConvexProvider>,
    );
  });
  for (let i = 0; i < 400 && !useInboxStore.getState().clientStateInitialized; i++) await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  textarea = container.querySelector("textarea[data-composer-field]") as HTMLTextAreaElement;
  measure = async (fn) => {
    composerCommits = 0;
    threadCommits = 0;
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
    return { composerCommits, threadCommits, storeWrites, outsideMutations, layoutReads: reads };
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

function typeChar(ch: string) {
  const propsKey = Object.keys(textarea).find((k) => k.startsWith("__reactProps"))!;
  const props = (textarea as any)[propsKey];
  const keyEvent = { key: ch, code: `Key${ch.toUpperCase()}`, target: textarea, currentTarget: textarea, nativeEvent: new w.KeyboardEvent("keydown", { key: ch }), preventDefault() {}, stopPropagation() {}, isComposing: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false };
  props.onKeyDown?.(keyEvent);
  Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, textarea.value + ch);
  props.onChange?.({ target: textarea, currentTarget: textarea, nativeEvent: new w.Event("input") });
}

test("a keystroke beside the thread commits the composer once and the thread never, writes nothing, changes no DOM, reads no layout", async () => {
  expect(textarea).toBeTruthy();
  expect(container.querySelectorAll("[data-vkey]").length).toBeGreaterThan(0);
  // The first characters change what an empty box shows; then the budget.
  await measure(() => typeChar("h"));
  await measure(() => typeChar("e"));
  await settle();
  const text = "llo there, this is a long prompt being typed".slice(0, KEYS);
  let worstComposer = 0;
  let worstThread = 0;
  let storeWrites = 0;
  const outside = new Set<string>();
  const reads = new Set<string>();
  for (const ch of text) {
    const t = await measure(() => typeChar(ch));
    worstComposer = Math.max(worstComposer, t.composerCommits);
    worstThread = Math.max(worstThread, t.threadCommits);
    storeWrites += t.storeWrites;
    for (const m of t.outsideMutations) outside.add(m);
    for (const r of t.layoutReads) reads.add(r);
  }
  expect(textarea.value.startsWith("hello there")).toBe(true);
  expect({ threadCommitsPerKey: worstThread }).toEqual({ threadCommitsPerKey: 0 });
  expect({ storeWritesWhileTyping: storeWrites }).toEqual({ storeWritesWhileTyping: 0 });
  expect([...outside]).toEqual([]);
  expect({ layoutReadsWhileTyping: [...reads] }).toEqual({ layoutReadsWhileTyping: [] });
  expect({ composerCommitsPerKey: worstComposer }).toEqual({ composerCommitsPerKey: 1 });
});
