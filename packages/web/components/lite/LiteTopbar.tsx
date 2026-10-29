// The top of Lite's center column. It leads with the sidebar's switch (the
// drawer's button on a phone, the dock's on a wide screen), then whatever the
// page puts there.
import type { ReactNode } from "react";
import { Menu, PanelLeft } from "lucide-react";
import { useLiteLayout } from "../../lib/lite/liteLayout";
import { ShortcutTooltip } from "../KeyboardShortcutsHelp";

export function LiteTopbar({ children }: { children?: ReactNode }) {
  const { isPhone, sidebarOpen, setSidebarOpen, toggleSidebar } = useLiteLayout();
  return (
    <header className="lt-topbar">
      {isPhone ? (
        <button type="button" className="lt-icon-btn -ml-1.5" aria-label="Open sessions" onClick={() => setSidebarOpen(true)}>
          <Menu aria-hidden />
        </button>
      ) : (
        <ShortcutTooltip label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} action="lite.toggleSidebar">
          <button type="button" className="lt-icon-btn -ml-1" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} onClick={toggleSidebar}>
            <PanelLeft aria-hidden />
          </button>
        </ShortcutTooltip>
      )}
      {children}
    </header>
  );
}
