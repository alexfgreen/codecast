// Needs you as a person meets it: the sidebar's marks say only what is true
// (an ask needs you, a failure is red, an unread result is a check, a read
// one says nothing), the number beside Needs you counts what is owed, and the
// page lists each thing under its section, answered where it stands, by
// press or by key.
import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { act, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { ConvexProvider } from "convex/react";
import { replaceGlobals } from "../../../../test-helpers/globals";
import { useInboxStore, __resetInboxPlacementCacheForTests, type InboxSession } from "../../../../store/inboxStore";
import { closeDomWindow } from "../../../../test-helpers/domGlobals";
import { offlineConvexClient } from "../../../../test-helpers/offlineConvex";
import { LiteLayoutCtx, type LiteLayoutState } from "../../../../lib/lite/liteLayout";

mock.module("sonner", () => {
  const noop = () => 1;
  return { toast: Object.assign(noop, { error: noop, info: noop, success: noop, warning: noop, dismiss: () => {}, loading: noop, custom: noop, promise: (p: any) => p }), Toaster: () => null };
});

// Its own window: the shared compose fixture is one window for the whole run,
// closed by whichever file finishes with it first.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://codecast.sh/lite/needs-you" });
const w = dom.window as any;
w.HTMLElement.prototype.scrollIntoView = function () {};
const restoreGlobals = replaceGlobals({
  window: w,
  document: w.document,
  navigator: w.navigator,
  localStorage: w.localStorage,
  indexedDB,
  IDBKeyRange,
  HTMLElement: w.HTMLElement,
  HTMLInputElement: w.HTMLInputElement,
  HTMLTextAreaElement: w.HTMLTextAreaElement,
  Element: w.Element,
  Node: w.Node,
  KeyboardEvent: w.KeyboardEvent,
  Event: w.Event,
  getComputedStyle: w.getComputedStyle,
  MutationObserver: w.MutationObserver,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  requestAnimationFrame: (cb: any) => setTimeout(cb, 0),
  cancelAnimationFrame: (id: any) => clearTimeout(id),
  IS_REACT_ACT_ENVIRONMENT: true,
});
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

const S = 1000;
const MIN = 60 * S;
const NOW = 1_800_000_000_000;
const ME = "u".repeat(32);
const WORKING = "a".repeat(32);
const ASKING = "b".repeat(32);
const PERM = "c".repeat(32);
const DECIDING = "d".repeat(32);
const READ = "e".repeat(32);
const UNREAD = "f".repeat(32);
const FAILED = "g".repeat(32);
const HANDED = "h".repeat(32);
const DECISION = "k".repeat(32);

function fakeConvex() {
  const client = offlineConvexClient("https://example.convex.cloud");
  (client as any).mutation = async () => null;
  (client as any).query = async () => null;
  (client as any).watchQuery = () => ({ onUpdate: () => () => {}, localQueryResult: () => undefined, localQueryLogs: () => undefined, journal: () => undefined });
  return client;
}
const convex = fakeConvex();

let LiteSidebarModelProvider: typeof import("../../LiteSidebarModel").LiteSidebarModelProvider;
let LiteSidebar: typeof import("../../LiteSidebar").LiteSidebar;
let LiteNeedsYouPage: typeof import("../../../../app/lite/needs-you/page").default;

beforeAll(async () => {
  (useInboxStore.getState() as any)._setDispatch(async () => undefined);
  ({ LiteSidebarModelProvider } = await import("../../LiteSidebarModel"));
  ({ LiteSidebar } = await import("../../LiteSidebar"));
  ({ default: LiteNeedsYouPage } = await import("../../../../app/lite/needs-you/page"));
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterAll(async () => {
  if (root) await act(async () => root!.unmount());
  closeDomWindow(dom);
  restoreGlobals();
});

function row(id: string, title: string, extra: Partial<InboxSession> = {}): InboxSession {
  return {
    _id: id, session_id: `s-${id.slice(0, 3)}`, agent_type: "claude_code", user_id: ME, status: "active",
    message_count: 6, is_idle: true, has_pending: false, title, git_root: "/Users/me/src/codecast",
    updated_at: NOW - 20 * MIN, turn_completed_at: NOW - 20 * MIN, ...extra,
  } as InboxSession;
}

let nowSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
  __resetInboxPlacementCacheForTests();
  const st = useInboxStore.getState();
  useInboxStore.setState({
    currentUser: { _id: ME, name: "Alex Green" },
    clientState: { ...st.clientState, ui: { ...st.clientState.ui, active_team_id: undefined } },
    machineRoster: [],
    teamMembers: [],
    teams: [],
    sessions: {
      [WORKING]: row(WORKING, "Fix the auth race", {
        is_idle: false, agent_status: "working", agent_status_updated_at: NOW - MIN, updated_at: NOW - 10 * S,
        last_heartbeat: NOW - 5 * S, daemon_alive_until: NOW + 85 * S, last_role_is_user: true,
      }),
      [ASKING]: row(ASKING, "Evals sweep", { awaiting_input: true, updated_at: NOW - 2 * MIN }),
      [PERM]: row(PERM, "Clean caches", {
        agent_status: "permission_blocked", agent_status_updated_at: NOW - 3 * MIN, last_heartbeat: NOW - 5 * S,
        daemon_alive_until: NOW + 85 * S, updated_at: NOW - 3 * MIN,
      }),
      [DECIDING]: row(DECIDING, "Billing export"),
      [READ]: row(READ, "Docs pass", { updated_at: NOW - 30 * MIN, turn_completed_at: NOW - 30 * MIN }),
      [UNREAD]: row(UNREAD, "Mobile build", { updated_at: NOW - 5 * MIN, turn_completed_at: NOW - 5 * MIN }),
      [FAILED]: row(FAILED, "Nightly sweep", { pending_api_error: true, pending_api_error_kind: "usage_limit" } as Partial<InboxSession>),
      [HANDED]: row(HANDED, "Ship mobile", { assigned_ping: { by_name: "Maya Kim", note: "can you take the tests?", at: NOW - 10 * MIN } }),
    },
    // Read: everything but Mobile build was read after its last turn.
    sessionReads: Object.fromEntries(
      [WORKING, ASKING, PERM, DECIDING, READ, FAILED, HANDED].map((id) => [`r-${id}`, { _id: `r-${id}`, conversation_id: id, acknowledged_at: NOW - MIN, updated_at: NOW - MIN }]),
    ),
    _lastViewedAt: {},
    sessionDecisions: {
      [DECISION]: { _id: DECISION, conversation_id: DECIDING, status: "pending", question: "Which schema wins?", options: [{ label: "Frontmatter" }, { label: "Path" }], blocking: true, created_at: NOW - 4 * MIN },
    },
    pendingPermissions: {
      p1: { _id: "p1", conversation_id: PERM, status: "pending", created_at: NOW - 3 * MIN, tool_name: "Bash", arguments_preview: "rm -rf .cache" },
    },
    questionResolutions: {},
    notifications: {
      n1: { _id: "n1", type: "mention", read: false, created_at: NOW - 6 * MIN, message: "Jon Sato mentioned you in a comment", conversation_id: READ, actor: { name: "Jon Sato" }, conversation: { title: "Docs pass" } },
      n2: { _id: "n2", type: "session_assigned", read: false, created_at: NOW - 10 * MIN, message: "Maya Kim handed you Ship mobile", conversation_id: HANDED },
      n3: { _id: "n3", type: "session_idle", read: false, created_at: NOW - 7 * MIN, message: "ready", conversation_id: UNREAD },
    },
    pendingMessages: {},
    drafts: {},
  } as any);
});
afterEach(() => nowSpy.mockRestore());

let where = "";
function Where() {
  where = useLocation().pathname;
  return null;
}

const layout: LiteLayoutState = {
  isPhone: false, sidebarOpen: true, setSidebarOpen: () => {}, toggleSidebar: () => {},
  rightPanelOpen: false, setRightPanelOpen: () => {}, toggleRightPanel: () => {}, rightPanelSheet: false,
  paletteOpen: false, setPaletteOpen: () => {}, togglePalette: () => {}, rightPanelHost: null,
} as LiteLayoutState;

const pause = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function mount(at: string, body: ReactNode) {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  host = w.document.createElement("div");
  host!.setAttribute("data-lite", "");
  w.document.body.appendChild(host);
  root = createRoot(host!);
  await act(async () => {
    root!.render(
      <ConvexProvider client={convex}>
        <MemoryRouter initialEntries={[at]}>
          <Where />
          <LiteLayoutCtx.Provider value={layout}>
            <LiteSidebarModelProvider>{body}</LiteSidebarModelProvider>
          </LiteLayoutCtx.Provider>
        </MemoryRouter>
      </ConvexProvider>,
    );
  });
  await pause(20);
  return host!;
}

const rowTitled = (el: Element, title: string) => [...el.querySelectorAll("a.lt-row")].find((a) => a.querySelector(".lt-row-title")?.textContent === title)!;
const markOf = (el: Element, title: string) => rowTitled(el, title).querySelector(".lt-mark")?.getAttribute("data-mark") ?? null;
const heads = (el: Element) => [...el.querySelectorAll(".lt-needs-head")].map((h) => `${h.querySelector("span")?.textContent} ${h.querySelector(".lt-needs-n")?.textContent}`);
const needsRow = (el: Element, text: string) => [...el.querySelectorAll<HTMLElement>("[data-needs-row]")].find((r) => r.textContent?.includes(text));
const key = (target: Element, k: string) => act(async () => { target.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true })); });

