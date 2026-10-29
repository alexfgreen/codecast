// /lite/:sessionId: one session. Wave 1 draws its header (where it lives,
// what it is called, what state it is in, the right panel and the way to the
// classic view); the conversation itself lands in the next wave.
import { useParams } from "react-router";
import Link from "next/link";
import { ArrowUpRight, PanelRight } from "lucide-react";
import { getProjectName, isForeignRow, sessionWorkState, useInboxStore } from "@/store/inboxStore";
import { useCoarseNow } from "@/hooks/useCoarseNow";
import { useWatchEffect } from "@/hooks/useWatchEffect";
import { sessionCardTitle } from "@/lib/sessionCard";
import { useLiteLayout } from "@/lib/lite/liteLayout";
import { useLiteSidebarModel } from "@/lib/lite/useLiteSidebar";
import { liteProjectOf, type LiteMark } from "@/lib/lite/sidebarModel";
import { LiteTopbar } from "@/components/lite/LiteTopbar";
import { LiteRightPanel } from "@/components/lite/LiteRightPanel";
import { LiteStatusMark } from "@/components/lite/LiteSidebarRows";
import { ShortcutTooltip } from "@/components/KeyboardShortcutsHelp";

export default function LiteSessionPage() {
  const id = useParams<{ sessionId: string }>().sessionId ?? "";

  // The store's pointer follows the address: it is "where this person is",
  // which the classic inbox (its ?s= selection), the phone and every device's
  // last position read, so opening a session here moves them too, on purpose.
  // A view change must declare why (store/viewNav): a route change is the
  // person's own gesture.
  useWatchEffect(() => {
    if (!id) return;
    const store = useInboxStore.getState();
    if (store.currentSessionId !== id) store.setCurrentSession(id, "gesture");
  }, [id]);

  return (
    <>
      <LiteSessionHeader id={id} />
      <div className="lt-scroll">
        <div className="lt-content py-6">
          <div data-lite-placeholder="">Conversation view lands in wave 2</div>
        </div>
      </div>
      <LiteRightPanel title="Changes">
        <div className="p-4">
          <div data-lite-placeholder="">Changes land in wave 3</div>
        </div>
      </LiteRightPanel>
    </>
  );
}

const PILL_WORDS: Record<string, string> = {
  working: "Working",
  needs_input: "Needs input",
  done: "Done",
  dormant: "Parked",
  idle: "Idle",
};

function LiteSessionHeader({ id }: { id: string }) {
  const { rightPanelOpen, toggleRightPanel } = useLiteLayout();
  const model = useLiteSidebarModel();
  const now = useCoarseNow(15_000);
  // Primitives off one row, so a heartbeat that moves none of them re-renders
  // nothing here.
  const title = useInboxStore((s) => {
    const row = s.sessions[id] ?? s.conversations[id];
    return row ? sessionCardTitle(row as Parameters<typeof sessionCardTitle>[0]) : "";
  });
  const project = useInboxStore((s) => {
    const row = s.sessions[id] ?? s.conversations[id];
    return row ? liteProjectOf(row as Parameters<typeof liteProjectOf>[0], getProjectName).label : "";
  });
  const workState = useInboxStore((s) => (s.sessions[id] ? sessionWorkState(s.sessions[id], now) : null));
  const mine = useInboxStore((s) => {
    const row = s.sessions[id];
    return !row || !isForeignRow(row, s.currentUser?._id ? String(s.currentUser._id) : null);
  });

  // The sidebar's mark when the row is drawn there (it knows "done, not read
  // yet"), else the session's own state.
  const drawn = model.projects.flatMap((g) => g.all).find((r) => r.id === id)?.mark
    ?? model.teammates.flatMap((g) => g.rows).find((r) => r.id === id)?.mark;
  const mark: LiteMark = drawn !== undefined ? drawn : workState === "needs_input" ? "needs" : workState === "working" ? "working" : null;
  const pill = mark === "needs" && mine ? "Needs you" : mark === "done" ? "Done" : workState ? PILL_WORDS[workState] : null;

  return (
    <LiteTopbar>
      <nav className="lt-crumbs" aria-label="Breadcrumb">
        {project && (
          <>
            <span className="lt-crumb-project">{project}</span>
            <span className="text-[var(--lt-text-3)]" aria-hidden>›</span>
          </>
        )}
        <span className="lt-crumb-title" aria-current="page">{title || "Session"}</span>
      </nav>
      {pill && (
        <span className="lt-pill" data-mark={mark ?? undefined}>
          {mark && <LiteStatusMark mark={mark} />}
          {pill}
        </span>
      )}
      <Link href={`/inbox?s=${encodeURIComponent(id)}`} className="lt-btn" aria-label="Open in classic" title="Open this session in the classic app">
        <span className="max-sm:hidden">Open in classic</span>
        <ArrowUpRight aria-hidden />
      </Link>
      <ShortcutTooltip label={rightPanelOpen ? "Hide changes" : "Show changes"} action="lite.toggleRightPanel">
        <button type="button" className="lt-icon-btn" aria-label={rightPanelOpen ? "Hide changes" : "Show changes"} aria-pressed={rightPanelOpen} onClick={toggleRightPanel}>
          <PanelRight aria-hidden />
        </button>
      </ShortcutTooltip>
    </LiteTopbar>
  );
}
