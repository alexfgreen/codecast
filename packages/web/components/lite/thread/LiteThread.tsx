// Codecast Lite's conversation: one session's transcript as lib/lite/threadRows
// folds it, in the bottom-anchored virtual list the team chat uses
// (hooks/useBottomAnchoredList), fed by the conversation view's own data hook
// (useConversationMessages: store first, the live tail behind it).
//
// Rows are placed by `top`, never by a transform: a transformed row is its own
// compositor layer, and the composer under the thread would pay for every
// visible row on every keystroke (components/__tests__/transcriptRowsNoLayers).
// What is open (a fold, a run, a call, a long prompt) is this component's own
// state, keyed by row key, and it reaches the list's height cache through the
// row's variant key, so an opened row never reads its closed height.
//
// A new session mounts under its stub id and keeps this mount when the real
// id lands (the page passes the live id down without a new key): the height
// cache and the list's landing stay those of the first id it opened with.
//
// The thread feeds the session's comments into the store once (the classic
// conversation view's feeder), counts them per message for the rows' badges,
// and holds which rows have their comment thread open, which reaches the
// height cache through the variant key like any other open row. An address
// that names a comment (?comment=<id>, a mention opened from Needs you)
// opens that thread under its message and brings it into view, or opens a
// line comment's file in the changes panel.
import "./thread.css";
import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { api } from "@codecast/convex/convex/_generated/api";
import type { Id } from "@codecast/convex/convex/_generated/dataModel";
import { useConversationMessages, type Message } from "../../../hooks/useConversationMessages";
import { useQueryNoThrow } from "../../../hooks/useQueryNoThrow";
import { isConvexId, useInboxStore } from "../../../store/inboxStore";
import { shareTokenArg } from "../../../lib/shareTokenScope";
import { useBottomAnchoredList } from "../../../hooks/useBottomAnchoredList";
import { useConversationCommentRows, useConversationCommentsSync } from "../../../hooks/useConversationCommentsSync";
import { useManagedSessionFields } from "../../../hooks/useManagedSessionFields";
import { useWatchEffect } from "../../../hooks/useWatchEffect";
import { isActiveAgentStatus, type LiveAgentStatus } from "../../../lib/pendingBanner";
import { useShortcutAction, useShortcutContext } from "../../../shortcuts";
import { useLiteLayout } from "../../../lib/lite/liteLayout";
import { useLiteThreadAck } from "../../../lib/lite/threadAck";
import { useLiteSessionAccess } from "../../../lib/lite/threadAccess";
import {
  buildLiteRows, estimateLiteRow, reuseStableRows, visibleLiteRows, type LiteVisibleRow,
} from "../../../lib/lite/threadRows";
import type { Message as ConvMessage } from "../../conversation/types";
import { LiteRowView } from "./LiteThreadRows";

const EMPTY: Message[] = [];

/** The server said there is no such session for this viewer (missing, or
 *  access denied): the meta query, the same subscription the data hook holds
 *  (Convex shares it), answered null. Not "still loading". */
function useLiteSessionMissing(sessionId: string): boolean {
  const meta = useQueryNoThrow(
    api.conversations.getConversationWithMeta,
    isConvexId(sessionId) ? { conversation_id: sessionId as Id<"conversations">, strip_volatile: true, ...shareTokenArg(sessionId) } : "skip",
  ).data;
  return meta === null;
}

