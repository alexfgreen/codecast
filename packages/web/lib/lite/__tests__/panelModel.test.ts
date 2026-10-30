import { describe, expect, it } from "bun:test";
import { computeRangeFiles } from "@codecast/shared/diff";
import {
  commitSubject,
  displayPath,
  findPanelFile,
  panelFilesFromFold,
  panelFilesFromGitDiff,
  panelTotals,
  pendingFoldPaths,
  splitPath,
  statusLetter,
} from "../panelModel";
import type { FileChangeEntry } from "../../../store/diffViewerStore";

const change = (over: Partial<FileChangeEntry> & Pick<FileChangeEntry, "id" | "filePath" | "sequenceIndex">): FileChangeEntry => ({
  messageId: "m1",
  changeType: "write",
  timestamp: over.sequenceIndex,
  newBytes: 10,
  ...over,
});

describe("statusLetter", () => {
  it("names each status by its letter, modified for anything else", () => {
    expect(statusLetter("added")).toBe("A");
    expect(statusLetter("deleted")).toBe("D");
    expect(statusLetter("removed")).toBe("D");
    expect(statusLetter("renamed")).toBe("R");
    expect(statusLetter("modified")).toBe("M");
    expect(statusLetter("changed")).toBe("M");
  });
});

describe("panelFilesFromFold", () => {
  it("keeps the fold's order, counts and patch, keyed by path", () => {
    const files = computeRangeFiles([], [
      { id: "a", sequenceIndex: 0, messageId: "m", filePath: "/r/a.ts", changeType: "write", newContent: "one\n", timestamp: 0 },
      { id: "b", sequenceIndex: 1, messageId: "m", filePath: "/r/b.ts", changeType: "write", oldContent: "x\n", newContent: "y\n", timestamp: 1 },
    ]);
    const rows = panelFilesFromFold(files);
    expect(rows.map((r) => [r.key, r.status, r.additions, r.deletions])).toEqual([
      ["/r/b.ts", "M", 1, 1],
      ["/r/a.ts", "A", 1, 0],
    ]);
    expect(rows[0].patch).toContain("+y");
  });
});

const UNSTAGED = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+new",
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+one",
  "+two",
].join("\n");
const STAGED = ["diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-a", "+b"].join("\n");

describe("panelFilesFromGitDiff", () => {
  it("is undefined while loading and empty when there is nothing", () => {
    expect(panelFilesFromGitDiff(undefined)).toBeUndefined();
    expect(panelFilesFromGitDiff(null)).toEqual([]);
    expect(panelFilesFromGitDiff({ git_diff: "  \n", git_diff_staged: null })).toEqual([]);
  });

  it("lists what is staged first, then each file of the rest, with hunks", () => {
    const rows = panelFilesFromGitDiff({ git_diff: UNSTAGED, git_diff_staged: STAGED })!;
    expect(rows.map((r) => [r.key, r.status, r.additions, r.deletions, !!r.staged])).toEqual([
      ["staged:src/a.ts", "M", 1, 1, true],
      ["src/a.ts", "M", 1, 1, false],
      ["src/new.ts", "A", 2, 0, false],
    ]);
    expect(rows[2].hunks?.[0].lines.length).toBe(2);
  });
});

describe("panelTotals", () => {
  it("sums the additions and deletions", () => {
    const rows = panelFilesFromGitDiff({ git_diff: UNSTAGED, git_diff_staged: STAGED })!;
    expect(panelTotals(rows)).toEqual({ additions: 4, deletions: 2 });
    expect(panelTotals([])).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("pendingFoldPaths", () => {
  it("names the files with a change still without text, newest first", () => {
    const head = [
      change({ id: "1", filePath: "/r/a.ts", sequenceIndex: 0, newContent: "known" }),
      change({ id: "2", filePath: "/r/b.ts", sequenceIndex: 1 }),
      change({ id: "3", filePath: "/r/c.ts", sequenceIndex: 2 }),
      change({ id: "4", filePath: "/r/d.ts", sequenceIndex: 3 }),
    ];
    // b's text arrived, c's never will, d's is on its way; a carries its own.
    expect(pendingFoldPaths({ base: [], head }, { "2": { newContent: "b" } }, { "3": true })).toEqual(["/r/d.ts"]);
    expect(pendingFoldPaths({ base: [], head }, {}, {})).toEqual(["/r/d.ts", "/r/c.ts", "/r/b.ts"]);
  });

  it("waits on the boundary's text too", () => {
    const base = [change({ id: "0", filePath: "/r/a.ts", sequenceIndex: 0 })];
    const head = [change({ id: "1", filePath: "/r/a.ts", sequenceIndex: 1, newContent: "x" })];
    expect(pendingFoldPaths({ base, head }, {}, {})).toEqual(["/r/a.ts"]);
    expect(pendingFoldPaths({ base, head }, { "0": { newContent: "w" } }, {})).toEqual([]);
  });
});

describe("displayPath", () => {
  it("reads a path inside the session's repository relative to it", () => {
    expect(displayPath("/Users/me/src/app/lib/x.ts", ["/Users/me/src/app"])).toBe("lib/x.ts");
    expect(displayPath("/Users/me/src/app/lib/x.ts", [null, "/Users/me/src/app/"])).toBe("lib/x.ts");
  });
  it("falls back to the familiar tail outside it, and leaves a relative path alone", () => {
    expect(displayPath("/Users/me/src/other/x.ts", ["/Users/me/src/app"])).toBe("other/x.ts");
    expect(displayPath("src/a.ts", ["/Users/me/src/app"])).toBe("src/a.ts");
  });
  it("does not strip a sibling that only shares the prefix", () => {
    expect(displayPath("/w/app-two/x.ts", ["/w/app"])).not.toBe("-two/x.ts");
  });
});

describe("splitPath", () => {
  it("splits the folder, with its slash, from the name", () => {
    expect(splitPath("a/b/c.ts")).toEqual({ dir: "a/b/", base: "c.ts" });
    expect(splitPath("c.ts")).toEqual({ dir: "", base: "c.ts" });
  });
});

describe("findPanelFile", () => {
  const files = [
    { key: "/w/app/src/a.ts", path: "/w/app/src/a.ts" },
    { key: "staged:lib/b.ts", path: "lib/b.ts" },
  ];
  it("finds the exact path", () => {
    expect(findPanelFile(files, "/w/app/src/a.ts")).toBe("/w/app/src/a.ts");
  });
  it("finds an absolute request among repository-relative rows", () => {
    expect(findPanelFile(files, "/w/app/lib/b.ts", ["/w/app"])).toBe("staged:lib/b.ts");
    expect(findPanelFile(files, "/elsewhere/app/lib/b.ts")).toBe("staged:lib/b.ts");
  });
  it("finds a relative request among absolute rows, only at a folder boundary", () => {
    expect(findPanelFile(files, "src/a.ts")).toBe("/w/app/src/a.ts");
    expect(findPanelFile(files, "c/a.ts")).toBeUndefined();
    expect(findPanelFile(files, "nope.ts")).toBeUndefined();
  });
});

describe("commitSubject", () => {
  it("is the first line", () => {
    expect(commitSubject("fix: the race\n\nlong body")).toBe("fix: the race");
    expect(commitSubject(undefined)).toBe("");
  });
});
