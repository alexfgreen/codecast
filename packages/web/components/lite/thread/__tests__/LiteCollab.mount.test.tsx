// Collaboration inside Lite's thread, as a person reads it: another agent's
// message is a card naming whose agent and which session (its title opens
// it in Lite), this agent's `cast send` is the outgoing card with how it came
// out, a reference nobody can resolve stays its short id in mono, a reply's
// markdown lists keep their markers, and a message with comments shows their
// count, which opens its shared thread in place (a message without any takes
// a new one from its hover action).
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { act } from "react";
import { replaceGlobals } from "../../../../test-helpers/globals";

mock.module("sonner", () => {
  const noop = () => 1;
  return { toast: Object.assign(noop, { error: noop, info: noop, success: noop, warning: noop, dismiss: () => {}, loading: noop, custom: noop, promise: (p: any) => p }), Toaster: () => null };
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/lite", pretendToBeVisual: true });
const offsets = new WeakMap<Element, number>();
const height = (el: Element) => (el.classList.contains("lt-th-list") ? 4000 : 40);
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
(dom.window.HTMLCanvasElement.prototype as any).getContext = () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) });
(dom.window as any).ResizeObserver = TestResizeObserver;
(dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
const restoreGlobals = replaceGlobals({
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
  KeyboardEvent: dom.window.KeyboardEvent, HTMLElement: dom.window.HTMLElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node, DOMRect: dom.window.DOMRect,
  MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), ResizeObserver: TestResizeObserver,
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  localStorage: dom.window.localStorage, indexedDB, IDBKeyRange, IS_REACT_ACT_ENVIRONMENT: true,
  CSS: { supports: (prop: string) => prop === "field-sizing" },
});
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const SESSION = "jx7" + "l".repeat(29);
const MAYAS = "jx7" + "y".repeat(29);
const ME = "u".repeat(32);
const MAYA = "m".repeat(32);
const T0 = 1_800_000_000_000;
const mid = (c: string) => "k" + c.repeat(31);
let messages: any[] = [];

const realConversationMessages = await import("../../../../hooks/useConversationMessages");
mock.module("../../../../hooks/useConversationMessages", () => ({
  ...realConversationMessages,
  useConversationMessages: (id: string) => ({
    conversation: { _id: id, agent_type: "claude_code", status: "active", messages },
    hasMoreAbove: false, isLoadingOlder: false, loadOlder: () => {},
  }),
}));
// Every query is still loading: names come from the store's rows, and the
// comment feed leaves the store's comments as they are.
const { offlineConvexClient } = await import("../../../../test-helpers/offlineConvex");
const convex = offlineConvexClient();
(convex as any).watchQuery = () => ({ onUpdate: () => () => {}, localQueryResult: () => undefined, localQueryLogs: () => undefined, journal: () => undefined });
(convex as any).mutation = async () => null;
(convex as any).query = async () => null;
const { ConvexProvider } = await import("convex/react");
const { MemoryRouter } = await import("react-router");

const { createRoot } = await import("react-dom/client");
const { useInboxStore } = await import("../../../../store/inboxStore");
const { LiteThread } = await import("../LiteThread");

const send = { id: "call-send", name: "Bash", input: JSON.stringify({ command: 'cast send jx7mmmm "Does mobile pin the old auth client?"' }) };
const roleSend = { id: "call-role", name: "Bash", input: JSON.stringify({ command: 'cast send @eng "Take the refresh half"' }) };
const transcript = () => [
  { _id: mid("a"), role: "user", content: "check whether mobile pins the old client", timestamp: T0 },
  { _id: mid("b"), role: "assistant", content: "", timestamp: T0 + 1000, tool_calls: [send, roleSend] },
  {
    _id: mid("c"), role: "user", content: "", timestamp: T0 + 2000,
    tool_results: [
      { tool_use_id: send.id, content: "\x1b[32m✓\x1b[0m sent to \x1b[36mjx7mmmm\x1b[0m from jx7llll" },
      { tool_use_id: roleSend.id, content: "No session found for \"@eng\"", is_error: true },
    ],
  },
  { _id: mid("d"), role: "user", content: '<session-message from="jx7mmmm" name="Maya Kim">\nYes, **2.3.1**. Bump it after you land.\n</session-message>', timestamp: T0 + 60_000 },
  { _id: mid("e"), role: "user", content: '<session-message from="jx7zzzz">\nWho is this?\n</session-message>', timestamp: T0 + 70_000 },
  { _id: mid("f"), role: "assistant", content: "Plan:\n\n- bump the client\n- rerun the build\n\n1. first\n2. second", timestamp: T0 + 80_000 },
];

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
const pause = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const cards = (dir: "from" | "to") => [...host.querySelectorAll<HTMLElement>(`.lt-agent[data-dir="${dir}"]`)];

