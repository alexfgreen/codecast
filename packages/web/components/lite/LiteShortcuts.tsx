// Lite's keyboard. It turns on the "lite" shortcut context (so the lite.*
// chords fire here and nowhere else) and answers the shared actions with
// Lite's own meaning: ⌘K opens Lite's palette, the next/previous session keys
// walk the sidebar as drawn, ? opens the shortcuts sheet. The classic
// handlers (useGlobalShortcutActions) are never mounted in Lite, so no key
// is answered twice. A handler that returns false declines, and the key
// falls through to the next definition bound to it.
import { useNavigate } from "react-router";
import { useInboxStore } from "../../store/inboxStore";
import { useShortcutAction, useShortcutContext } from "../../shortcuts";
import { liteSessionPath } from "../../lib/inboxRouting";
import { useLiteLayout } from "../../lib/lite/liteLayout";
import { useLiteSidebarModel } from "../../lib/lite/useLiteSidebar";
import { liteStep } from "../../lib/lite/sidebarModel";

export function LiteShortcuts() {
  useShortcutContext("lite", true);
  const layout = useLiteLayout();
  const model = useLiteSidebarModel();
  const navigate = useNavigate();

  const step = (dir: 1 | -1) => {
    const id = liteStep(model.order, model.activeId, dir);
    if (!id) return false;
    navigate(liteSessionPath(id));
  };

  useShortcutAction("palette.toggle", () => layout.togglePalette());
  useShortcutAction("session.next", () => step(1));
  useShortcutAction("session.prev", () => step(-1));
  useShortcutAction("ui.toggleShortcutsHelp", () => useInboxStore.getState().toggleShortcutsPanel());
  useShortcutAction("lite.toggleSidebar", () => layout.toggleSidebar());
  useShortcutAction("lite.toggleRightPanel", () => {
    // The panel shows what a session changed; with none open it has nothing.
    if (!model.activeId) return false;
    layout.toggleRightPanel();
  });
  useShortcutAction("lite.needsYou", () => {
    navigate("/lite/needs-you");
  });
  useShortcutAction("lite.team", () => {
    if (!model.onTeam) return false;
    navigate("/lite/team");
  });
  // Lite has no composer until the conversation wave, so it declines the key
  // rather than lead somewhere that cannot start a session.
  useShortcutAction("lite.newSession", () => false);
  return null;
}
