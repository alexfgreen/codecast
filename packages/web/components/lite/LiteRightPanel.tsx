// The right panel, as a page draws it: <LiteRightPanel title="Changes">…
// </LiteRightPanel>. On a wide screen it fills the shell's slot beside the
// conversation; narrower it is a sheet over it (full screen on a phone),
// so it never squeezes the conversation to nothing. It shows only
// while the panel is open (lite.toggleRightPanel), and a page that renders
// none leaves the slot empty, which hides it.
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLiteLayout } from "../../lib/lite/liteLayout";
import { MobileDrawer } from "../MobileDrawer";
import { ShortcutTooltip } from "../KeyboardShortcutsHelp";

export function LiteRightPanel({ title, children }: { title: string; children: ReactNode }) {
  const { rightPanelSheet, rightPanelOpen, setRightPanelOpen, rightPanelHost } = useLiteLayout();
  if (rightPanelSheet) {
    return (
      <MobileDrawer open={rightPanelOpen} onOpenChange={setRightPanelOpen} side="right" title={title} className="lt-drawer">
        <div data-lite="" className="flex h-full min-h-0 flex-col">
          <div className="lt-scroll">{children}</div>
        </div>
      </MobileDrawer>
    );
  }
  if (!rightPanelOpen || !rightPanelHost) return null;
  return createPortal(
    <>
      <div className="lt-panel-head">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ShortcutTooltip label="Close panel" action="lite.toggleRightPanel">
          <button type="button" className="lt-icon-btn" aria-label="Close panel" onClick={() => setRightPanelOpen(false)}>
            <X aria-hidden />
          </button>
        </ShortcutTooltip>
      </div>
      <div className="lt-scroll">{children}</div>
    </>,
    rightPanelHost,
  );
}
