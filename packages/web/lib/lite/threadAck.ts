// "The reader is here, at the newest message of this session": Lite's half of
// the read mark the classic view writes (hooks/useAckActiveConversation).
// Classic gates on the store's view pointer, which Lite never moves (the
// session page says why), so Lite gates on what the reader can see instead:
// the session is open in the window, the window is in front, and the thread
// is scrolled to its latest row. The write itself is the classic one,
// ackSessionRead at the session's own activity watermark, so the sidebar's
// "done, not read yet" mark goes out on the same rule everywhere.
//
// One mark per watermark: scrolling back down to a turn already marked read
// writes nothing, so a "mark unread" made while the session is open survives
// until a new turn lands or the reader opens the session again.
import { useRef } from "react";
import { sessionActivityAt, shouldAcknowledge } from "@codecast/shared/contracts";
import { sessionActivityFacts, useInboxStore } from "../../store/inboxStore";
import { usePagePresence } from "../../hooks/usePagePresence";
import { useWatchEffect } from "../../hooks/useWatchEffect";

export function useLiteThreadAck(conversationId: string, atLatest: boolean): void {
  const present = usePagePresence();
  // A number off one row: a heartbeat that leaves it alone re-renders nothing.
  const updatedAt = useInboxStore((s) => {
    const row = s.sessions[conversationId] ?? s.conversations[conversationId];
    return row ? sessionActivityAt(sessionActivityFacts(row as Parameters<typeof sessionActivityFacts>[0])) : 0;
  });
  const acked = useRef<{ id: string; at: number } | null>(null);
  useWatchEffect(() => {
    if (!shouldAcknowledge({ conversationId, isActiveView: atLatest, present, updatedAt })) return;
    if (acked.current?.id === conversationId && acked.current.at === updatedAt) return;
    acked.current = { id: conversationId, at: updatedAt };
    const store = useInboxStore.getState();
    store.ackSessionRead(conversationId, updatedAt);
    // The local "seen up to" cursor the Threads cards read, too.
    store.markSessionSeen(conversationId);
  }, [conversationId, atLatest, present, updatedAt]);
}
