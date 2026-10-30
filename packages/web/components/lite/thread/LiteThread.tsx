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
import "./thread.css";
import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useConversationMessages, type Message } from "../../../hooks/useConversationMessages";
import { useBottomAnchoredList } from "../../../hooks/useBottomAnchoredList";
import { useManagedSessionFields } from "../../../hooks/useManagedSessionFields";
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

export function LiteThread({ sessionId }: { sessionId: string }) {
  const { conversation, hasMoreAbove, isLoadingOlder, loadOlder } = useConversationMessages(sessionId);
  const messages = (conversation?.messages ?? EMPTY) as unknown as ConvMessage[];
  const agentType = conversation?.agent_type;
  const managed = useManagedSessionFields(sessionId);
  const active = isActiveAgentStatus(managed?.agent_status as LiveAgentStatus | undefined);
  const access = useLiteSessionAccess(sessionId);
  const layout = useLiteLayout();

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const built = useMemo(() => buildLiteRows(messages, { agentType, active }), [messages, agentType, active]);
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
    cacheNamespace: `lite:${sessionId}`,
    // An open row and its closed self are two heights; nesting changes the width.
    rowVariantKey: (i) => {
      const r = rows[i];
      return r ? `${open.has(r.key) ? "o" : "c"}${r.depth}` : "x";
    },
    paddingStart: 16,
    paddingEnd: 16,
    resetKey: sessionId,
    hasMoreAbove,
    isLoadingOlder,
    onLoadOlder: loadOlder,
  });

  // Read while the newest row is in view and the window is in front.
  useLiteThreadAck(sessionId, list.atBottom || !list.isScrollable);

  // The conversation's keys (the diff toggle, and the composer's and the
  // permission stack's own) answer only while a session is open.
  useShortcutContext("conversation", true);
  useShortcutAction("conv.toggleDiff", () => {
    if (layout.rightPanelOpen && layout.rightPanelTab === "changes") layout.setRightPanelOpen(false);
    else layout.openRightPanel("changes");
  });

  const items = list.virtualizer.getVirtualItems();
  return (
    <div className="lt-thread">
      <div className="lt-th-list" ref={list.containerRef}>
        <div className="lt-th-fill">
          {isLoadingOlder && <div className="lt-th-status" role="status">Loading earlier messages</div>}
          {rows.length === 0 && (
            <div className="lt-th-empty">{conversation ? "" : "Loading"}</div>
          )}
          <div className="lt-th-sizer" style={{ height: list.totalSize }}>
            {items.map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              // React 19 refuses a key through a spread. The hook's own style
              // places rows with a transform; Lite places them by `top`.
              const { key, style: _transform, ...rowProps } = list.rowProps({ index: item.index, key: item.key as string | number, start: item.start });
              return (
                <div key={key} {...rowProps} style={{ position: "absolute", top: item.start, left: 0, width: "100%" }}>
                  <LiteRowView
                    row={row}
                    open={open.has(row.key)}
                    onToggle={onToggle}
                    sessionId={sessionId}
                    canSend={access.canSend}
                    meId={access.meId}
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
