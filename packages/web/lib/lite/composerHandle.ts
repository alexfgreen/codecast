// The composer under a Lite session, reachable from outside it. The session
// header's "Message another agent…" fills the box with a reference to the
// agent picked and leaves the caret there, so the person says what to ask and
// their own agent runs `cast send`. One handle per session, held while that
// session's composer is mounted and drawing its text box (not while a
// permission prompt or a read-only line stands in its place), so a caller
// that finds none has no box to fill.
export type LiteComposerHandle = {
  /** Replace the draft with `text` and focus the box, the caret at its end. */
  populate(text: string): void;
  focus(): void;
};

const handles = new Map<string, LiteComposerHandle>();

/** Hold `handle` for `sessionId`; the returned function lets it go. A later
 *  registration for the same session wins, and the earlier one's release
 *  leaves it in place. */
export function registerLiteComposerHandle(sessionId: string, handle: LiteComposerHandle): () => void {
  handles.set(sessionId, handle);
  return () => {
    if (handles.get(sessionId) === handle) handles.delete(sessionId);
  };
}

/** The composer of `sessionId` while one is mounted and drawing its box. */
export function getLiteComposerHandle(sessionId: string): LiteComposerHandle | null {
  return handles.get(sessionId) ?? null;
}
