import { describe, expect, it } from "bun:test";
import {
  groupLiteProjects,
  groupLiteTeammates,
  liteAge,
  liteMarkLabel,
  liteMarkOf,
  liteProjectOf,
  liteSidebarOrder,
  liteStep,
  liteTeammateMarkOf,
  strongestMark,
  visibleRowsOf,
  type LiteMark,
  type LiteRowFacts,
  type LiteTeammateRow,
} from "../sidebarModel";

const basename = (gitRoot?: string, projectPath?: string) => (gitRoot || projectPath || "").split("/").filter(Boolean).pop() || "unknown";

function row(id: string, project: string, sortAt: number, mark: LiteMark = null): LiteRowFacts {
  return { id, title: `Session ${id}`, projectKey: `dir:${project}`, projectLabel: project, projectDetail: `/src/${project}`, activityAt: sortAt, sortAt, mark, machine: null };
}

describe("liteMarkOf", () => {
  const quiet = { unread: false, failed: false };

  it("only an ask aimed at the person needs them, whatever the agent is doing", () => {
    expect(liteMarkOf("questions", quiet)).toBe("needs");
    expect(liteMarkOf("questions", { workState: "working", unread: true, failed: true })).toBe("needs");
  });

  it("a finished turn waiting for the person's next step is quiet once read, and done until then", () => {
    // The inbox files every finished, undismissed session under needsInput:
    // that alone is the steady state, not a claim on the person.
    expect(liteMarkOf("needsInput", quiet)).toBeNull();
    expect(liteMarkOf("needsInput", { unread: true, failed: false })).toBe("done");
    expect(liteMarkOf("done", { unread: true, failed: false })).toBe("done");
    expect(liteMarkOf("done", quiet)).toBeNull();
    expect(liteMarkOf("dormant", { unread: true, failed: false })).toBe("done");
    expect(liteMarkOf("dormant", quiet)).toBeNull();
  });

  it("a row stuck on a failure says so, read or not", () => {
    expect(liteMarkOf("needsInput", { unread: false, failed: true })).toBe("error");
    expect(liteMarkOf("needsInput", { unread: true, failed: true })).toBe("error");
  });

  it("a failure counts only where the row waits on input: the person's own verdict files it elsewhere", () => {
    expect(liteMarkOf("done", { unread: false, failed: true })).toBeNull();
    expect(liteMarkOf("dormant", { unread: true, failed: true })).toBe("done");
  });

  it("marks working, unread or not", () => {
    expect(liteMarkOf("working", quiet)).toBe("working");
    expect(liteMarkOf("working", { unread: true, failed: false })).toBe("working");
  });

  it("a pinned, new or set-aside row reads its own state", () => {
    expect(liteMarkOf("pinned", { workState: "working", unread: false, failed: false })).toBe("working");
    expect(liteMarkOf("pinned", { workState: "needs_input", unread: false, failed: false })).toBeNull();
    expect(liteMarkOf("pinned", { workState: "needs_input", unread: false, failed: true })).toBe("error");
    expect(liteMarkOf("shelved", { workState: "done", unread: true, failed: false })).toBe("done");
    expect(liteMarkOf("newSessions", { workState: "idle", unread: false, failed: false })).toBeNull();
  });

  it("the section's state wins over the row's own", () => {
    expect(liteMarkOf("working", { workState: "needs_input", unread: false, failed: true })).toBe("working");
  });

  it("a teammate's row shows what it is doing, never an unread mark, and waits on its owner only when it asks", () => {
    expect(liteTeammateMarkOf("needs_input", true)).toBe("waiting");
    expect(liteTeammateMarkOf("needs_input", false)).toBeNull();
    expect(liteTeammateMarkOf("working", false)).toBe("working");
    expect(liteTeammateMarkOf("done", false)).toBeNull();
  });
});

