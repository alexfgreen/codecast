// The right panel of a Lite session: what it changed and, when it works a
// task, that task. Two tabs (useLiteLayout's rightPanelTab), the task's only
// while the session has one; alone, the changes need no tab strip. Nothing
// here runs while the panel is closed: LiteRightPanel draws its children
// only while it shows, so the change feed and the diff work start on open.
import { useRef, type KeyboardEvent } from "react";
import { useTrackedStore, type TaskRef } from "../../../store/inboxStore";
import { useWatchEffect } from "../../../hooks/useWatchEffect";
import { useLiteLayout, type LiteRightPanelTab } from "../../../lib/lite/liteLayout";
import { LiteRightPanel } from "../LiteRightPanel";
import { LiteChangesTab } from "./LiteChangesTab";
import { LiteTaskTab } from "./LiteTaskTab";
import "./panel.css";

const TABS: ReadonlyArray<{ tab: LiteRightPanelTab; label: string }> = [
  { tab: "changes", label: "Changes" },
  { tab: "task", label: "Task" },
];

export function LiteSessionPanel({ sessionId }: { sessionId: string }) {
  const { rightPanelTab, setRightPanelTab, rightPanelFocus } = useLiteLayout();
  // The session row's task, woken by the four fields the tab reads, never by
  // the row's heartbeat.
  const s = useTrackedStore([(s) => taskRefSig(activeTaskOf(s.sessions[sessionId] ?? s.conversations[sessionId]))]);
  const task = activeTaskOf(s.sessions[sessionId] ?? s.conversations[sessionId]);
  const tab: LiteRightPanelTab = task ? rightPanelTab : "changes";
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // A file asked for while the panel shows (an edit row's open-in-changes)
  // lives on the changes tab, whichever tab was up.
  const seenFocus = useRef(rightPanelFocus);
  useWatchEffect(() => {
    if (rightPanelFocus && rightPanelFocus !== seenFocus.current && rightPanelTab !== "changes") setRightPanelTab("changes");
    seenFocus.current = rightPanelFocus;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightPanelFocus]);

  // Arrow keys move between the tabs, as a tab strip's do.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const at = TABS.findIndex((t) => t.tab === tab);
    const next = (at + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    setRightPanelTab(TABS[next].tab);
    tabRefs.current[next]?.focus();
  };

  return (
    <LiteRightPanel title={task ? "Details" : "Changes"}>
      <div key={sessionId} className="lt-panel" data-tabs={task ? "" : undefined}>
        {task && (
          <div className="lt-tabs" role="tablist" aria-label="Session details" onKeyDown={onTabKey}>
            {TABS.map((t, i) => (
              <button
                key={t.tab}
                ref={(el) => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`lt-tab-${t.tab}`}
                aria-selected={tab === t.tab}
                aria-controls={`lt-tabpanel-${t.tab}`}
                tabIndex={tab === t.tab ? 0 : -1}
                className="lt-tab"
                onClick={() => setRightPanelTab(t.tab)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div
          className="lt-tabpanel"
          role={task ? "tabpanel" : undefined}
          id={`lt-tabpanel-${tab}`}
          aria-labelledby={task ? `lt-tab-${tab}` : undefined}
        >
          {tab === "task" && task ? <LiteTaskTab task={task} /> : <LiteChangesTab sessionId={sessionId} />}
        </div>
      </div>
    </LiteRightPanel>
  );
}

function activeTaskOf(row: { active_task?: TaskRef } | undefined): TaskRef | undefined {
  return row?.active_task?._id ? row.active_task : undefined;
}

function taskRefSig(task: TaskRef | undefined): string {
  return task ? `${task._id}\u0000${task.short_id}\u0000${task.status}\u0000${task.title}` : "";
}
