// The Lite session panel's changes tab, as data: which changes a scope
// shows, each changed file as one row (status letter, path, +/−), the files
// still waiting on their text, and which row a "show this file" request
// means. Pure, so the rows and the scope rules are tested without a DOM.
import { getRelativePath } from "@codecast/shared/render";
import type { RangeDiffFile } from "@codecast/shared/diff";
import type { FileChangeBody } from "../fileChangeExtractor";
import { parseCastDiff } from "../castDiff";
import type { PatchHunk } from "../patchParser";
import type { FileChangeEntry } from "../../store/diffViewerStore";

/** What the changes tab folds. `session`: every change the session made.
 *  `turn`: the changes since the person's last message. `uncommitted`: the
 *  working tree against HEAD, as the daemon last reported it. */
export type LiteDiffScope = "session" | "turn" | "uncommitted";
export const LITE_DIFF_SCOPES: readonly LiteDiffScope[] = ["session", "turn", "uncommitted"];
export const LITE_SCOPE_LABEL: Record<LiteDiffScope, string> = {
  session: "Session",
  turn: "Last turn",
  uncommitted: "Uncommitted",
};
export const LITE_SCOPE_EMPTY: Record<LiteDiffScope, string> = {
  session: "No changes yet",
  turn: "No changes since your last message",
  uncommitted: "No uncommitted changes",
};

export type PanelFileStatus = "A" | "M" | "D" | "R";

/** One changed file, whatever folded it: a session fold carries a unified
 *  patch, a working-tree diff its parsed hunks. `key` is unique in a list
 *  (a file staged and also changed since shows twice). */
export type PanelFile = {
  key: string;
  path: string;
  status: PanelFileStatus;
  additions: number;
  deletions: number;
  patch?: string;
  hunks?: PatchHunk[];
  staged?: boolean;
};

export function statusLetter(status: string): PanelFileStatus {
  switch (status.toLowerCase()) {
    case "added":
      return "A";
    case "deleted":
    case "removed":
      return "D";
    case "renamed":
      return "R";
    default:
      return "M";
  }
}

/** The rows of a session or turn fold (computeRangeFiles' order: newest file first). */
export function panelFilesFromFold(files: readonly RangeDiffFile[]): PanelFile[] {
  return files.map((f) => ({
    key: f.filename,
    path: f.filename,
    status: statusLetter(f.status),
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));
}

/** The rows of the working tree's diff: what is staged first, then what is
 *  not. Undefined while the diff is on its way; empty when there is none. */
export function panelFilesFromGitDiff(
  diff: { git_diff?: string | null; git_diff_staged?: string | null } | null | undefined,
): PanelFile[] | undefined {
  if (diff === undefined) return undefined;
  if (diff === null) return [];
  const rows = (raw: string | null | undefined, staged: boolean): PanelFile[] =>
    raw?.trim()
      ? parseCastDiff(raw).map((f) => ({
          key: staged ? `staged:${f.path}` : f.path,
          path: f.path,
          status: statusLetter(f.status),
          additions: f.additions,
          deletions: f.deletions,
          hunks: f.hunks,
          ...(staged ? { staged: true } : {}),
        }))
      : [];
  return [...rows(diff.git_diff_staged, true), ...rows(diff.git_diff, false)];
}

export function panelTotals(files: readonly PanelFile[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}

/**
 * The files of a fold whose text has not all arrived: the rows the tab
 * holds a place for while useFileChangeBodies fetches. The same readiness
 * rule as foldReadyFiles (lib/conversationDiffFiles), which counts them but
 * does not name them; a file with a change the server has no text for is
 * neither ready nor pending, and shows nothing. Newest file first.
 */
export function pendingFoldPaths(
  inputs: { base: readonly FileChangeEntry[]; head: readonly FileChangeEntry[] },
  bodies: Record<string, FileChangeBody>,
  missing: Record<string, true>,
): string[] {
  const byFile = new Map<string, { waiting: boolean; missing: boolean; last: number }>();
  for (const change of [...inputs.base, ...inputs.head]) {
    const state = byFile.get(change.filePath) ?? { waiting: false, missing: false, last: -1 };
    if (missing[change.id]) state.missing = true;
    else if (change.newContent === undefined && !bodies[change.id]) state.waiting = true;
    state.last = Math.max(state.last, change.sequenceIndex);
    byFile.set(change.filePath, state);
  }
  return [...byFile]
    .filter(([, s]) => s.waiting && !s.missing)
    .sort((a, b) => b[1].last - a[1].last)
    .map(([path]) => path);
}

/** A path as the person reads it: inside the session's repository or
 *  project, relative to it; an absolute path elsewhere, its familiar tail. */
export function displayPath(path: string, roots: ReadonlyArray<string | null | undefined> = []): string {
  for (const root of roots) {
    if (!root) continue;
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (path.startsWith(prefix)) return path.slice(prefix.length);
  }
  return path.startsWith("/") ? getRelativePath(path) : path;
}

/** The folder part and the file name, for a row that truncates the folder
 *  and keeps the name whole. The folder keeps its trailing slash. */
export function splitPath(path: string): { dir: string; base: string } {
  const at = path.lastIndexOf("/");
  return at < 0 ? { dir: "", base: path } : { dir: path.slice(0, at + 1), base: path.slice(at + 1) };
}

/**
 * The row a "show this file" request means. The request names the file as
 * a tool call did (often absolute); a fold names it the same way, a
 * working-tree diff relative to the repository. Exact first, then the same
 * display path, then one path ending with the other at a folder boundary.
 */
export function findPanelFile(
  files: ReadonlyArray<Pick<PanelFile, "key" | "path">>,
  wanted: string,
  roots: ReadonlyArray<string | null | undefined> = [],
): string | undefined {
  const exact = files.find((f) => f.path === wanted);
  if (exact) return exact.key;
  const shown = displayPath(wanted, roots);
  const same = files.find((f) => displayPath(f.path, roots) === shown);
  if (same) return same.key;
  const tail = (long: string, short: string) => long.length > short.length && long.endsWith(`/${short.replace(/^\/+/, "")}`);
  return files.find((f) => tail(wanted, f.path) || tail(f.path, wanted))?.key;
}

/** A commit's first line. */
export function commitSubject(message: string | null | undefined): string {
  return (message ?? "").split("\n", 1)[0].trim();
}