test("the sidebar marks only what is true, and Needs you counts what is owed", async () => {
  const el = await mount("/lite", <LiteSidebar />);
  expect(markOf(el, "Fix the auth race")).toBe("working");
  expect(markOf(el, "Evals sweep")).toBe("needs");
  expect(markOf(el, "Clean caches")).toBe("needs");
  expect(markOf(el, "Billing export")).toBe("needs");
  expect(markOf(el, "Nightly sweep")).toBe("error");
  expect(markOf(el, "Mobile build")).toBe("done");
  // Finished and read: the steady state says nothing, and recedes.
  expect(markOf(el, "Docs pass")).toBeNull();
  expect(rowTitled(el, "Docs pass").hasAttribute("data-attention")).toBe(false);
  expect(markOf(el, "Ship mobile")).toBeNull();
  // A failure never recedes.
  expect(rowTitled(el, "Nightly sweep").hasAttribute("data-attention")).toBe(true);
  expect(rowTitled(el, "Nightly sweep").querySelector(".lt-mark")?.getAttribute("aria-label")).toBe("Failed");

  // Three questions, one handoff, one mention; the finished turn is listed, not counted.
  const nav = [...el.querySelectorAll("a.lt-row")].find((a) => a.getAttribute("href") === "/lite/needs-you")!;
  expect(nav.querySelector(".lt-count")?.textContent).toBe("5");
});

