// The session panel's changes tab: a scope (the whole session, the last
// turn, or what is uncommitted), the tally of what changed, then one row per
// changed file that opens its diff in place. The session's commits follow
// the session scope's files. Data is the classic diff pane's: the change
// index merged with the loaded messages (useSessionFileChanges), folded by
// @codecast/shared/diff, with the text of each change fetched on demand
// (useFileChangeBodies); the working tree's diff for "Uncommitted".
import { memo, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { diffBaseStart, selectRangeFoldInputs } from "@codecast/shared/diff";
import { useInboxStore } from "../../../store/inboxStore";
import { useDiffViewerStore, type FileChangeEntry } from "../../../store/diffViewerStore";
import { useSessionFileChanges, useSessionGitDiff, useStoredSessionMessages } from "../../../hooks/useSessionFileChanges";
import { useFileChangeBodies } from "../../../hooks/useFileChangeBodies";
import { useConversationCommits, useSyncConversationCommits } from "../../../hooks/useSyncTimeline";
import { useWatchEffect } from "../../../hooks/useWatchEffect";
import { foldReadyFiles, lastPromptAt } from "../../../lib/conversationDiffFiles";
import { readLitePref, useLiteLayout, writeLitePref } from "../../../lib/lite/liteLayout";
import {
  LITE_DIFF_SCOPES,
  LITE_SCOPE_EMPTY,
  LITE_SCOPE_LABEL,
  commitSubject,
  displayPath,
  findPanelFile,
  panelFilesFromFold,
  panelFilesFromGitDiff,
  panelTotals,
  pendingFoldPaths,
  splitPath,
  type LiteDiffScope,
  type PanelFile,
} from "../../../lib/lite/panelModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { LiteFileDiff } from "./LiteFileDiff";
import "./panel.css";

const SCOPE_PREF = "diffScope";
const NO_CHANGES: FileChangeEntry[] = [];
const NO_INPUTS: { base: FileChangeEntry[]; head: FileChangeEntry[] } = { base: [], head: [] };
const NO_PATHS: string[] = [];
const NO_FILES: PanelFile[] = [];
const NO_ROOTS: ReadonlyArray<string | null | undefined> = [];

// The "show this file" requests already shown. A request is one object per
// ask (openRightPanel), so a panel that opens later, or opens again, never
// scrolls back to a file it was asked for long ago.
const shownFocus = new WeakSet<object>();

export function LiteChangesTab({ sessionId }: { sessionId: string }) {
  const messages = useStoredSessionMessages(sessionId);
  const { indexSettled } = useSessionFileChanges(sessionId, messages);

  // The store holds one conversation's changes; until it holds this one's,
  // there are none to show.
  const mine = useDiffViewerStore((s) => s.conversationId === sessionId);
  const changes = useDiffViewerStore((s) => (s.conversationId === sessionId ? s.changes : NO_CHANGES));
  const bodies = useDiffViewerStore((s) => s.bodies);
  const missing = useDiffViewerStore((s) => s.missingBodies);

  const gitRoot = useInboxStore((s) => (s.sessions[sessionId] ?? s.conversations[sessionId])?.git_root ?? null);
  const projectPath = useInboxStore((s) => (s.sessions[sessionId] ?? s.conversations[sessionId])?.project_path ?? null);
  const roots = useMemo(() => (gitRoot || projectPath ? [gitRoot, projectPath] : NO_ROOTS), [gitRoot, projectPath]);

  // The person's chosen scope, remembered per viewer. "Last turn" needs a
  // message of theirs in the loaded window; without one it reads as the session.
  const [chosen, setChosen] = useState<LiteDiffScope>(() => {
    const pref = readLitePref<string>(SCOPE_PREF, "session");
    return (LITE_DIFF_SCOPES as readonly string[]).includes(pref) ? (pref as LiteDiffScope) : "session";
  });
  const pickScope = (next: LiteDiffScope) => {
    setChosen(next);
    writeLitePref(SCOPE_PREF, next);
  };
  const turnStartedAt = useMemo(() => lastPromptAt(messages), [messages]);
  const turnStart = useMemo(() => diffBaseStart(changes, "turn", { turnStartedAt }), [changes, turnStartedAt]);
  const scope: LiteDiffScope = chosen === "turn" && turnStart === null ? "session" : chosen;

  // Session and turn: the changes the fold reads, their text, then the files.
  const foldInputs = useMemo(
    () => (scope === "uncommitted" ? NO_INPUTS : selectRangeFoldInputs(changes, scope === "turn" ? turnStart ?? 0 : 0, null)),
    [scope, changes, turnStart],
  );
  const needed = useMemo(() => [...new Set([...foldInputs.base, ...foldInputs.head])], [foldInputs]);
  useFileChangeBodies(sessionId, needed);
  const folded = useMemo(() => panelFilesFromFold(foldReadyFiles(foldInputs, bodies, missing).files), [foldInputs, bodies, missing]);
  const pending = useMemo(
    () => (scope === "uncommitted" ? NO_PATHS : pendingFoldPaths(foldInputs, bodies, missing)),
    [scope, foldInputs, bodies, missing],
  );

  // Uncommitted: the working tree's diff, subscribed only while it shows.
  const gitDiff = useSessionGitDiff(sessionId, scope === "uncommitted");
  const treeFiles = useMemo(() => panelFilesFromGitDiff(gitDiff), [gitDiff]);

  const files: PanelFile[] = (scope === "uncommitted" ? treeFiles : folded) ?? NO_FILES;
  const loading = scope === "uncommitted" ? treeFiles === undefined : !mine || (!indexSettled && changes.length === 0);
  const totals = useMemo(() => panelTotals(files), [files]);
  const count = files.length + pending.length;

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    }), []);

  // "Show this file" (an edit row's open-in-changes): open its row and bring
  // it into view. A file still on its way is waited for; one outside the
  // scope showing is looked for in the whole session; one the session never
  // changed is let go.
  const { rightPanelFocus } = useLiteLayout();
  const rows = useRef(new Map<string, HTMLElement>());
  const registerRow = useCallback((key: string, el: HTMLElement | null) => {
    if (el) rows.current.set(key, el);
    else rows.current.delete(key);
  }, []);
  const [scrollTo, setScrollTo] = useState<{ key: string } | null>(null);
  useWatchEffect(() => {
    const focus = rightPanelFocus;
    if (!focus || shownFocus.has(focus) || loading) return;
    const key = findPanelFile(files, focus.file, roots);
    if (key) {
      shownFocus.add(focus);
      setOpen((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
      setScrollTo({ key });
      return;
    }
    if (findPanelFile(pending.map((p) => ({ key: p, path: p })), focus.file, roots)) return;
    if (scope !== "session") {
      setChosen("session");
      return;
    }
    // The index may still name it.
    if (!indexSettled) return;
    shownFocus.add(focus);
  }, [rightPanelFocus, loading, files, pending, roots, scope, indexSettled]);
  useWatchEffect(() => {
    if (scrollTo) rows.current.get(scrollTo.key)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [scrollTo]);

  return (
    <>
      <div className="lt-diff-bar">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="lt-scope" aria-label={`Diff scope: ${LITE_SCOPE_LABEL[scope]}`}>
              {LITE_SCOPE_LABEL[scope]}
              <ChevronDown aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" data-lite="" className="lt-menu">
            {LITE_DIFF_SCOPES.map((s) => (
              <DropdownMenuItem key={s} className="lt-menu-item" disabled={s === "turn" && turnStart === null} onSelect={() => pickScope(s)}>
                <span className="flex-1">{LITE_SCOPE_LABEL[s]}</span>
                {s === scope && <Check className="w-4 h-4 text-[var(--lt-accent)]" aria-label="Current" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {!loading && count > 0 && (
          <span className="lt-diff-sum">
            <span>{count} {count === 1 ? "file" : "files"}</span>
            <span className="lt-add">+{totals.additions}</span>
            <span className="lt-del">−{totals.deletions}</span>
          </span>
        )}
      </div>

      {loading ? (
        <div className="lt-files" aria-busy="true" aria-label="Loading changes">
          {[0, 1, 2].map((i) => (
            <div key={i} className="lt-file-row" data-pending="">
              <span className="lt-skel" style={{ width: `${62 - i * 14}%` }} />
            </div>
          ))}
        </div>
      ) : count === 0 ? (
        <div className="lt-panel-empty">{LITE_SCOPE_EMPTY[scope]}</div>
      ) : (
        <div className="lt-files">
          {files.map((file) => (
            <LiteFileRow
              key={file.key}
              file={file}
              path={displayPath(file.path, roots)}
              open={open.has(file.key)}
              onToggle={toggle}
              register={registerRow}
            />
          ))}
          {pending.map((path) => (
            <div key={`pending:${path}`} className="lt-file" aria-busy="true">
              <div className="lt-file-row" data-pending="" title={path}>
                <span className="lt-file-status" />
                <FilePath path={displayPath(path, roots)} />
                <span className="lt-skel lt-skel-stat" />
              </div>
            </div>
          ))}
        </div>
      )}

      {scope === "session" && <LiteCommits sessionId={sessionId} />}
    </>
  );
}

/** One changed file: its row, and its diff under it while open. Held by
 *  memo, so a streamed reply that changes no file redraws no row. */
const LiteFileRow = memo(function LiteFileRow({ file, path, open, onToggle, register }: {
  file: PanelFile;
  /** The path as the person reads it (displayPath). */
  path: string;
  open: boolean;
  onToggle: (key: string) => void;
  register: (key: string, el: HTMLElement | null) => void;
}) {
  return (
    <div className="lt-file" data-open={open || undefined} ref={(el) => register(file.key, el)}>
      <button type="button" className="lt-file-row" aria-expanded={open} title={file.path} onClick={() => onToggle(file.key)}>
        <span className="lt-file-status" data-status={file.status}>{file.status}</span>
        <FilePath path={path} />
        {file.staged && <span className="lt-file-tag">staged</span>}
        <span className="lt-file-stat">
          {file.additions > 0 && <span className="lt-add">+{file.additions}</span>}
          {file.deletions > 0 && <span className="lt-del">−{file.deletions}</span>}
        </span>
      </button>
      {open && (
        <div className="lt-file-diff">
          <LiteFileDiff file={file} />
        </div>
      )}
    </div>
  );
});

/** A path on one line: the folder gives way first, so the file's name stays. */
function FilePath({ path }: { path: string }) {
  const { dir, base } = splitPath(path);
  return (
    <span className="lt-path">
      {dir && <span className="lt-path-dir">{dir}</span>}
      <span className="lt-path-base">{base}</span>
    </span>
  );
}

/** The session's commits, newest first. Each opens its commit page. */
function LiteCommits({ sessionId }: { sessionId: string }) {
  useSyncConversationCommits(sessionId);
  const commits = useConversationCommits(sessionId);
  if (commits.length === 0) return null;
  return (
    <section className="lt-commits" aria-label="Commits">
      <div className="lt-panel-label">Commits</div>
      {commits.map((c) => {
        const body = (
          <>
            <span className="lt-commit-sha">{String(c.sha ?? "").slice(0, 7)}</span>
            <span className="lt-commit-subject">{commitSubject(c.message)}</span>
          </>
        );
        return c.repository && c.sha ? (
          <Link key={c._id ?? c.sha} href={`/commit/${c.repository}/${c.sha}`} className="lt-commit" title={c.message}>
            {body}
          </Link>
        ) : (
          <div key={c._id ?? c.sha} className="lt-commit" title={c.message}>{body}</div>
        );
      })}
    </section>
  );
}
