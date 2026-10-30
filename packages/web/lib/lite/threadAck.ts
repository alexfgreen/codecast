// "The reader is here, at the newest message of this session": Lite's half of
// the read mark the classic view writes (hooks/useAckActiveConversation).
// Classic gates on the store's view pointer, which Lite never moves (the
// session page says why), so Lite gates on what the reader can see instead:
// the session is open in the window, the window is in front, and the thread
// is scrolled to its latest row. The write itself is the classic one,
// ackSessionRead at the session's own activity watermark, so the sidebar's
// "done, not read yet" mark goes out on the same rule everywhere.
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
  useWatchEffect(() => {
    if (!shouldAcknowledge({ conversationId, isActiveView: atLatest, present, updatedAt })) return;
    const store = useInboxStore.getState();
    store.ackSessionRead(conversationId, updatedAt);
    // The local "seen up to" cursor the Threads cards read, too.
    store.markSessionSeen(conversationId);
  }, [conversationId, atLatest, present, updatedAt]);
}
