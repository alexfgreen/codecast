// Runs the Lite sidebar's model once for the window (lib/lite/useLiteSidebar)
// and shares it with its readers: the sidebar, the next/previous keys and the
// palette. `children` is the shell's own element tree, so a model change
// re-renders the readers and leaves the frame and the page alone.
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { liteSessionIdFromPath } from "../../lib/inboxRouting";
import { LiteSidebarModelCtx, useLiteSidebarData } from "../../lib/lite/useLiteSidebar";

export function LiteSidebarModelProvider({ children }: { children: ReactNode }) {
  const activeId = liteSessionIdFromPath(useLocation().pathname);
  const model = useLiteSidebarData(activeId);
  return <LiteSidebarModelCtx.Provider value={model}>{children}</LiteSidebarModelCtx.Provider>;
}
