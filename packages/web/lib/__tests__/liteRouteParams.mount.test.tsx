import { afterAll, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { replaceGlobals } from "../../test-helpers/globals";
import { closeDomWindow } from "../../test-helpers/domGlobals";
import { useInboxStore, type AppTab } from "../../store/inboxStore";
import { useParams, usePathname, useRouter, useSearchParams } from "../../src/compat/next-navigation";
import { LiteRouteParams } from "../liteRouteParams";

// Inside Lite the compat hooks answer with Lite's own route, not the classic
// active tab's (which still hydrates in this window), and a reused
// component's push to a classic conversation address opens it in Lite.

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://codecast.sh/lite" });
const restoreGlobals = replaceGlobals({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");

afterAll(() => { closeDomWindow(dom); restoreGlobals(); });

const inboxTab: AppTab = { id: "t1", title: "Inbox", path: "/inbox", createdAt: 0 };
beforeEach(() => { useInboxStore.setState({ tabs: [inboxTab], activeTabId: "t1" } as any); });

let seen: { pathname: string; sessionId?: string; m: string | null; push: (p: string) => void } | null = null;
let routerLocation = "";

function Probe() {
  const pathname = usePathname();
  const params = useParams<{ sessionId?: string }>();
  const search = useSearchParams();
  const router = useRouter();
  seen = { pathname, sessionId: params.sessionId, m: search.get("m"), push: router.push };
  return null;
}

function Where() {
  const loc = useLocation();
  routerLocation = loc.pathname + loc.search + loc.hash;
  return null;
}

async function mount(at: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const lite = <LiteRouteParams><Probe /></LiteRouteParams>;
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <Where />
        <Routes>
          <Route path="lite" element={lite} />
          <Route path="lite/:sessionId" element={lite} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return () => act(() => root.unmount());
}

test("the compat hooks read Lite's route, not the classic active tab", async () => {
  const unmount = await mount("/lite/jx7abc?m=m1");
  expect(seen).toMatchObject({ pathname: "/lite/jx7abc", sessionId: "jx7abc", m: "m1" });
  await unmount();
});

test("a push to a classic conversation address opens it in Lite", async () => {
  const unmount = await mount("/lite");
  expect(seen?.pathname).toBe("/lite");
  await act(async () => seen!.push("/conversation/jx7xyz#msg-m2"));
  expect(routerLocation).toBe("/lite/jx7xyz#msg-m2");
  expect(seen).toMatchObject({ pathname: "/lite/jx7xyz", sessionId: "jx7xyz" });
  // A page Lite does not have leaves for the classic one, through the real
  // router: the classic tab is never rewritten from here.
  await act(async () => seen!.push("/tasks/ct-1"));
  expect(routerLocation).toBe("/tasks/ct-1");
  expect(useInboxStore.getState().tabs[0].path).toBe("/inbox");
  await unmount();
});
