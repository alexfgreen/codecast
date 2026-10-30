// Shared comments on a line of a Lite diff. A click in the gutter (or on a run
// of lines the reader selected) opens a composer under that line; what it
// posts is a durable `comments` row at the file and line, the same table and
// the same anchor (conversation + getRelativePath) the classic diff panel and
// the transcript's inline diffs use, so a thread left in one shows in all of
// them, and teammates see it and are @mentioned in it. Never the private
// review batch (reviewComments) DiffView writes when no handler is given.
//
// DiffView draws the posted threads itself (commentContext → useFileComments
// → FileLineThread, with reply, the agent and resolve); this hook adds only
// the composer for a thread that does not exist yet, as an owner-held line
// thread with no items.
import "./comments.css";
import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { getRelativePath } from "@codecast/shared/render";
import type { CodeAnchorText } from "@codecast/shared/comments";
import { isConvexId, useInboxStore } from "../../../store/inboxStore";
import { isParkedDispatchError } from "../../../store/mutativeMiddleware";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { diffLineKey, type DiffLineAnchor } from "../../../lib/patchParser";
import { fileThreadKey } from "../../../lib/commentThread";
import type { DiffView } from "../../DiffView";
import { CommentComposer } from "../../comments/CommentComposer";

type DiffViewProps = ComponentProps<typeof DiffView>;

export type LiteLineCommentProps = Pick<DiffViewProps, "commentContext" | "onLineComment" | "lineThreads" | "renderLineThread">;

const NONE: LiteLineCommentProps = {};
const NO_ITEMS: unknown[] = [];

/** The comment props for one file's DiffView in session `sessionId`; none for
 *  a session the server does not have yet (a new session's stub). */
export function useLiteLineComments(sessionId: string | undefined, path: string): LiteLineCommentProps {
  const live = !!sessionId && isConvexId(sessionId);
  const filePath = useMemo(() => getRelativePath(path), [path]);
  const [draft, setDraft] = useState<{ key: string; anchor: DiffLineAnchor; anchorLines?: CodeAnchorText } | null>(null);
  const close = useCallback(() => setDraft(null), []);

  const commentContext = useMemo(
    () => (live ? { conversationId: sessionId!, anchorKey: `diffpanel:${path}`, filePath } : undefined),
    [live, sessionId, path, filePath],
  );
  const onLineComment = useCallback((anchor: DiffLineAnchor | undefined, _code: string, anchorLines?: CodeAnchorText) => {
    if (anchor) setDraft({ key: diffLineKey(anchor), anchor, anchorLines });
  }, []);
  const lineThreads = useMemo(() => (draft ? new Map([[draft.key, NO_ITEMS]]) : undefined), [draft]);
  const renderLineThread = useCallback(
    (anchor: DiffLineAnchor) => (
      <LiteLineComposer sessionId={sessionId!} filePath={filePath} anchor={anchor} anchorLines={draft?.anchorLines} onDone={close} />
    ),
    [sessionId, filePath, draft?.anchorLines, close],
  );

  if (!live) return NONE;
  return { commentContext, onLineComment, lineThreads, renderLineThread };
}

/** The composer for a new thread on a line (or a run of lines: it is stored
 *  at the first, with the text of all of them, so it finds its passage again
 *  when the code moves). */
function LiteLineComposer({ sessionId, filePath, anchor, anchorLines, onDone }: {
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