export function LiteThread({ sessionId }: { sessionId: string }) {
  const { conversation, hasMoreAbove, isLoadingOlder, loadOlder } = useConversationMessages(sessionId);
  const messages = (conversation?.messages ?? EMPTY) as unknown as ConvMessage[];
  const agentType = conversation?.agent_type;
  const parentId = conversation?.parent_conversation_id ?? null;
  const managed = useManagedSessionFields(sessionId);
  const active = isActiveAgentStatus(managed?.agent_status as LiveAgentStatus | undefined);
  const blocked = managed?.agent_status === "permission_blocked";
  const access = useLiteSessionAccess(sessionId);
  const missing = useLiteSessionMissing(sessionId);
  const layout = useLiteLayout();
  // The id this mount opened with: a stub's real id arriving keeps the cache.
  const mountId = useRef(sessionId).current;

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Comments: the feed, each message's count, and the rows whose thread is open.
  useConversationCommentsSync(sessionId);
  const commentRows = useConversationCommentRows(sessionId);
  const commentCounts = useMemo(() => {
    const byMessage = new Map<string, number>();
    for (const c of commentRows) if (c.message_id) byMessage.set(c.message_id, (byMessage.get(c.message_id) ?? 0) + 1);
    return byMessage;
  }, [commentRows]);
  const [commenting, setCommenting] = useState<ReadonlySet<string>>(() => new Set());
  const onComment = useCallback((key: string) => {
    setCommenting((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  // A message takes a comment once the server has it, in a session it has,
  // from a viewer it knows.
  const canComment = isConvexId(sessionId) && !!access.meId;

  const built = useMemo(
    () => buildLiteRows(messages, { agentType, active, blocked, parentConversationId: parentId, hasMoreAbove }),
    [messages, agentType, active, blocked, parentId, hasMoreAbove],
  );
  const prevRows = useRef<LiteVisibleRow[]>([]);
  const rows = useMemo(() => {
    const next = reuseStableRows(prevRows.current, visibleLiteRows(built, open));
    prevRows.current = next;
    return next;
  }, [built, open]);

  const list = useBottomAnchoredList({
    count: rows.length,
    getItemKey: (i) => rows[i]?.key ?? String(i),
    estimateSize: (i) => estimateLiteRow(rows[i], !!rows[i] && open.has(rows[i].key)),
    cacheNamespace: `lite:${mountId}`,
    // An open row and its closed self are two heights, and so is a row with
    // its comment thread open; nesting changes the width.
    rowVariantKey: (i) => {
      const r = rows[i];
      return r ? `${open.has(r.key) ? "o" : "c"}${r.depth}${commenting.has(r.key) ? "t" : ""}` : "x";
    },
    paddingStart: 16,
    paddingEnd: 16,
    resetKey: mountId,
    hasMoreAbove,
    isLoadingOlder,
    onLoadOlder: loadOlder,
  });

  // Read while the newest row is in view and the window is in front.
  useLiteThreadAck(sessionId, list.atBottom || !list.isScrollable);

  // The comment the address names, shown once its row (or its file) is at
  // hand: a message's thread opens under it and comes into view; a line's
  // file opens in the changes panel, which draws the line's thread.
  const [params] = useSearchParams();
  const commentTarget = params.get("comment");
  const shownComment = useRef<string | null>(null);
  useWatchEffect(() => {
    if (!commentTarget || shownComment.current === commentTarget) return;
    const c = commentRows.find((x) => x._id === commentTarget);
    if (!c) return;
    if (c.message_id) {
      const index = rows.findIndex((r) => (r.kind === "user" || r.kind === "text") && r.message._id === c.message_id);
      if (index < 0) return;
      shownComment.current = commentTarget;
      const key = rows[index]!.key;
      setCommenting((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
      list.scrollToIndex(index, { align: "center" });
    } else if (c.file_path) {
      shownComment.current = commentTarget;
      layout.openRightPanel("changes", { file: c.file_path });
    }
  }, [commentTarget, commentRows, rows]);

  // The conversation's keys (the diff toggle, and the composer's and the
  // permission stack's own) answer only while a session is open.
  useShortcutContext("conversation", true);
  useShortcutAction("conv.toggleDiff", () => {
    // A session without a task shows only its changes, whatever tab the
    // panel last held (LiteSessionPanel); read at the press, not subscribed.
    const st = useInboxStore.getState();
    const row = (st.sessions[sessionId] ?? st.conversations[sessionId]) as { active_task?: { _id?: string } } | undefined;
    const showing = row?.active_task?._id ? layout.rightPanelTab : "changes";
    if (layout.rightPanelOpen && showing === "changes") layout.setRightPanelOpen(false);
    else layout.openRightPanel("changes");
  });

  const items = list.virtualizer.getVirtualItems();
  return (
    <div className="lt-thread">
      <div className="lt-th-list" ref={list.containerRef}>
        <div className="lt-th-fill">
          {isLoadingOlder && <div className="lt-th-status" role="status">Loading earlier messages</div>}
          {rows.length === 0 && missing && (
            <div className="lt-th-empty" role="status">
              <span>Session not found</span>
              <Link href="/lite" className="lt-btn">Back to sessions</Link>
            </div>
          )}
          {rows.length === 0 && !conversation && !missing && <div className="lt-th-empty" role="status">Loading</div>}
          <div className="lt-th-sizer" style={{ height: list.totalSize }}>
            {items.map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              // React 19 refuses a key through a spread. The hook's own style
              // places rows with a transform; Lite places them by `top`.
              const { key, style: _transform, ...rowProps } = list.rowProps({ index: item.index, key: item.key as string | number, start: item.start });
              const messageId = canComment && (row.kind === "user" || row.kind === "text") && isConvexId(row.message._id) ? row.message._id : null;
              return (
                <div key={key} {...rowProps} style={{ position: "absolute", top: item.start, left: 0, width: "100%" }}>
                  <LiteRowView
                    row={row}
                    open={open.has(row.key)}
                    onToggle={onToggle}
                    sessionId={sessionId}
                    canSend={access.canSend}
                    meId={access.meId}
                    isOwner={access.isOwner}
                    ownerId={access.ownerId}
                    ownerName={access.ownerName}
                    commentCount={messageId ? commentCounts.get(messageId) ?? 0 : 0}
                    commentOpen={commenting.has(row.key)}
                    onComment={messageId ? onComment : undefined}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* Only once the reader has scrolled away on purpose. */}
      {list.userScrolled && !list.nearBottom && (
        <button type="button" className="lt-th-jump" onClick={() => list.scrollToBottom({ smooth: true })}>
          <ArrowDown aria-hidden />
          Jump to latest
        </button>
      )}
    </div>
  );
}