afterAll(async () => {
  await act(async () => root.unmount());
  mock.module("../../../../hooks/useConversationMessages", () => realConversationMessages);
  dom.window.close();
  restoreGlobals();
});

beforeAll(async () => {
  (useInboxStore.getState() as any)._setDispatch?.(async () => undefined);
  useInboxStore.setState({
    currentUser: { _id: ME, name: "Alex" },
    teamMembers: [{ _id: MAYA, name: "Maya Kim" }],
    sessions: {
      [SESSION]: { _id: SESSION, short_id: "jx7llll", user_id: ME, title: "Fix auth race", agent_type: "claude_code", status: "active", agent_status: "idle", message_count: 6, updated_at: T0 },
      [MAYAS]: { _id: MAYAS, short_id: "jx7mmmm", user_id: MAYA, title: "Ship mobile", agent_type: "claude_code", status: "active", agent_status: "idle", message_count: 9, updated_at: T0 },
    },
    conversations: {},
    comments: {
      c1: { _id: "c1", conversation_id: SESSION, message_id: mid("f"), content: "Also the web client?", user_id: MAYA, created_at: T0 + 90_000 },
    },
  } as any);
  messages = transcript();
  host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ConvexProvider client={convex}><LiteThread sessionId={SESSION} /></ConvexProvider></MemoryRouter>));
  await pause(50);
});

test("another agent's message names whose agent and which session, and the title opens it in Lite", () => {
  const [maya] = cards("from");
  expect(maya.querySelector(".lt-agent-who")?.textContent).toBe("From Maya's agent");
  const title = maya.querySelector<HTMLAnchorElement>("a.lt-agent-title");
  expect(title?.textContent).toBe("Ship mobile");
  expect(title?.getAttribute("href")).toBe(`/lite/${MAYAS}`);
  expect(maya.querySelector(".lt-agent-body strong")?.textContent).toBe("2.3.1");
  // Never a person's typed words.
  expect(host.querySelectorAll(".lt-th-bubble").length).toBe(1);
});

test("a reference nobody can resolve stays its short id, in mono", () => {
  const unknown = cards("from")[1];
  expect(unknown.querySelector(".lt-agent-who")?.textContent).toBe("From");
  const ref = unknown.querySelector(".lt-agent-title");
  expect(ref?.textContent).toBe("jx7zzzz");
  expect(ref?.hasAttribute("data-mono")).toBe(true);
});

test("this agent's sends: to whom, and how each came out; a refusal opens what the CLI said", async () => {
  const [toMaya, toRole] = cards("to");
  expect(toMaya.querySelector(".lt-agent-who")?.textContent).toBe("To Maya's agent");
  expect(toMaya.querySelector(".lt-agent-title")?.textContent).toBe("Ship mobile");
  expect(toMaya.querySelector('.lt-agent-state[data-state="sent"]')?.textContent).toBe("Sent");
  expect(toMaya.textContent).toContain("Does mobile pin the old auth client?");
  expect(toRole.querySelector(".lt-agent-who")?.textContent).toBe("To @eng");
  const failed = toRole.querySelector<HTMLButtonElement>('button.lt-agent-state[data-state="failed"]')!;
  expect(failed.textContent).toBe("Failed");
  await act(async () => failed.click());
  expect(toRole.querySelector(".lt-agent-why")?.textContent).toContain("No session found");
});

test("a reply's markdown lists keep their markers", () => {
  const reply = [...host.querySelectorAll(".lt-th-text.lt-md")].find((n) => n.textContent?.includes("bump the client"))!;
  expect(reply.querySelectorAll("ul > li").length).toBe(2);
  expect(reply.querySelectorAll("ol > li").length).toBe(2);
});

test("a message with comments shows their count, which opens its thread; one without takes a new one", async () => {
  const badge = host.querySelector<HTMLButtonElement>(".lt-th-cbadge")!;
  expect(badge.textContent).toBe("1");
  expect(badge.getAttribute("aria-expanded")).toBe("false");
  await act(async () => badge.click());
  await pause(20);
  expect(host.querySelector(".lt-cmt")?.textContent).toContain("Also the web client?");
  expect(host.querySelector<HTMLButtonElement>(".lt-th-cbadge")!.getAttribute("aria-expanded")).toBe("true");
  // The prompt has none: its hover action starts one.
  const start = host.querySelector<HTMLButtonElement>('.lt-th-user button[aria-label="Comment"]');
  expect(start).toBeTruthy();
  await act(async () => host.querySelector<HTMLButtonElement>(".lt-th-cbadge")!.click());
  expect(host.querySelector(".lt-cmt")).toBeNull();
});
