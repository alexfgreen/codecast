// The Lite frame's state provider: sidebar, right panel and palette, open or
// closed. The state's shape and its reader (useLiteLayout) live in
// lib/lite/liteLayout so this module exports a component and nothing else.
//
// What is remembered per viewer (localStorage, never the store: this is one
// person's arrangement of one browser, not something to sync) is the docked
// sidebar and the right panel. The phone drawer and the palette always start
// closed.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useIsPhone } from "../../hooks/useIsPhone";
import { LiteLayoutCtx, readLitePref, writeLitePref, type LiteLayoutState } from "../../lib/lite/liteLayout";

const SIDEBAR_PREF = "sidebarOpen";
const RIGHT_PANEL_PREF = "rightPanelOpen";

export function LiteLayoutProvider({ rightPanelHost, children }: { rightPanelHost: HTMLElement | null; children: ReactNode }) {
  const isPhone = useIsPhone();
  const [docked, setDocked] = useState(() => readLitePref(SIDEBAR_PREF, true));
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A phone opens on the conversation, never on a remembered sheet over it.
  const [rightPanelOpen, setRightPanelOpenState] = useState(() => !isPhone && readLitePref(RIGHT_PANEL_PREF, false));
  const [paletteOpen, setPaletteOpen] = useState(false);

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
    // The phone's sheet is a moment, not a layout: opening it there must not
    // dock the panel on the next wide screen.
    if (!isPhone) writeLitePref(RIGHT_PANEL_PREF, open);
  }, [isPhone]);
  const toggleRightPanel = useCallback(() => setRightPanelOpen(!rightPanelOpen), [setRightPanelOpen, rightPanelOpen]);

  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), []);

  const value = useMemo<LiteLayoutState>(() => ({
    isPhone,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    rightPanelOpen,
    setRightPanelOpen,
    toggleRightPanel,
    paletteOpen,
    setPaletteOpen,
    togglePalette,
    rightPanelHost: isPhone ? null : rightPanelHost,
  }), [isPhone, sidebarOpen, setSidebarOpen, toggleSidebar, rightPanelOpen, setRightPanelOpen, toggleRightPanel, paletteOpen, togglePalette, rightPanelHost]);

  return <LiteLayoutCtx.Provider value={value}>{children}</LiteLayoutCtx.Provider>;
}
