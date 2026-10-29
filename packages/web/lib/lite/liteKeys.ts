// The keys Codecast Lite answers, in the order its shortcuts sheet lists them,
// with the words the sheet uses. Lite mounts none of the classic handlers, so
// a key it does not answer here does nothing in Lite and has no place on its
// sheet. The catalog's own descriptions are for the classic keyboard settings
// and the CLI, where Lite's actions sit beside classic ones and say "Lite".
import type { ShortcutAction } from "../../shortcuts";

export type LiteKey = {
  action: ShortcutAction;
  label: string;
  /** Answered only while the active workspace is a team. */
  teamOnly?: boolean;
};

export const LITE_KEYS: readonly LiteKey[] = [
  { action: "palette.toggle", label: "Search and actions" },
  { action: "session.next", label: "Next session" },
  { action: "session.prev", label: "Previous session" },
  { action: "lite.needsYou", label: "Needs you" },
  { action: "lite.team", label: "The team", teamOnly: true },
  { action: "lite.toggleSidebar", label: "Toggle the sidebar" },
  { action: "lite.toggleRightPanel", label: "Toggle the right panel" },
  { action: "ui.toggleShortcutsHelp", label: "Keyboard shortcuts" },
];
