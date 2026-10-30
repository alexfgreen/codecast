// A session's file changes, fed into the diff viewer store (one conversation
// at a time, store/diffViewerStore) the way the classic diff pane's host
// feeds it (components/ConversationDiffLayout): the server's index of every
// change merged with what the loaded messages say. The Lite session panel
// mounts it while it is open; the working tree's diff, which only the
// "Uncommitted" scope reads, is its own subscription below.
import { api } from "@codecast/convex/convex/_generated/api";
import type { Id } from "@codecast/convex/convex/_generated/dataModel";
import { useQueryNoThrow } from "./useQueryNoThrow";
import { useWatchEffect } from "./useWatchEffect";
import { extractFileChanges, mergeFileChanges, type ExtractableMessage, type FileChangeRef } from "../lib/fileChangeExtractor";
import { shareTokenArg } from "../lib/shareTokenScope";
import { isConvexId, useTrackedStore } from "../store/inboxStore";
import { useDiffViewerStore, type FileChangeEntry } from "../store/diffViewerStore";

/**
 * The session's changes: the authoritative server set (complete without
 * scrolling) merged with the loaded window's own extraction, which backfills
 * conversations whose edits predate the index and carries its text, so those
 * changes never round-trip for a body.
 */
export function sessionChangeEntries(
  server: readonly FileChangeRef[] | undefined,
  messages: readonly ExtractableMessage[] | undefined,
): FileChangeEntry[] {
  const client: FileChangeEntry[] = messages?.length ? extractFileChanges(messages as ExtractableMessage[]) : [];
  return mergeFileChanges<FileChangeEntry>((server ?? []) as FileChangeEntry[], client);
}

/** The same changes, field by field: a streamed reply re-extracts every
 *  change on each tick, and handing the store an equal list would re-fold
 *  every file for nothing. */
export function sameChangeEntries(a: readonly FileChangeEntry[], b: readonly FileChangeEntry[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (
      x.id !== y.id ||
      x.sequenceIndex !== y.sequenceIndex ||
      x.timestamp !== y.timestamp ||
      x.filePath !== y.filePath ||
      x.changeType !== y.changeType ||
      x.commitHash !== y.commitHash ||
      x.commitBranch !== y.commitBranch ||
      x.oldBytes !== y.oldBytes ||
      x.newBytes !== y.newBytes ||
      x.oldContent !== y.oldContent ||
      x.newContent !== y.newContent
    ) return false;
  }
  return true;
}

/**
 * Keep the diff viewer store holding `conversationId`'s changes. Returns
 * whether the server's index has answered (or cannot), so a surface can
 * tell "no changes" from "not known yet".
 */
export function useSessionFileChanges(
  conversationId: string | undefined,
  messages: readonly ExtractableMessage[] | undefined,
): { indexSettled: boolean } {
  const live = !!conversationId && isConvexId(conversationId);
  // References only: the text of a change arrives separately, for the few
  // changes a fold reads (useFileChangeBodies). Undefined while loading.
  const { data: server, error } = useQueryNoThrow(
    api.messages.getConversationFileChangeIndex,
    live ? { conversation_id: conversationId as Id<"conversations">, ...shareTokenArg(conversationId) } : "skip",
  );

  useWatchEffect(() => {
    const next = sessionChangeEntries(server, messages);
    const dv = useDiffViewerStore.getState();
    const id = conversationId ?? null;
    if (dv.conversationId === id && sameChangeEntries(dv.changes, next)) return;
    dv.setChanges(id, next);
  }, [conversationId, messages, server]);

  return { indexSettled: !live || server !== undefined || error !== undefined };
}

const NO_MESSAGES: readonly ExtractableMessage[] = [];

/** The messages the store holds for a session: whatever the conversation
 *  view has loaded (useConversationMessages caches its pages there). A
 *  reader beside the conversation never starts a second paging feed. */
export function useStoredSessionMessages(sessionId: string): readonly ExtractableMessage[] {
  const s = useTrackedStore([(s) => s.messages[sessionId]]);
  return (s.messages[sessionId] as readonly ExtractableMessage[] | undefined) ?? NO_MESSAGES;
}

/** The working tree's diff as the daemon last reported it, while `enabled`.
 *  Undefined while loading; null when the session has none to show. */
export function useSessionGitDiff(
  sessionId: string,
  enabled: boolean,
): { git_diff: string | null; git_diff_staged: string | null } | null | undefined {
  const live = enabled && isConvexId(sessionId);
  const { data, error } = useQueryNoThrow(
    api.conversations.getConversationGitDiff,
    live ? { conversation_id: sessionId as Id<"conversations">, ...shareTokenArg(sessionId) } : "skip",
  );
  if (!live || error) return null;
  return data;
}
