// The composer for a new shared comment thread on a line of a Lite diff (or
// on a run of lines: it is stored at the first, with the text of all of them,
// so it finds its passage again when the code moves). Opened under the line
// by hooks/useLiteLineComments; what it posts is a store action that paints
// at once, the same `comments` row the classic diff panel writes.
import "./comments.css";
import type { CodeAnchorText } from "@codecast/shared/comments";
import { useInboxStore } from "../../../store/inboxStore";
import { isParkedDispatchError } from "../../../store/mutativeMiddleware";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import type { DiffLineAnchor } from "../../../lib/patchParser";
import { fileThreadKey } from "../../../lib/commentThread";
import { CommentComposer } from "../../comments/CommentComposer";

export function LiteLineComposer({ sessionId, filePath, anchor, anchorLines, onDone }: {
  sessionId: string;
  filePath: string;
  anchor: DiffLineAnchor;
  anchorLines?: CodeAnchorText;
  onDone: () => void;
}) {
  const { user, isAuthenticated } = useCurrentUser();
  const agentType = useInboxStore((s) => ((s.conversations[sessionId] ?? s.sessions[sessionId]) as { agent_type?: string } | undefined)?.agent_type ?? "claude_code");
  const submit = async (content: string) => {
    onDone();
    try {
      await useInboxStore.getState().addComment(sessionId, content, { filePath, lineNumber: anchor.lineNumber, anchorLines });
    } catch (error) {
      if (!isParkedDispatchError(error)) throw error;
    }
  };
  const lines = anchor.lineEnd && anchor.lineEnd !== anchor.lineNumber ? `${anchor.lineNumber}–${anchor.lineEnd}` : String(anchor.lineNumber);
  return (
    <div className="lt-cmt lt-cmt-line">
      <div className="lt-cmt-anchor">Line{lines.includes("–") ? "s" : ""} {lines}</div>
      <CommentComposer
        conversationId={sessionId}
        messageId={fileThreadKey(filePath, anchor.lineNumber)}
        enabled
        authed={isAuthenticated}
        currentUserId={user?._id ? String(user._id) : undefined}
        onClose={onDone}
        agentType={agentType}
        autoFocus
        placeholder="Comment…"
        onSubmit={submit}
      />
    </div>
  );
}
