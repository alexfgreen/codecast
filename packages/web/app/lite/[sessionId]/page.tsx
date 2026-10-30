// /lite/:sessionId: one session. Its header (where it lives, what it is
// called, what state it is in, who else is here and who is typing, the
// sessions it has talked with, Stop while it runs, Share, the ⋯ menu with
// hand-off and "message another agent", the right panel and the way to the
// classic view), the thread, the composer under it, and the right panel's
// slot.
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import Link from "next/link";
import { ArrowUpRight, PanelRight } from "lucide-react";
import { getProjectName, isConvexId, useInboxStore } from "@/store/inboxStore";
import { useWatchEffect } from "@/hooks/useWatchEffect";
import { useManagedSessionFields, useSessionEscape } from "@/hooks/useSessionComposerControls";
import { isActiveAgentStatus, type LiveAgentStatus } from "@/lib/pendingBanner";
import { runningSubagents } from "@/lib/runningSubagents";
import { stopNeedsConfirm } from "@/lib/stopNeedsConfirm";
import { sessionCardTitle } from "@/lib/sessionCard";
import { liteSessionPath } from "@/lib/inboxRouting";
import { useLiteLayout } from "@/lib/lite/liteLayout";
import { useLiteSessionMark } from "@/lib/lite/useLiteSidebar";
import { useLiteSessionAccess } from "@/lib/lite/threadAccess";
import { useLiteTalkedWith } from "@/lib/lite/collabHooks";
import { liteProjectOf } from "@/lib/lite/sidebarModel";
import { LiteTopbar } from "@/components/lite/LiteTopbar";
import { LiteSessionPanel } from "@/components/lite/panel/LiteSessionPanel";
import { LiteStatusMark } from "@/components/lite/LiteSidebarRows";
import { LiteThread } from "@/components/lite/thread/LiteThread";
import { LiteComposer } from "@/components/lite/thread/LiteComposer";
import { LiteTypingChip, LiteViewerFaces } from "@/components/lite/collab/LiteFaces";
import { LiteTalkedWithChips } from "@/components/lite/collab/LiteTalkedWith";
import { LiteShareControl } from "@/components/lite/collab/LiteShare";
import { LiteSessionMenu } from "@/components/lite/collab/LiteSessionMenu";
import { LiteHandoffDialog } from "@/components/lite/collab/LiteHandoffDialog";
import { LiteMessageAgentDialog } from "@/components/lite/collab/LiteMessageAgentDialog";
import { ShortcutTooltip } from "@/components/KeyboardShortcutsHelp";
import { StopConfirm, type StopRequest } from "@/components/conversation/StopConfirm";

export default function LiteSessionPage() {
  const id = useParams<{ sessionId: string }>().sessionId ?? "";
  const navigate = useNavigate();

  // A new session opens under its local stub id; when the server's id
  // arrives, the store rekeys the rows (resolveSessionId) and leaves the
  // stub's id behind as the row's session_id, which resolveLiveSessionId
  // follows. The address follows too, so a reload or a copied link lands on
  // the real session. The thread and the composer keep their mount across
  // that handoff (keyed by the id they opened with) and read the live id at
  // once, so the first bubble, the list's landing, the box's caret and a
  // draft still being written all stay where they are.
  const liveId = useInboxStore((s) => s.resolveLiveSessionId(id));
  const sessionId = liveId || id;
  const mount = useRef({ id, key: id });
  if (mount.current.id !== id) {
    const same = useInboxStore.getState().resolveLiveSessionId(mount.current.id) === id;
    mount.current = { id, key: same ? mount.current.key : id };
  }
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
    if (!sessionId) return;
    const store = useInboxStore.getState();
    const row = store.sessions[sessionId] ?? store.conversations[sessionId];
    store.recordRecentVisit({ kind: "session", key: sessionId, label: row?.title || undefined });
  }, [sessionId]);

  return (
    <>
      <LiteSessionHeader id={sessionId} />
      <LiteThread key={mount.current.key} sessionId={sessionId} />
      <LiteComposer key={`composer:${mount.current.key}`} sessionId={sessionId} />
      <LiteSessionPanel sessionId={sessionId} />
    </>
  );
}

