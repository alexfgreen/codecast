// What Needs you's clearing gestures write, outside the components so a row
// and its section's "Mark all read" share one path. Every write is the store
// action the classic surfaces use, so a row cleared here is cleared there.
import { sessionActivityAt } from "@codecast/shared/contracts";
import { sessionActivityFacts, useInboxStore } from "../../store/inboxStore";
import { LITE_DECISION_NOTICE_TYPES } from "./needsYou";

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

type NoticeRow = { _id: string; type?: string; read?: boolean; conversation_id?: string; link?: string };

function unreadNotices(match: (n: NoticeRow) => boolean): string[] {
  const out: string[] = [];
  for (const n of Object.values(useInboxStore.getState().notifications) as NoticeRow[]) {
    if (n && !n.read && match(n)) out.push(n._id);
  }
  return out;
}

/** The unread session_assigned notifications that announce a handoff of
 *  this session: read together with the handoff they announce, so
 *  acknowledging it leaves nothing behind in the bell. */
export function handoffNoticeIds(sessionId: string): string[] {
  return unreadNotices((n) => n.type === "session_assigned" && n.conversation_id === sessionId);
}

/** The unread notices that passed, escalated or shared this session's
 *  decision to the person: read together with the answer. A notice that
 *  links one decision (`/decisions/<short id>`) is read only with that one. */
export function decisionNoticeIds(sessionId: string, shortId?: string): string[] {
  return unreadNotices((n) => {
    if (!n.type || !LITE_DECISION_NOTICE_TYPES.has(n.type) || n.conversation_id !== sessionId) return false;
    const linked = n.link?.match(/^\/decisions\/([^/?#]+)/)?.[1];
    return !linked || !shortId || linked.toLowerCase() === shortId.toLowerCase();
  });
}
