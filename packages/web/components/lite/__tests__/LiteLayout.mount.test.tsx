import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { replaceGlobals } from "../../../test-helpers/globals";
import { closeDomWindow } from "../../../test-helpers/domGlobals";
import { useLiteLayout, type LiteLayoutState } from "../../../lib/lite/liteLayout";
import { LiteLayoutProvider } from "../LiteLayoutContext";

// The frame's arrangement at each width a person meets it: a phone, a window
// too narrow to dock the right panel, a wide one. Opening the palette closes
// whatever modal sheet would sit over it and swallow its focus.

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://codecast.sh/lite" });
let width = 1280;
// A media query answered from `width` (min-width / max-width only).
dom.window.matchMedia = ((query: string) => {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
  return { matches, media: query, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList;
}) as typeof dom.window.matchMedia;
const restoreGlobals = replaceGlobals({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import("react-dom/client");
afterAll(() => { closeDomWindow(dom); restoreGlobals(); });

let frame: LiteLayoutState;
function Probe() {
  frame = useLiteLayout();
  return null;
}

async function mountAt(px: number) {
  width = px;
  const slot = document.createElement("aside");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<LiteLayoutProvider rightPanelHost={slot}><Probe /></LiteLayoutProvider>);
  });
  return { slot, unmount: () => act(() => root.unmount()) };
}

test("on a phone, Search closes the drawer and the panel's sheet before the palette opens", async () => {
  const { unmount } = await mountAt(390);
  expect(frame.isPhone).toBe(true);
  expect(frame.rightPanelSheet).toBe(true);
  await act(async () => frame.setSidebarOpen(true));
  await act(async () => frame.setRightPanelOpen(true));
  expect(frame.sidebarOpen).toBe(true);
  await act(async () => frame.setPaletteOpen(true));
  expect(frame.paletteOpen).toBe(true);
  expect(frame.sidebarOpen).toBe(false);
  expect(frame.rightPanelOpen).toBe(false);
  await unmount();
});

test("too narrow to dock, the right panel is a sheet and leaves the column its room", async () => {
  const { unmount } = await mountAt(1024);
  expect(frame.isPhone).toBe(false);
  expect(frame.rightPanelSheet).toBe(true);
  expect(frame.rightPanelHost).toBeNull();
  await unmount();
});

test("wide, the right panel docks, and the palette leaves the docked frame as it was", async () => {
  const { slot, unmount } = await mountAt(1440);
  expect(frame.rightPanelSheet).toBe(false);
  expect(frame.rightPanelHost).toBe(slot);
  await act(async () => frame.setRightPanelOpen(true));
  await act(async () => frame.setPaletteOpen(true));
  expect(frame.paletteOpen).toBe(true);
  expect(frame.sidebarOpen).toBe(true);
  expect(frame.rightPanelOpen).toBe(true);
  await unmount();
});
