// What sits under Lite's thread, for each viewer and each moment: the owner's
// composer (the app's own MessageInput); a teammate's, addressed to the
// owner's agent; a single "Read only" line where the viewer cannot send;
// nothing until the client knows which of those the viewer is; the
// permission stack in the composer's place while a tool waits on approval;
// and a `cast decide` ask docked above, answered with one press.
import { dom, w, restoreGlobals } from "../../__tests__/fixtures/composeDom";
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";

mock.module("sonner", () => {
  const noop = () => 1;
  return { toast: Object.assign(noop, { error: noop, info: noop, success: noop, warning: noop, dismiss: () => {}, loading: noop, custom: noop, promise: (p: any) => p }), Toaster: () => null };
});
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { useInboxStore } from "../../../store/inboxStore";
import { closeDomWindow } from "../../../test-helpers/domGlobals";
import { offlineConvexClient } from "../../../test-helpers/offlineConvex";

(globalThis as any).CSS = { supports: (prop: string) => prop === "field-sizing" };
(w.HTMLCanvasElement.prototype as any).getContext = () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) });
(w.HTMLElement.prototype as any).attachEvent ??= () => {};
(w.HTMLElement.prototype as any).detachEvent ??= () => {};

const ME = "u".repeat(32);
const MAYA = "m".repeat(32);
const MINE = "jx7" + "a".repeat(29);
const MAYAS = "jx7" + "b".repeat(29);
const HOSTED = "jx7" + "c".repeat(29);
const UNKNOWN = "jx7" + "e".repeat(29);

function fakeConvex() {
  const client = offlineConvexClient("https://example.convex.cloud");
  (client as any).mutation = async () => null;
  (client as any).query = async () => null;
  (client as any).watchQuery = () => ({ onUpdate: () => () => {}, localQueryResult: () => undefined, localQueryLogs: () => undefined, journal: () => undefined });
  return client;
}

const session = (id: string, user: string, extra: Record<string, unknown> = {}) => ({
  _id: id, session_id: `s-${id.slice(-4)}`, title: "A session", user_id: user, agent_type: "claude_code", status: "active", is_idle: true, message_count: 3, updated_at: Date.now(), started_at: Date.now(), ...extra,
});

let LiteComposer: typeof import("../thread/LiteComposer").LiteComposer;
let host: HTMLElement;
let root: Root;
const convex = fakeConvex();
const pause = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeAll(async () => {
  (useInboxStore.getState() as any)._setDispatch(async () => undefined);
  ({ LiteComposer } = await import("../thread/LiteComposer"));
});
afterAll(async () => {
  if (root) await act(async () => root.unmount());
  closeDomWindow(dom);
  restoreGlobals();
});

beforeEach(() => {
  useInboxStore.setState({
    currentUser: { _id: ME, name: "Alex" },
    teamMembers: [{ _id: MAYA, name: "Maya Kim" }],
    sessions: {
      [MINE]: session(MINE, ME),
      [MAYAS]: session(MAYAS, MAYA, { team_id: "t".repeat(32) }),
      [HOSTED]: session(HOSTED, MAYA, { agent_type: "codecast" }),
      [UNKNOWN]: session(UNKNOWN, MAYA, { team_id: "t".repeat(32) }),
    },
    conversations: {
      [MAYAS]: { _id: MAYAS, user_id: MAYA, access_level: "team" },
      [HOSTED]: { _id: HOSTED, user_id: MAYA, access_level: "team", agent_type: "codecast" },
    },
    pendingPermissions: {},
    sessionDecisions: {},
    pendingMessages: {},
    drafts: {},
  } as any);
});

async function mount(id: string) {
  if (root) await act(async () => root.unmount());
  host?.remove();
  host = w.document.createElement("div");
  w.document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ConvexProvider client={convex}><div data-lite=""><LiteComposer sessionId={id} /></div></ConvexProvider>);
  });
  await pause(30);
}
const textarea = () => host.querySelector("textarea[data-composer-field]") as HTMLTextAreaElement | null;

test("the owner gets the app's composer", async () => {
  await mount(MINE);
  expect(textarea()).toBeTruthy();
  expect(host.textContent).not.toContain("Read only");
});

test("a teammate's team session takes a message addressed to its owner's agent", async () => {
  await mount(MAYAS);
  expect(textarea()?.getAttribute("placeholder")).toBe("Message Maya's agent");
});

test("a session the viewer can only read (a teammate's hosted agent) shows one quiet line and no composer", async () => {
  await mount(HOSTED);
  expect(textarea()).toBeNull();
  expect(host.querySelector(".lt-readonly")?.textContent).toBe("Read only");
});

test("until the server says who the viewer is to someone else's session, nothing that sends is drawn", async () => {
  // Routed to the team (team_id) is not access: the meta's level is.
  await mount(UNKNOWN);
  expect(textarea()).toBeNull();
  expect(host.querySelector(".lt-composer")).toBeNull();
});

test("a pending permission takes the composer's place", async () => {
  useInboxStore.setState({
    pendingPermissions: { p1: { _id: "p1", conversation_id: MINE, status: "pending", created_at: Date.now(), tool_name: "Bash", arguments_preview: "rm -rf .cache" } },
  } as any);
  await mount(MINE);
  expect(textarea()).toBeNull();
  expect(host.textContent).toContain("rm -rf .cache");
});

test("a cast decide ask docks above the composer and answers with one press", async () => {
  const id = "d".repeat(32);
  useInboxStore.setState({
    sessionDecisions: { [id]: { _id: id, conversation_id: MINE, status: "pending", question: "Ship behind a flag?", options: [{ label: "Ship now" }, { label: "Flag it" }], blocking: false, created_at: Date.now() } },
  } as any);
  await mount(MINE);
  const card = host.querySelector(".lt-decide");
  expect(card?.textContent).toContain("Ship behind a flag?");
  expect(textarea()).toBeTruthy();
  const flag = [...host.querySelectorAll<HTMLButtonElement>(".lt-decide-opt")].find((b) => b.textContent?.includes("Flag it"))!;
  expect(flag.textContent).toContain("2");
  await act(async () => flag.click());
  await pause(10);
  expect((useInboxStore.getState() as any).sessionDecisions[id].status).not.toBe("pending");
});

test("every option draws, the first nine with a digit; a blocking ask takes focus and its digits answer", async () => {
  const id = "f".repeat(32);
  const options = Array.from({ length: 11 }, (_, i) => ({ label: `Option ${i + 1}` }));
  useInboxStore.setState({
    sessionDecisions: { [id]: { _id: id, conversation_id: MINE, status: "pending", question: "Which one?", options, blocking: true, created_at: Date.now() } },
  } as any);
  await mount(MINE);
  const card = host.querySelector<HTMLElement>(".lt-decide")!;
  expect(card.querySelectorAll(".lt-decide-opt").length).toBe(11);
  expect(card.querySelectorAll(".lt-decide-key").length).toBe(9);
  expect(w.document.activeElement).toBe(card);
  await act(async () => { card.dispatchEvent(new w.KeyboardEvent("keydown", { key: "3", bubbles: true })); });
  await pause(10);
  expect((useInboxStore.getState() as any).sessionDecisions[id].status).not.toBe("pending");
});