describe("liteMarkLabel", () => {
  it("says each mark in the words a pill shows", () => {
    expect(liteMarkLabel("needs")).toBe("Needs you");
    expect(liteMarkLabel("error")).toBe("Failed");
    expect(liteMarkLabel("done")).toBe("Done");
    expect(liteMarkLabel("working")).toBe("Working");
    expect(liteMarkLabel(null)).toBeNull();
  });

  it("names who a teammate's session waits on by their first name", () => {
    expect(liteMarkLabel("waiting", "Maya Kim")).toBe("Waiting on Maya");
    expect(liteMarkLabel("waiting", "  ")).toBe("Waiting on its owner");
    expect(liteMarkLabel("waiting")).toBe("Waiting on its owner");
  });
});

describe("liteProjectOf", () => {
  it("groups by GitHub repository when the session has one", () => {
    const a = liteProjectOf({ git_remote_url: "git@github.com:acme/codecast.git", git_root: "/Users/me/src/codecast" }, basename);
    const worktree = liteProjectOf({ git_remote_url: "https://github.com/acme/codecast", git_root: "/Users/me/src/codecast/.codecast/worktrees/fix-auth" }, basename);
    expect(a.key).toBe(worktree.key);
    expect(a.label).toBe("codecast");
    expect(a.detail).toBe("acme/codecast");
  });

  it("falls back to the folder name the classic inbox groups by", () => {
    const p = liteProjectOf({ git_root: "/Users/me/src/notes" }, basename);
    expect(p).toEqual({ key: "dir:notes", label: "notes", detail: "/Users/me/src/notes" });
    expect(liteProjectOf({ project_path: "/tmp/scratch" }, basename).label).toBe("scratch");
  });

  it("a checkout rooted at a home directory is not a repository", () => {
    expect(liteProjectOf({ git_remote_url: "https://github.com/me/dotfiles", git_root: "/Users/me" }, basename).key).toBe("dir:me");
  });
});

