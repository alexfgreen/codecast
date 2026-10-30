// /lite/:sessionId: one session. Its header (where it lives, what it is
// called, what state it is in, Stop while it runs, the right panel and the
// way to the classic view), the thread, the composer under it, and the right
// panel's slot.
import { useNavigate, useParams } from "react-router";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRight, Ellipsis, Link2, PanelRight } from "lucide-react";
import { getProjectName, isForeignRow, sessionWorkState, useInboxStore } from "@/store/inboxStore";
import { useCoarseNow } from "@/hooks/useCoarseNow";
import { useWatchEffect } from "@/hooks/useWatchEffect";
import { useManagedSessionFields, useSessionEscape } from "@/hooks/useSessionComposerControls";
import { isActiveAgentStatus, type LiveAgentStatus } from "@/lib/pendingBanner";
import { sessionCardTitle } from "@/lib/sessionCard";
import { liteSessionPath } from "@/lib/inboxRouting";
import { copyToClipboard } from "@/lib/utils";
import { useLiteLayout } from "@/lib/lite/liteLayout";
import { useLiteSidebarModel } from "@/lib/lite/useLiteSidebar";
import { useLiteSessionAccess } from "@/lib/lite/threadAccess";
import { liteProjectOf, type LiteMark } from "@/lib/lite/sidebarModel";
import { LiteTopbar } from "@/components/lite/LiteTopbar";
import { LiteSessionPanel } from "@/components/lite/panel/LiteSessionPanel";
import { LiteStatusMark } from "@/components/lite/LiteSidebarRows";
import { LiteThread } from "@/components/lite/thread/LiteThread";
import { LiteComposer } from "@/components/lite/thread/LiteComposer";
import { ShortcutTooltip } from "@/components/KeyboardShortcutsHelp";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function LiteSessionPage() {
  const id = useParams<{ sessionId: string }>().sessionId ?? "";
  const navigate = useNavigate();

  // A new session opens under its local stub id; when the server's id
  // arrives, the store rekeys the rows (resolveSessionId) and leaves the
  // stub's id behind as the row's session_id, which resolveLiveSessionId
  // follows. The address follows too, so a reload or a copied link lands on
  // the real session.
  const liveId = useInboxStore((s) => s.resolveLiveSessionId(id));
  useWatchEffect(() => {
    if (liveId && liveId !== id) navigate(liteSessionPath(liveId), { replace: true });
  }, [liveId, id]);

  // Opening a session here records the visit (the palette's recents read
  // it) and nothing else. Not the store's view pointer: every navigation
  // primitive that moves it (setCurrentSession and its siblings) also
  // rewrites the classic window's active inbox tab, and this window holds
  // only the tab list it hydrated at boot, so the write would put that stale
  // list back over the one a classic window has since changed, on disk and
  // through the server's client_state. Presence reports the session from the
  // address instead (usePresenceReporter).
  useWatchEffect(() => {
    if (!id) return;
    const store = useInboxStore.getState();
    const row = store.sessions[id] ?? store.conversations[id];
    store.recordRecentVisit({ kind: "session", key: id, label: row?.title || undefined });
  }, [id]);

  return (
    <>
      <LiteSessionHeader id={id} />
      <LiteThread key={id} sessionId={id} />
      <LiteComposer key={`composer:${id}`} sessionId={id} />
      <LiteSessionPanel sessionId={id} />
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
  // Waiting on input needs the viewer only when the session is theirs.
  const mark: LiteMark = drawn !== undefined ? drawn
    : workState === "needs_input" ? (mine ? "needs" : "waiting")
    : workState === "working" ? "working" : null;
  const pill = mark === "needs" && mine ? "Needs you" : mark === "done" ? "Done" : workState ? PILL_WORDS[workState] : null;

  // Stop: the composer's interrupt, here too while a turn runs.
  const { isOwner } = useLiteSessionAccess(id);
  const managed = useManagedSessionFields(id);
  const running = isActiveAgentStatus(managed?.agent_status as LiveAgentStatus | undefined);
  const conversationActive = useInboxStore((s) => ((s.conversations[id] ?? s.sessions[id]) as { status?: string } | undefined)?.status !== "completed");
  const stop = useSessionEscape(id, { active: conversationActive, isOwner });
  const copyLink = () => {
    void copyToClipboard(`${window.location.origin}${liteSessionPath(id)}`)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Could not copy the link"));
  };

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
          {mark && <span aria-hidden className="inline-flex"><LiteStatusMark mark={mark} /></span>}
          {pill}
        </span>
      )}
      {running && isOwner && (
        <button type="button" className="lt-btn" onClick={() => stop()} aria-label="Stop the agent">
          <span aria-hidden className="h-2 w-2 rounded-[2px] bg-current" />
          Stop
        </button>
      )}
      <Link href={`/inbox?s=${encodeURIComponent(id)}`} className="lt-btn" aria-label="Open in classic" title="Open this session in the classic app">
        <span className="max-sm:hidden">Open in classic</span>
        <ArrowUpRight aria-hidden />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="lt-icon-btn" aria-label="More">
            <Ellipsis aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-lite="" className="lt-menu">
          <DropdownMenuItem className="lt-menu-item" onSelect={copyLink}>
            <Link2 className="w-4 h-4 text-[var(--lt-text-3)]" aria-hidden />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuItem className="lt-menu-item" onSelect={() => navigate(`/inbox?s=${encodeURIComponent(id)}`)}>
            <ArrowUpRight className="w-4 h-4 text-[var(--lt-text-3)]" aria-hidden />
            Open in classic
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShortcutTooltip label={rightPanelOpen ? "Hide changes" : "Show changes"} action="lite.toggleRightPanel">
        <button type="button" className="lt-icon-btn" aria-label={rightPanelOpen ? "Hide changes" : "Show changes"} aria-pressed={rightPanelOpen} onClick={toggleRightPanel}>
          <PanelRight aria-hidden />
        </button>
      </ShortcutTooltip>
    </LiteTopbar>
  );
}
