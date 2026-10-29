// Lite's shortcuts sheet, on ? (ui.toggleShortcutsHelp). It lists the keys
// Lite answers (lib/lite/liteKeys) with their live bindings, and nothing
// else: the classic sheet lists every context of the classic app, whose
// handlers Lite never mounts. A row opens the keyboard settings on that key.
import { useMemo } from "react";
import { Keyboard, X } from "lucide-react";
import { useTrackedStore } from "../../store/inboxStore";
import { useEventListener } from "../../hooks/useEventListener";
import { formatShortcutParts, getShortcutsForAction, useKeyBindingsVersion } from "../../shortcuts";
import { rebindShortcut } from "../../lib/keyboardSettings";
import { LITE_KEYS } from "../../lib/lite/liteKeys";
import { useLiteSidebarModel } from "../../lib/lite/useLiteSidebar";
import { KeyCap } from "../KeyboardShortcutsHelp";

export function LiteShortcutsSheet() {
  const s = useTrackedStore([
    (st) => st.shortcutsPanelOpen,
    (st) => st.clientState.ui?.key_bindings,
  ]);
  const open = s.shortcutsPanelOpen;
  const { onTeam } = useLiteSidebarModel();
  const bindingsVersion = useKeyBindingsVersion();

  useEventListener("keydown", (e: KeyboardEvent) => {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      s.toggleShortcutsPanel();
    }
  });

  const rows = useMemo(() => {
    const out: { action: (typeof LITE_KEYS)[number]["action"]; label: string; parts: string[] }[] = [];
    for (const key of LITE_KEYS) {
      if (key.teamOnly && !onTeam) continue;
      // Live bindings: a rebound key shows its own chord, an unbound one drops out.
      const def = getShortcutsForAction(key.action)[0];
      if (def) out.push({ action: key.action, label: key.label, parts: formatShortcutParts(def) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTeam, bindingsVersion]);

  if (!open) return null;
  return (
    <aside className="lt-keys" aria-label="Keyboard shortcuts">
      <div className="lt-panel-head">
        <Keyboard aria-hidden className="h-4 w-4 text-[var(--lt-text-3)]" />
        <span className="min-w-0 flex-1 truncate">Keyboard shortcuts</span>
        <button type="button" className="lt-icon-btn" aria-label="Close keyboard shortcuts" onClick={s.toggleShortcutsPanel}>
          <X aria-hidden />
        </button>
      </div>
      <div className="lt-scroll px-2 py-2">
        {rows.map((row) => (
          <button
            key={row.action}
            type="button"
            className="lt-key-row"
            aria-label={`Change shortcut: ${row.label}`}
            onClick={() => rebindShortcut(row.action)}
          >
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className="flex shrink-0 items-center gap-[3px]">
              {row.parts.map((part, i) => <KeyCap key={i}>{part}</KeyCap>)}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