describe("groupLiteProjects", () => {
  it("orders projects by their newest row and rows newest first", () => {
    const groups = groupLiteProjects([row("a", "old", 10), row("b", "new", 50), row("c", "old", 30), row("d", "new", 20)]);
    expect(groups.map((g) => g.label)).toEqual(["new", "old"]);
    expect(groups[0]!.shown.map((r) => r.id)).toEqual(["b", "d"]);
    expect(groups[1]!.shown.map((r) => r.id)).toEqual(["c", "a"]);
    expect(groups[1]!.latestAt).toBe(30);
  });

  it("orders by the event stamp, not by the activity that moves while an agent streams", () => {
    // b streamed a message a moment ago, but its turn began before a's.
    const a = { ...row("a", "p", 20), activityAt: 20 };
    const b = { ...row("b", "p", 10), activityAt: 99 };
    expect(groupLiteProjects([a, b])[0]!.all.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("caps a project's rows, but never hides one that needs you, one that failed, or the one open", () => {
    const rows = Array.from({ length: 13 }, (_, i) => row(`r${i}`, "big", 100 - i));
    rows[10] = { ...rows[10]!, mark: "needs" };
    rows[12] = { ...rows[12]!, mark: "error" };
    const [g] = groupLiteProjects(rows, { cap: 8, activeId: "r11" });
    expect(g!.shown.map((r) => r.id)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r10", "r11", "r12"]);
    expect(g!.hiddenCount).toBe(2);
    expect(g!.mark).toBe("needs");
  });

  it("a done row past the cap stays in the rest", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`, "big", 100 - i, i === 9 ? "done" : null));
    const [g] = groupLiteProjects(rows, { cap: 8 });
    expect(g!.shown.map((r) => r.id)).not.toContain("r9");
  });

  it("shows every row of a project the person opened in full", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`, "big", 100 - i));
    const [g] = groupLiteProjects(rows, { cap: 8, showAll: new Set(["dir:big"]) });
    expect(g!.shown).toHaveLength(10);
    expect(g!.hiddenCount).toBe(0);
  });

  it("names two same-named projects by their fuller name", () => {
    const a = { ...row("a", "codecast", 2), projectKey: "repo:acme/codecast", projectDetail: "acme/codecast" };
    const b = { ...row("b", "codecast", 1), projectKey: "dir:codecast", projectDetail: "/tmp/codecast" };
    const c = row("c", "notes", 3);
    expect(groupLiteProjects([a, b, c]).map((g) => g.label)).toEqual(["notes", "acme/codecast", "/tmp/codecast"]);
  });
});

describe("visibleRowsOf and liteSidebarOrder", () => {
  const groups = groupLiteProjects([row("a1", "a", 40), row("a2", "a", 30), row("b1", "b", 20), row("b2", "b", 10)]);

  it("a closed project draws only the session open inside it", () => {
    const a = groups[0]!;
    expect(visibleRowsOf(a, true, null)).toEqual([]);
    expect(visibleRowsOf(a, true, "a2").map((r) => r.id)).toEqual(["a2"]);
    expect(visibleRowsOf(a, false, null).map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("walks the rows as drawn, teammates last", () => {
    expect(liteSidebarOrder(groups, new Set(), null, ["t1"])).toEqual(["a1", "a2", "b1", "b2", "t1"]);
    expect(liteSidebarOrder(groups, new Set(["dir:a"]), "a1", ["t1"])).toEqual(["a1", "b1", "b2", "t1"]);
    expect(liteSidebarOrder(groups, new Set(["dir:a"]), null)).toEqual(["b1", "b2"]);
  });
});

describe("liteStep", () => {
  const order = ["a", "b", "c"];
  it("moves one row and stops at either end", () => {
    expect(liteStep(order, "a", 1)).toBe("b");
    expect(liteStep(order, "b", -1)).toBe("a");
    expect(liteStep(order, "c", 1)).toBeNull();
    expect(liteStep(order, "a", -1)).toBeNull();
  });
  it("from no open session, next starts at the top and previous at the bottom", () => {
    expect(liteStep(order, null, 1)).toBe("a");
    expect(liteStep(order, "gone", -1)).toBe("c");
    expect(liteStep([], null, 1)).toBeNull();
  });
});

describe("groupLiteTeammates", () => {
  const t = (id: string, ownerId: string, mark: "working" | "waiting", sortAt: number): LiteTeammateRow =>
    ({ id, title: id, mark, activityAt: sortAt, sortAt, ownerId, ownerName: ownerId.toUpperCase(), ownerImage: null });

  it("files each teammate's sessions under them, the one waiting first", () => {
    const groups = groupLiteTeammates([t("m1", "maya", "working", 50), t("j1", "jon", "working", 10), t("m2", "maya", "waiting", 5)]);
    expect(groups.map((g) => g.ownerId)).toEqual(["maya", "jon"]);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(["m2", "m1"]);
  });
});

describe("strongestMark", () => {
  it("needs you outranks failed, then unread, then waiting on someone else, then working", () => {
    expect(strongestMark(["working", "done", null])).toBe("done");
    expect(strongestMark(["working", "waiting"])).toBe("waiting");
    expect(strongestMark(["working", "needs", "done"])).toBe("needs");
    expect(strongestMark(["done", "error", "working"])).toBe("error");
    expect(strongestMark(["error", "needs"])).toBe("needs");
    expect(strongestMark([null, null])).toBeNull();
  });
});

describe("liteAge", () => {
  const now = 1_000_000_000_000;
  it("reads at a glance", () => {
    expect(liteAge(now - 10_000, now)).toBe("now");
    expect(liteAge(now - 5 * 60_000, now)).toBe("5m");
    expect(liteAge(now - 3 * 3_600_000, now)).toBe("3h");
    expect(liteAge(now - 2 * 86_400_000, now)).toBe("2d");
    expect(liteAge(now - 15 * 86_400_000, now)).toBe("2w");
  });
  it("says nothing for a row with no activity stamp", () => {
    expect(liteAge(0, now)).toBe("");
    expect(liteAge(undefined, now)).toBe("");
  });
});
