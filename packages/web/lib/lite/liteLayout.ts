// Codecast Lite's frame state: whether the sidebar, the right panel and the
// palette are open, and where the right panel draws. Store-free on purpose:
// this is one viewer's arrangement of one window, not shared state, so it
// lives in React and the remembered parts in localStorage (per viewer, per
// browser). Lives in lib, not beside its provider (components/lite/
// LiteLayoutContext), so the provider module exports only a component and
// stays a Fast Refresh boundary (lib/__tests__/fastRefreshBoundaries.guard).
import { createContext, useContext } from "react";

export type LiteLayoutState = {
  /** Phone width (useIsPhone): the sidebar is a drawer, the right panel a sheet. */
  isPhone: boolean;
  /** The sidebar is showing: docked on a wide screen, the drawer on a phone. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  /** Lite's own ⌘K palette. Not the store's `palette`: that one opens the
   *  classic CommandPalette, which Lite never mounts. */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  /** The right panel's slot on a wide screen. A page's LiteRightPanel draws
   *  into it; null until the frame has mounted, and on a phone. */
  rightPanelHost: HTMLElement | null;
};

const noop = () => {};
const OUTSIDE: LiteLayoutState = {
  isPhone: false,
  sidebarOpen: true,
  setSidebarOpen: noop,
  toggleSidebar: noop,
  rightPanelOpen: false,
  setRightPanelOpen: noop,
  toggleRightPanel: noop,
  paletteOpen: false,
  setPaletteOpen: noop,
  togglePalette: noop,
  rightPanelHost: null,
};

export const LiteLayoutCtx = createContext<LiteLayoutState | null>(null);

/** The frame's state. Outside the Lite shell (a reused part rendered
 *  elsewhere) it answers with a closed frame whose toggles do nothing. */
export function useLiteLayout(): LiteLayoutState {
  return useContext(LiteLayoutCtx) ?? OUTSIDE;
}

const PREFIX = "codecast.lite.";

/** A remembered per-viewer choice, or `fallback` when there is none or the
 *  browser will not say (a private window, blocked site data, a preview). */
export function readLitePref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Remember a per-viewer choice. Best effort: a browser that refuses keeps
 *  the choice for this page load only. */
export function writeLitePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the choice simply is not remembered.
  }
}
