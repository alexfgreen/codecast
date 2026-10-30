// Codecast Lite's frame: a pathless layout route (src/App.tsx) around every
// /lite page. Sidebar | the page | the right panel, a palette on ⌘K.
//
// It stands outside DashboardShell and DashboardLayout, as /people does, so
// it mounts for itself what the classic shell would: the auth gate, the
// hydration gate, the store's feeders and write wiring (DashboardSyncEffects,
// the same component the classic shell mounts, plus the few feeders that live
// in the classic chrome: useLiteFeeders), the undo reach, the settings modal
// that /settings links open, and its own shortcut handlers and sheet. It reads the same
// store as the classic UI and keeps no second copy of anything.
import "./lite.css";
import { lazy, Suspense, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { useInboxStore } from "@/store/inboxStore";
import { AuthGuard } from "@/components/AuthGuard";
import { AppLoader } from "@/components/AppLoader";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DashboardSyncEffects } from "@/components/DashboardSyncEffects";
import { UndoReach } from "@/components/undo/UndoTimeline";
import { MobileDrawer } from "@/components/MobileDrawer";
import { LiteRouteParams } from "@/lib/liteRouteParams";
import { useLiteFeeders } from "@/hooks/useLiteFeeders";
import { useWatchEffect } from "@/hooks/useWatchEffect";
import { useLiteLayout } from "@/lib/lite/liteLayout";
import { LiteLayoutProvider } from "@/components/lite/LiteLayoutContext";
import { LiteSidebarModelProvider } from "@/components/lite/LiteSidebarModel";
import { LiteSidebar } from "@/components/lite/LiteSidebar";
import { LiteShortcuts } from "@/components/lite/LiteShortcuts";
import { LitePalette } from "@/components/lite/LitePalette";
import { LiteShortcutsSheet } from "@/components/lite/LiteShortcutsSheet";

const SettingsModal = lazy(() => import("@/components/settings/SettingsModal").then((m) => ({ default: m.SettingsModal })));

export default function LiteShell() {
  return (
    <AuthGuard>
      <LiteHydrated />
    </AuthGuard>
  );
}

function LiteHydrated() {
  // Hold the first paint until the IDB hydration pass lands, as the classic
  // shell does: without it the first frame paints "No sessions yet" for a
  // beat before the cached rows pop in. The flag flips true even on an empty
  // or unreadable cache, so this cannot hang.
  const hydrated = useInboxStore((s) => s.clientStateInitialized);
  if (!hydrated) return <AppLoader deferIndicator />;
  return (
    <LiteRouteParams>
      {/* Each behind its own inline boundary: a query that throws degrades to
          "this data didn't arrive", never to a blank window. */}
      <ErrorBoundary name="LiteSync" level="inline" fallback={null}>
        <DashboardSyncEffects />
      </ErrorBoundary>
      <ErrorBoundary name="LiteFeeders" level="inline" fallback={null}>
        <LiteFeeders />
      </ErrorBoundary>
      {/* ⌘Z, the held peek and the card a toast's History opens. */}
      <UndoReach />
      <LiteFrame />
    </LiteRouteParams>
  );
}

function LiteFeeders() {
  useLiteFeeders();
  return null;
}

function LiteFrame() {
  const [rightPanelHost, setRightPanelHost] = useState<HTMLElement | null>(null);
  return (
    <LiteLayoutProvider rightPanelHost={rightPanelHost}>
      <LiteSidebarModelProvider>
        <LiteBody onRightPanelHost={setRightPanelHost} />
        <LiteShortcuts />
        <LiteOverlays />
      </LiteSidebarModelProvider>
    </LiteLayoutProvider>
  );
}

function LiteBody({ onRightPanelHost }: { onRightPanelHost: (el: HTMLElement | null) => void }) {
  const { isPhone, sidebarOpen, setSidebarOpen, paletteOpen } = useLiteLayout();
  const pathname = useLocation().pathname;
  // A phone's drawer closes once it has taken the person somewhere.
  useWatchEffect(() => {
    if (isPhone) setSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    // While the palette is open the frame behind it is inert: the palette is
    // a modal dialog, so Tab and a screen reader stay inside it.
    <div data-lite="" data-cc-shell="" className="lt-shell" inert={paletteOpen}>
      {isPhone ? (
        <MobileDrawer open={sidebarOpen} onOpenChange={setSidebarOpen} side="left" title="Sessions" className="lt-drawer">
          <div data-lite="" className="lt-drawer-body h-full">
            <LiteSidebar />
          </div>
        </MobileDrawer>
      ) : sidebarOpen ? (
        <LiteSidebar />
      ) : null}
      <main className="lt-main">
        {/* The frame stays while a page's chunk loads. */}
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
      {/* The right panel's slot: a page's LiteRightPanel draws into it, and
          it hides itself while empty (lite.css). */}
      <aside ref={onRightPanelHost} className="lt-right" aria-label="Session details" />
      <LiteShortcutsSheet />
    </div>
  );
}

function LiteOverlays() {
  const { paletteOpen } = useLiteLayout();
  // Each mounted only while open, so a closed one runs no hooks (and the
  // settings modal's chunk loads on first use).
  const settingsOpen = useInboxStore((s) => !!s.settingsModalSection);
  return (
    <>
      {paletteOpen && <LitePalette />}
      {settingsOpen && (
        <ErrorBoundary name="SettingsModal" level="panel">
          <Suspense fallback={null}>
            <SettingsModal />
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}
