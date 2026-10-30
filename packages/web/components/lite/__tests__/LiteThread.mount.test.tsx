// Lite's thread as a person reads it: their prompt, a finished turn folded to
// "Worked for …" with the final reply under it, the fold opening onto its run
// and the run onto its calls, a command's output under its line, a
// teammate's words under their name, and "Working for …" while the agent
// runs. Rows sit at `top`, never on a transform.
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { act } from "react";
import { replaceGlobals } from "../../../test-helpers/globals";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/lite", pretendToBeVisual: true });
const offsets = new WeakMap<Element, number>();
const height = (el: Element) => (el.classList.contains("lt-th-list") ? 2000 : 40);
class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperties(dom.window.HTMLElement.prototype, {
  scrollTop: {
    get() { return offsets.get(this) ?? 0; },
    set(value: number) { offsets.set(this, Math.max(0, value)); },
  },
  offsetHeight: { get() { return height(this); } },
  offsetWidth: { get() { return 800; } },
  clientHeight: { get() { return height(this); } },
  clientWidth: { get() { return 800; } },
  scrollHeight: { get() { return height(this); } },
  offsetParent: { get() { return dom.window.document.body; } },
});
dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: height(this), width: 800, height: height(this), toJSON() {} }; };
dom.window.HTMLElement.prototype.scrollTo = function () {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
(dom.window as any).ResizeObserver = TestResizeObserver;
(dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
const restoreGlobals = replaceGlobals({
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, DOMRect: dom.window.DOMRect,
  MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), ResizeObserver: TestResizeObserver,
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  localStorage: dom.window.localStorage, indexedDB, IDBKeyRange, IS_REACT_ACT_ENVIRONMENT: true,
});
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const SESSION = "jx7" + "l".repeat(29);
const ME = "u".repeat(32);
const MAYA = "m".repeat(32);
const T0 = 1_800_000_000_000;
let messages: any[] = [];

// The thread's data hook, answered from the fixture: the hook's own feeders
// (Convex, IDB) are not what this test holds. Its other exports stay real.
const realConversationMessages = await import("../../../hooks/useConversationMessages");
mock.module("../../../hooks/useConversationMessages", () => ({
  ...realConversationMessages,
  useConversationMessages: () => ({ conversation: { _id: SESSION, agent_type: "claude_code", status: "active", messages }, hasMoreAbove: false, isLoadingOlder: false, loadOlder: () => {} }),
}));
afterAll(async () => {
  await act(async () => root.unmount());
  mock.module("../../../hooks/useConversationMessages", () => realConversationMessages);
  dom.window.close();
  restoreGlobals();
});

const { createRoot } = await import("react-dom/client");
const { useInboxStore } = await import("../../../store/inboxStore");
const { LiteThread } = await import("../thread/LiteThread");

const bash = { id: "call-bash", name: "Bash", input: JSON.stringify({ command: "bun test" }) };
const read = { id: "call-read", name: "Read", input: JSON.stringify({ file_path: "/repo/src/a.ts" }) };
const transcript = () => [
  { _id: "m1", role: "user", content: "fix the flaky test", timestamp: T0 },
  { _id: "m2", role: "assistant", content: "", timestamp: T0 + 2000, tool_calls: [read] },
  { _id: "m3", role: "user", content: "", timestamp: T0 + 3000, tool_results: [{ tool_use_id: read.id, content: "a\nb" }] },
  { _id: "m4", role: "assistant", content: "", timestamp: T0 + 4000, tool_calls: [bash] },
  { _id: "m5", role: "user", content: "", timestamp: T0 + 5000, tool_results: [{ tool_use_id: bash.id, content: "12 pass\n0 fail" }] },
  { _id: "m6", role: "assistant", content: "It was a race in the retry worker; fixed.", timestamp: T0 + 133_000 },
  { _id: "m7", role: "user", content: "ship it", timestamp: T0 + 200_000, from_user_id: MAYA },
];

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
const pause = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => host.textContent ?? "";
const lineNamed = (words: string) => [...host.querySelectorAll<HTMLButtonElement>("button.lt-th-line")].find((b) => b.textContent?.includes(words));

beforeAll(async () => {
  useInboxStore.setState({
    currentUser: { _id: ME, name: "Alex" },
    teamMembers: [{ _id: MAYA, name: "Maya Kim" }],
    sessions: { [SESSION]: { _id: SESSION, user_id: ME, title: "Flaky test", agent_type: "claude_code", status: "active", agent_status: "idle", message_count: 7, updated_at: T0 + 200_000 } },
    conversations: {},
  } as any);
  messages = transcript();
  host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<LiteThread sessionId={SESSION} />));
  await pause(50);
});

test("a finished turn folds to one line and keeps its reply; the teammate's prompt carries their name", () => {
  expect(text()).toContain("fix the flaky test");
  expect(lineNamed("Worked for 2m 13s")).toBeTruthy();
  expect(text()).toContain("It was a race in the retry worker; fixed.");
  expect(lineNamed("Read")).toBeUndefined();
  expect(text()).toContain("ship it");
  expect(host.querySelector(".lt-th-author")?.textContent).toBe("Maya Kim");
});

test("rows are placed by top, not a transform", () => {
  const rows = [...host.querySelectorAll<HTMLElement>("[data-vkey]")];
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.style.transform).toBe("");
    expect(r.style.top).toMatch(/px$/);
  }
});

test("the fold opens onto its run, the run onto its calls, a command onto its output", async () => {
  await act(async () => lineNamed("Worked for")!.click());
  const run = lineNamed("Read src/a.ts and ran bun test") ?? lineNamed("and ran bun test");
  expect(run).toBeTruthy();
  await act(async () => run!.click());
  const command = lineNamed("Ran bun test");
  expect(command).toBeTruthy();
  expect(lineNamed("Read")).toBeTruthy();
  await act(async () => command!.click());
  expect(host.querySelector(".lt-th-pre")?.textContent).toContain("12 pass");
});

test("while the agent works, the last turn stays open and the list ends in Working for", async () => {
  messages = [...transcript(), { _id: "m8", role: "assistant", content: "", timestamp: T0 + 201_000, tool_calls: [{ id: "call-live", name: "Bash", input: JSON.stringify({ command: "npx tsc" }) }] }];
  useInboxStore.setState((s: any) => ({ sessions: { ...s.sessions, [SESSION]: { ...s.sessions[SESSION], agent_status: "working", agent_status_updated_at: Date.now(), last_heartbeat: Date.now(), daemon_alive_until: Date.now() + 60_000 } } }));
  await act(async () => root.render(<LiteThread sessionId={SESSION} />));
  await pause(50);
  expect(text()).toContain("Working for");
  expect(text()).toContain("Running npx tsc");
});