function LiteSessionHeader({ id }: { id: string }) {
  const { rightPanelOpen, toggleRightPanel } = useLiteLayout();
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
  // The session's one mark, the sidebar's own (Needs you, Failed, Done,
  // Working, Waiting on Maya); no mark, no pill.
  const { mark, label: pill } = useLiteSessionMark(id);

  // Stop: the composer's interrupt, here too while a turn runs.
  const access = useLiteSessionAccess(id);
  const { isOwner } = access;
  const managed = useManagedSessionFields(id);
  const running = isActiveAgentStatus(managed?.agent_status as LiveAgentStatus | undefined);
  const conversationActive = useInboxStore((s) => ((s.conversations[id] ?? s.sessions[id]) as { status?: string } | undefined)?.status !== "completed");
  const stop = useSessionEscape(id, { active: conversationActive, isOwner });
  // Stopping a turn stops the subagents it launched: with any running, the
  // stop names them first (the composer's own rule, StopConfirm).
  const [stopRequest, setStopRequest] = useState<StopRequest | null>(null);
  const onStop = () => {
    const subagents = runningSubagents(useInboxStore.getState().messages[id]);
    if (stopNeedsConfirm(subagents)) setStopRequest({ subagents, run: () => { stop(); } });
    else stop();
  };

  // The sessions this one has talked with: three chips on a wide bar, all of
  // them in the ⋯ menu.
  const talked = useLiteTalkedWith(id);
  // The ⋯ menu's acts open their dialogs here: the menu unmounts as it closes.
  const [dialog, setDialog] = useState<"handoff" | "agent" | null>(null);

  return (
    <LiteTopbar>
      {/* The title keeps a little room at any width; the controls give way. */}
      <nav className="lt-crumbs !min-w-[72px]" aria-label="Breadcrumb">
        {project && (
          <>
            <span className="lt-crumb-project">{project}</span>
            <span className="text-[var(--lt-text-3)]" aria-hidden>›</span>
          </>
        )}
        <span className="lt-crumb-title" aria-current="page">{title || "Session"}</span>
      </nav>
      {mark && pill && (
        <span className="lt-pill" data-mark={mark} title={pill}>
          <span aria-hidden className="inline-flex"><LiteStatusMark mark={mark} /></span>
          {/* On a phone the mark alone; the words stay for a screen reader. */}
          <span className="max-sm:sr-only">{pill}</span>
        </span>
      )}
      <span className="contents max-md:hidden"><LiteTypingChip sessionId={id} /></span>
      <LiteTalkedWithChips peers={talked} className="max-xl:!hidden" />
      <LiteViewerFaces sessionId={id} />
      {running && isOwner && (
        <button type="button" className="lt-btn" onClick={onStop} aria-label="Stop the agent">
          <span aria-hidden className="h-2 w-2 rounded-[2px] bg-current" />
          Stop
        </button>
      )}
      {/* A session not yet on the server has nothing to share. */}
      {access.known && isConvexId(id) && <LiteShareControl sessionId={id} isOwner={isOwner} />}
      {/* The ⋯ menu carries it on a narrower bar. */}
      <Link href={`/inbox?s=${encodeURIComponent(id)}`} className="lt-btn max-lg:!hidden" aria-label="Open in classic" title="Open this session in the classic app">
        Open in classic
        <ArrowUpRight aria-hidden />
      </Link>
      <LiteSessionMenu
        sessionId={id}
        talked={talked}
        onHandoff={() => setDialog("handoff")}
        onMessageAgent={() => setDialog("agent")}
      />
      <ShortcutTooltip label={rightPanelOpen ? "Hide changes" : "Show changes"} action="lite.toggleRightPanel">
        <button type="button" className="lt-icon-btn" aria-label={rightPanelOpen ? "Hide changes" : "Show changes"} aria-pressed={rightPanelOpen} onClick={toggleRightPanel}>
          <PanelRight aria-hidden />
        </button>
      </ShortcutTooltip>
      <StopConfirm request={stopRequest} onClose={() => setStopRequest(null)} />
      {dialog === "handoff" && <LiteHandoffDialog sessionId={id} title={title || "Session"} onClose={() => setDialog(null)} />}
      {dialog === "agent" && <LiteMessageAgentDialog sessionId={id} onClose={() => setDialog(null)} />}
    </LiteTopbar>
  );
}