test("Needs you lists each thing under its section, most urgent first, with the count beside it", async () => {
  const el = await mount("/lite/needs-you", <LiteNeedsYouPage />);
  expect(heads(el)).toEqual(["Questions 3", "Handed to you 1", "Mentions 1", "Finished 1"]);
  expect(el.querySelector(".lt-topbar .lt-count")?.textContent).toBe("5");

  const decide = needsRow(el, "Which schema wins?")!;
  expect([...decide.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["1Frontmatter", "2Path"]);
  const perm = needsRow(el, "Clean caches")!;
  expect(perm.querySelector(".lt-needs-code")?.textContent).toBe("Bash rm -rf .cache");
  expect(needsRow(el, "Evals sweep")!.textContent).toContain("Answer");
  const handed = needsRow(el, "Ship mobile")!;
  expect(handed.textContent).toContain("From Maya Kim");
  expect(handed.textContent).toContain("can you take the tests?");
  // The handoff's own notice says nothing the handoff does not; a status notice is not a mention.
  expect(needsRow(el, "Maya Kim handed you")).toBeUndefined();
  expect(needsRow(el, "ready")).toBeUndefined();
  const mention = needsRow(el, "Jon Sato mentioned you")!;
  expect(mention.querySelector("a.lt-needs-title")?.getAttribute("href")).toBe(`/lite/${READ}`);
  expect(needsRow(el, "Mobile build")).toBeTruthy();
});

test("each row is answered where it stands", async () => {
  const el = await mount("/lite/needs-you", <LiteNeedsYouPage />);

  // A decision, by its option.
  const path = [...needsRow(el, "Which schema wins?")!.querySelectorAll("button")].find((b) => b.textContent?.includes("Path"))!;
  await act(async () => path.click());
  await pause(10);
  expect((useInboxStore.getState() as any).sessionDecisions[DECISION].status).not.toBe("pending");
  expect(needsRow(el, "Which schema wins?")).toBeUndefined();

  // A permission prompt, by its key.
  await key(needsRow(el, "Clean caches")!, "y");
  await pause(10);
  expect((useInboxStore.getState() as any).pendingPermissions.p1).toBeUndefined();
  expect(needsRow(el, "Clean caches")).toBeUndefined();

  // A handoff, acknowledged, with the notice that announced it.
  const ack = [...needsRow(el, "Ship mobile")!.querySelectorAll("button")].find((b) => b.textContent?.includes("Acknowledge"))!;
  await act(async () => ack.click());
  await pause(10);
  expect((useInboxStore.getState() as any).sessions[HANDED].assigned_ping).toBeFalsy();
  expect((useInboxStore.getState() as any).notifications.n2.read).toBe(true);

  // A mention, read by its key.
  await key(needsRow(el, "Jon Sato mentioned you")!, "e");
  await pause(10);
  expect((useInboxStore.getState() as any).notifications.n1.read).toBe(true);

  // Finished turns, all read at once.
  const finishedHead = [...el.querySelectorAll(".lt-needs-head")].find((h) => h.textContent?.startsWith("Finished"))!;
  await act(async () => finishedHead.querySelector("button")!.click());
  await pause(10);

  expect(heads(el)).toEqual(["Questions 1"]);
  expect(el.querySelector(".lt-topbar .lt-count")?.textContent).toBe("1");
});

test("the keyboard walks the rows and opens the one it rests on", async () => {
  const el = await mount("/lite/needs-you", <LiteNeedsYouPage />);
  const rows = () => [...el.querySelectorAll<HTMLElement>("[data-needs-row]")];
  // The page opened with nothing focused: the first row takes the focus.
  expect(w.document.activeElement).toBe(rows()[0]);
  expect(rows().filter((r) => r.tabIndex === 0)).toHaveLength(1);
  await key(rows()[0]!, "ArrowDown");
  expect(w.document.activeElement).toBe(rows()[1]);
  await key(rows()[1]!, "j");
  expect(w.document.activeElement).toBe(rows()[2]);
  await key(rows()[2]!, "k");
  expect(w.document.activeElement).toBe(rows()[1]);
  await key(rows()[1]!, "End");
  expect(w.document.activeElement).toBe(rows()[rows().length - 1]);
  // The last row is the finished turn: Enter opens it in Lite.
  await key(rows()[rows().length - 1]!, "Enter");
  expect(where).toBe(`/lite/${UNREAD}`);
});

test("a digit answers the decision the focus rests on, and the focus moves to the row that took its place", async () => {
  const el = await mount("/lite/needs-you", <LiteNeedsYouPage />);
  const decide = needsRow(el, "Which schema wins?")!;
  decide.focus();
  await key(decide, "1");
  await pause(10);
  expect((useInboxStore.getState() as any).sessionDecisions[DECISION].answer_index).toBe(0);
  const next = w.document.activeElement as HTMLElement;
  expect(next.hasAttribute("data-needs-row")).toBe(true);
  expect(next.textContent).not.toContain("Which schema wins?");
});

test("with nothing owed, one calm line", async () => {
  useInboxStore.setState({ sessions: {}, sessionDecisions: {}, notifications: {}, pendingPermissions: {} } as any);
  const el = await mount("/lite/needs-you", <LiteNeedsYouPage />);
  expect(el.querySelector(".lt-needs-empty h1")?.textContent).toBe("Nothing needs you");
  expect(el.querySelector("[data-needs-row]")).toBeNull();
  expect(el.querySelector(".lt-topbar .lt-count")).toBeNull();
});
