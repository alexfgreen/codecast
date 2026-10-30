// The Lite frame's state provider: sidebar, right panel and palette, open or
// closed. The state's shape and its reader (useLiteLayout) live in
// lib/lite/liteLayout so this module exports a component and nothing else.
//
// What is remembered per viewer (localStorage, never the store: this is one
// person's arrangement of one browser, not something to sync) is the docked
// sidebar and the docked right panel. The phone drawer, a sheet and the
// palette always start closed.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useIsPhone, useMinWidth } from "../../hooks/useIsPhone";
import { LiteLayoutCtx, readLitePref, writeLitePref, type LiteLayoutState } from "../../lib/lite/liteLayout";

const SIDEBAR_PREF = "sidebarOpen";
const RIGHT_PANEL_PREF = "rightPanelOpen";
/** The narrowest window the right panel docks in: its 400px beside the
 *  264px sidebar still leaves the conversation and the topbar's controls
 *  their room. Narrower, it is a sheet over the conversation, as on a phone. */
const RIGHT_PANEL_DOCK_MIN = 1100;

export function LiteLayoutProvider({ rightPanelHost, children }: { rightPanelHost: HTMLElement | null; children: ReactNode }) {
  const isPhone = useIsPhone();
  const rightPanelSheet = !useMinWidth(RIGHT_PANEL_DOCK_MIN);
  const [docked, setDocked] = useState(() => readLitePref<unknown>(SIDEBAR_PREF, true) !== false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A sheet opens on the conversation, never on a remembered sheet over it.
  const [rightPanelOpen, setRightPanelOpenState] = useState(() => !rightPanelSheet && readLitePref<unknown>(RIGHT_PANEL_PREF, false) === true);
  const [paletteOpen, setPaletteOpenState] = useState(false);

  const setSidebarOpen = useCallback((open: boolean) => {
    if (isPhone) {
      setDrawerOpen(open);
      return;
    }
    setDocked(open);
    writeLitePref(SIDEBAR_PREF, open);
  }, [isPhone]);
  const sidebarOpen = isPhone ? drawerOpen : docked;
  const toggleSidebar = useCallback(() => setSidebarOpen(!sidebarOpen), [setSidebarOpen, sidebarOpen]);

  const setRightPanelOpen = useCallback((open: boolean) => {
    setRightPanelOpenState(open);
    // A sheet is a moment, not a layout: opening it there must not dock the
    // panel on the next wide screen.
    if (!rightPanelSheet) writeLitePref(RIGHT_PANEL_PREF, open);
  }, [rightPanelSheet]);
  const toggleRightPanel = useCallback(() => setRightPanelOpen(!rightPanelOpen), [setRightPanelOpen, rightPanelOpen]);

  // The palette opens over everything. The phone drawer and a right-panel
  // sheet are modal dialogs that trap focus and make the rest of the page
  // inert, the palette included, so they close first.
  const setPaletteOpen = useCallback((open: boolean) => {
    if (open) {
      setDrawerOpen(false);
      if (rightPanelSheet) setRightPanelOpenState(false);
    }
    setPaletteOpenState(open);
  }, [rightPanelSheet]);
  const togglePalette = useCallback(() => setPaletteOpen(!paletteOpen), [setPaletteOpen, paletteOpen]);

  const value = useMemo<LiteLayoutState>(() => ({
    isPhone,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    rightPanelOpen,
    setRightPanelOpen,
    toggleRightPanel,
    rightPanelSheet,
    paletteOpen,
    setPaletteOpen,
    togglePalette,
    rightPanelHost: rightPanelSheet ? null : rightPanelHost,
  }), [isPhone, sidebarOpen, setSidebarOpen, toggleSidebar, rightPanelOpen, setRightPanelOpen, toggleRightPanel, rightPanelSheet, paletteOpen, setPaletteOpen, togglePalette, rightPanelHost]);

  return <LiteLayoutCtx.Provider value={value}>{children}</LiteLayoutCtx.Provider>;
}
