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
// the composer for a thread that does not exist yet (LiteLineComposer), as an
// owner-held line thread with no items. A hook, so it lives outside
// components/ (a component module that exports one is a failed Fast Refresh
// boundary).
import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { getRelativePath } from "@codecast/shared/render";
import type { CodeAnchorText } from "@codecast/shared/comments";
import { isConvexId } from "../store/inboxStore";
import { diffLineKey, type DiffLineAnchor } from "../lib/patchParser";
import type { DiffView } from "../components/DiffView";
import { LiteLineComposer } from "../components/lite/comments/LiteLineComposer";

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
