// Needs you's list: the model's items (lib/lite/needsYou, gathered once in
// the sidebar's model) under their sections, most urgent first, each section
// only when it holds something, its count in its head. One row at a time
// holds the keyboard's focus: ↑/↓ or j/k move it, and the row answers its
// own keys (Enter, 1 to 9, y/n, e). When a row is answered and leaves, the
// focus moves to the row that took its place, so a run of answers is a run
// of keys.
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { keyBelongsElsewhere } from "../../../shortcuts/keyOwnership";
import { useWatchEffect } from "../../../hooks/useWatchEffect";
import { liteNeedsKey, liteNeedsSections, type LiteNeedsItem, type LiteNeedsSection } from "../../../lib/lite/needsYou";
import { markLiteNoticesRead, markLiteSessionsRead } from "../../../lib/lite/needsYouActions";
import { LiteNeedsFinishedRow, LiteNeedsHandedRow, LiteNeedsMentionRow, LiteNeedsQuestionRow, LiteNeedsStoppedRow } from "./LiteNeedsRows";
import "./needs.css";

const SECTION_NAMES: Record<LiteNeedsSection, string> = {
  questions: "Questions",
  stopped: "Stopped",
  handed: "Handed to you",
  mentions: "Mentions",
  finished: "Finished",
};

/** The press that clears a whole section, where one does. */
function clearAll(section: LiteNeedsSection, items: readonly LiteNeedsItem[]): (() => void) | null {
  if (section === "mentions") {
    return () => markLiteNoticesRead(items.flatMap((i) => (i.section === "mentions" ? [i.notificationId] : [])));
  }
  if (section === "finished") {
    return () => markLiteSessionsRead(items.flatMap((i) => (i.section === "finished" ? [i.sessionId] : [])));
  }
  return null;
}

export function LiteNeedsList({ items, now }: { items: readonly LiteNeedsItem[]; now: number }) {
  const sections = useMemo(() => liteNeedsSections(items), [items]);
  const listRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Where the focus last was, so a row that leaves hands it to the next.
  const lastIndex = useRef(0);
  const keys = useMemo(() => items.map((i) => i.key), [items]);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const current = focusKey && keys.includes(focusKey) ? focusKey : keys[0] ?? null;

  const onFocusRow = useCallback((key: string) => {
    setFocusKey(key);
    lastIndex.current = Math.max(0, keysRef.current.indexOf(key));
  }, []);

  // The focus fell to the page (the row holding it was answered and left, or
  // the page just opened): give it to the row now at that place. On arrival,
  // the press that brought the person here (the sidebar's link, a top bar
  // button) still holds it, and the list takes it from there too. Focus the
  // person put somewhere else stays where they put it.
  const keysSig = keys.join("\x1f");
  const arrived = useRef(false);
  useWatchEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const arriving = !arrived.current;
    arrived.current = true;
    const active = document.activeElement;
    const idle = !active || active === document.body || active === document.documentElement;
    if (!idle && !(arriving && active.closest(".lt-sidebar, .lt-topbar"))) return;
    const rows = list.querySelectorAll<HTMLElement>("[data-needs-row]");
    rows[Math.min(lastIndex.current, rows.length - 1)]?.focus({ preventScroll: true });
  }, [keysSig]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (keyBelongsElsewhere(e.target)) return;
    const key = liteNeedsKey(e);
    if (key?.kind !== "move") return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-needs-row]"));
    if (rows.length === 0) return;
    const at = rows.indexOf((e.target as HTMLElement).closest<HTMLElement>("[data-needs-row]")!);
    const next = key.to === "first" ? 0
      : key.to === "last" ? rows.length - 1
      : at === -1 ? 0
      : Math.min(rows.length - 1, Math.max(0, at + (key.to === "next" ? 1 : -1)));
    e.preventDefault();
    rows[next]?.focus();
  };

  return (
    <div ref={listRef} className="lt-needs" onKeyDown={onKeyDown}>
      {sections.map(({ section, items: rows }) => {
        const clear = clearAll(section, rows);
        const headId = `lt-needs-${section}`;
        return (
          <section key={section} aria-labelledby={headId}>
            <div className="lt-needs-head" data-attention={section === "questions" || section === "stopped" ? "" : undefined}>
              <span id={headId}>{SECTION_NAMES[section]}</span>
              <span className="lt-needs-n">{rows.length}</span>
              {clear && (
                <button type="button" className="lt-needs-headbtn" onClick={clear}>Mark all read</button>
              )}
            </div>
            <div className="lt-list" role="list" aria-labelledby={headId}>
              {rows.map((item) => {
                const props = { focused: item.key === current, now, onFocusRow };
                switch (item.section) {
                  case "questions":
                    return <LiteNeedsQuestionRow key={item.key} item={item} {...props} />;
                  case "stopped":
                    return <LiteNeedsStoppedRow key={item.key} item={item} {...props} />;
                  case "handed":
                    return <LiteNeedsHandedRow key={item.key} item={item} {...props} />;
                  case "mentions":
                    return <LiteNeedsMentionRow key={item.key} item={item} {...props} />;
                  case "finished":
                    return <LiteNeedsFinishedRow key={item.key} item={item} {...props} />;
                }
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
