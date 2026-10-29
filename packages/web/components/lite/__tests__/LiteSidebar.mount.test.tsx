import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { MemoryRouter, useLocation } from "react-router";
import { replaceGlobals } from "../../../test-helpers/globals";
import { closeDomWindow } from "../../../test-helpers/domGlobals";
import { useInboxStore, __resetInboxPlacementCacheForTests, type InboxSession } from "../../../store/inboxStore";
import { LiteLayoutCtx, type LiteLayoutState } from "../../../lib/lite/liteLayout";
import { LiteSidebarModelProvider } from "../LiteSidebarModel";
import { LiteSidebar } from "../LiteSidebar";
import { LitePalette } from "../LitePalette";

// The sidebar a person reads: their sessions under their projects, the
// project with the latest activity first, a mark on what is working and on
// what needs them, the open session highlighted, and a project that folds
// away. The palette finds a session by what it is called and opens it in Lite.

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://codecast.sh/lite" });
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
const restoreGlobals = replaceGlobals({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Event: dom.window.Event,
  MutationObserver: dom.window.MutationObserver,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
afterAll(() => { closeDomWindow(dom); restoreGlobals(); });

const S = 1000;
const MIN = 60 * S;
const NOW = 1_800_000_000_000;
const ME = "u".repeat(32);
const WORKING = "a".repeat(32);
const ASKING = "b".repeat(32);
const NOTES = "c".repeat(32);

let nowSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  nowSpy = spyOn(Date, "now").mockReturnValue(NOW);
  __resetInboxPlacementCacheForTests();
  const codecast = { git_remote_url: "git@github.com:acme/codecast.git", git_root: "/Users/me/src/codecast" };
  const sessions: Record<string, InboxSession> = {
    [WORKING]: row(WORKING, "Fix the auth race", {
      ...codecast,
      agent_status: "working", agent_status_updated_at: NOW - MIN, updated_at: NOW - 10 * S,
      last_heartbeat: NOW - 5 * S, daemon_alive_until: NOW + 85 * S, last_role_is_user: true,
    }),
    [ASKING]: row(ASKING, "Billing export", { ...codecast, awaiting_input: true, is_idle: true, updated_at: NOW - 2 * MIN }),
    [NOTES]: row(NOTES, "Docs pass", { git_root: "/Users/me/src/notes", is_idle: true, updated_at: NOW - 60 * MIN }),
  };
  const st = useInboxStore.getState();
  useInboxStore.setState({
    sessions,
    currentUser: { _id: ME, name: "Alex Green" },
    clientState: { ...st.clientState, ui: { ...st.clientState.ui, inbox_scope: "mine", active_team_id: undefined } },
    machineRoster: [],
    teamMembers: [],
    teams: [],
  } as any);
});
afterEach(() => nowSpy.mockRestore());

function row(id: string, title: string, extra: Partial<InboxSession>): InboxSession {
  return {
    _id: id, session_id: `s-${id.slice(0, 3)}`, agent_type: "claude_code", user_id: ME, status: "active",
    message_count: 6, is_idle: false, has_pending: false, title, ...extra,
  } as InboxSession;
}

let where = "";
function Where() {
  const loc = useLocation();
  where = loc.pathname;
  return null;
}

const layout = (patch: Partial<LiteLayoutState> = {}): LiteLayoutState => ({
  isPhone: false, sidebarOpen: true, setSidebarOpen: () => {}, toggleSidebar: () => {},
  rightPanelOpen: false, setRightPanelOpen: () => {}, toggleRightPanel: () => {},
  paletteOpen: false, setPaletteOpen: () => {}, togglePalette: () => {}, rightPanelHost: null, ...patch,
});

async function mount(at: string, body: React.ReactNode, frame: LiteLayoutState = layout()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <Where />
        <LiteLayoutCtx.Provider value={frame}>
          <LiteSidebarModelProvider>{body}</LiteSidebarModelProvider>
        </LiteLayoutCtx.Provider>
      </MemoryRouter>,
    );
  });
  return { host, unmount: () => act(() => root.unmount()) };
}

const titles = (el: Element) => [...el.querySelectorAll(".lt-row-title")].map((n) => n.textContent);

test("sessions file under their projects, latest activity first, with their marks", async () => {
  const { host, unmount } = await mount(`/lite/${ASKING}`, <LiteSidebar />);
  const projects = [...host.querySelectorAll("button.lt-project")].map((b) => b.textContent);
  expect(projects).toEqual(["codecast", "notes"]);

  const rowFor = (title: string) => [...host.querySelectorAll("a.lt-row")].find((a) => a.textContent?.includes(title))!;
  expect(rowFor("Fix the auth race").querySelector(".lt-mark")?.getAttribute("data-mark")).toBe("working");
  expect(rowFor("Billing export").querySelector(".lt-mark")?.getAttribute("data-mark")).toBe("needs");
  // A row that needs the person never recedes; the open one is the current page.
  expect(rowFor("Billing export").hasAttribute("data-attention")).toBe(true);
  expect(rowFor("Billing export").getAttribute("aria-current")).toBe("page");
  expect(rowFor("Fix the auth race").getAttribute("aria-current")).toBeNull();
  expect(rowFor("Fix the auth race").getAttribute("href")).toBe(`/lite/${WORKING}`);

  // Needs you counts what waits on the person.
  const needs = [...host.querySelectorAll("a.lt-row")].find((a) => a.getAttribute("href") === "/lite/needs-you")!;
  expect(Number(needs.querySelector(".lt-count")?.textContent)).toBeGreaterThanOrEqual(1);
  await unmount();
});

test("a closed project keeps only the open session and says what is inside", async () => {
  const { host, unmount } = await mount(`/lite/${ASKING}`, <LiteSidebar />);
  const codecast = [...host.querySelectorAll("button.lt-project")].find((b) => b.textContent?.startsWith("codecast"))!;
  expect(codecast.getAttribute("aria-expanded")).toBe("true");
  await act(async () => { (codecast as HTMLButtonElement).click(); });
  expect(codecast.getAttribute("aria-expanded")).toBe("false");
  const list = document.getElementById(codecast.getAttribute("aria-controls")!)!;
  expect(titles(list)).toEqual(["Billing export"]);
  expect(codecast.querySelector(".lt-mark")?.getAttribute("data-mark")).toBe("needs");
  // Remembered for this viewer.
  expect(window.localStorage.getItem("codecast.lite.collapsedProjects")).toContain("repo:acme/codecast");
  await act(async () => { (codecast as HTMLButtonElement).click(); });
  await unmount();
});

test("the palette finds a session by name and opens it in Lite", async () => {
  let open = true;
  const frame = layout({ paletteOpen: true, setPaletteOpen: (v) => { open = v; } });
  const { host, unmount } = await mount("/lite", <LitePalette />, frame);
  // At rest: actions and recent sessions.
  const headings = () => [...host.querySelectorAll("[cmdk-group-heading]")].map((h) => h.textContent);
  expect(headings()).toEqual(["Actions", "Recent sessions"]);

  const input = host.querySelector("input")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "docs");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  const item = [...host.querySelectorAll("[cmdk-item]")].find((n) => n.textContent?.includes("Docs pass"))!;
  expect(item).toBeTruthy();
  await act(async () => { (item as HTMLElement).click(); });
  expect(where).toBe(`/lite/${NOTES}`);
  expect(open).toBe(false);
  await unmount();
});
