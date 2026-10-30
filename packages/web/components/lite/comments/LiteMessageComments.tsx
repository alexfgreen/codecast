// A message's comment thread, opened in place under its row in Lite's thread:
// the team's shared `comments` rows anchored to that message, the classic
// thread (CommentThread: its cards, the agent's reply, resolve, and the
// composer with its @mentions, which the server resolves against the
// session's team) reused whole. Read from the store (useMessageComments; the
// thread mounts the feed once, useConversationCommentsSync); every write is a
// store action that paints at once. Escape closes it.
import "./comments.css";
import { useCallback, type KeyboardEvent } from "react";
import { useInboxStore } from "../../../store/inboxStore";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { useMessageComments } from "../../../hooks/useConversationComments";
import { isAgentComment } from "../../../lib/commentThread";
import { CommentThread } from "../../comments/CommentThread";

export function LiteMessageComments({ sessionId, messageId, onClose }: { sessionId: string; messageId: string; onClose: () => void }) {
  const { user, isAuthenticated } = useCurrentUser();
  const currentUserId = user?._id ? String(user._id) : undefined;
  const { thread, addComment, editComment, deleteComment, askAgent } = useMessageComments(sessionId, messageId);
  // A string off the row, so a heartbeat re-renders nothing here.
  const agentType = useInboxStore((s) => ((s.conversations[sessionId] ?? s.sessions[sessionId]) as { agent_type?: string } | undefined)?.agent_type ?? "claude_code");
  const agentBusy = thread.comments.some((c) => isAgentComment(c) && (c.agent_status === "thinking" || c.agent_status === "streaming"));
  const onResolve = useCallback(
    (resolved: boolean) => useInboxStore.getState().resolveCommentThread(sessionId, { messageId }, resolved),
    [sessionId, messageId],
  );
  // After the composer's own keys (a mention menu takes Escape first).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  };
  return (
    <div className="lt-cmt" onKeyDown={onKeyDown}>
      <CommentThread
        thread={thread}
        conversationId={sessionId}
        variant="anchored"
        authed={isAuthenticated}
        canWrite={isAuthenticated}
        currentUserId={currentUserId}
        composerAutoFocus
        onAdd={addComment}
        onEdit={editComment}
        onDelete={deleteComment}
        onAskAgent={askAgent}
        agentBusy={agentBusy}
        agentType={agentType}
        onResolve={onResolve}
        placeholder={thread.comments.length ? "Reply…" : "Comment…"}
      />
    </div>
  );
}
