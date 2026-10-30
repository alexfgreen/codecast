// What Needs you's clearing gestures write, outside the components so a row
// and its section's "Mark all read" share one path. Every write is the store
// action the classic surfaces use, so a row cleared here is cleared there.
import { sessionActivityAt } from "@codecast/shared/contracts";
import { sessionActivityFacts, useInboxStore } from "../../store/inboxStore";

type ActivityRow = Parameters<typeof sessionActivityFacts>[0];

/** Mark sessions read at their own activity watermark: the read Lite's
 *  thread writes when the reader reaches the newest turn (lib/lite/threadAck),
 *  so the "done, not read yet" mark goes out on the same rule everywhere. */
export function markLiteSessionsRead(ids: readonly string[]): void {
  const store = useInboxStore.getState();
  for (const id of ids) {
    const row = (store.sessions[id] ?? store.conversations[id]) as ActivityRow | undefined;
    if (!row) continue;
    store.ackSessionRead(id, sessionActivityAt(sessionActivityFacts(row)));
    store.markSessionSeen(id);
  }
}

/** Mark notifications read (local first; the bell and its count follow). */
export function markLiteNoticesRead(ids: readonly string[]): void {
  const { markNotificationRead } = useInboxStore.getState();
  for (const id of ids) markNotificationRead(id);
}

/** The unread session_assigned notifications that announce a handoff of
 *  this session: read together with the handoff they announce, so
 *  acknowledging it leaves nothing behind in the bell. */
export function handoffNoticeIds(sessionId: string): string[] {
  const out: string[] = [];
  for (const n of Object.values(useInboxStore.getState().notifications) as { _id: string; type?: string; read?: boolean; conversation_id?: string }[]) {
    if (!n.read && n.type === "session_assigned" && n.conversation_id === sessionId) out.push(n._id);
  }
  return out;
}
