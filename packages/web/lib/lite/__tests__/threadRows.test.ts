import { describe, expect, test } from "bun:test";
import { buildLiteRows, formatWorkedFor, reuseStableRows, toolSentence, turnLabel, visibleLiteRows, type LiteRow } from "../threadRows";
import { renderGalleryMessages } from "../../renderGallery";
import { classifyUserRows } from "../../userRowKinds";
import type { Message } from "../../../components/conversation/types";

let n = 0;
let t = 1_790_000_000_000;
const at = (s: number) => (t = 1_790_000_000_000 + s * 1000);
const id = () => `m${++n}`;
const person = (content: string, s: number, extra: Partial<Message> = {}): Message => ({ _id: id(), role: "user", content, timestamp: at(s), ...extra });
const reply = (content: string, s: number, extra: Partial<Message> = {}): Message => ({ _id: id(), role: "assistant", content, timestamp: at(s), ...extra });
const call = (name: string, input: Record<string, unknown> = {}) => ({ id: `t${++n}`, name, input: JSON.stringify(input) });
/** A tool-only assistant row and its result carrier. */
const tools = (s: number, calls: ReturnType<typeof call>[], opts: { error?: boolean } = {}): Message[] => [
  { _id: id(), role: "assistant", content: "", timestamp: at(s), tool_calls: calls },
  { _id: id(), role: "user", content: "", timestamp: at(s + 1), tool_results: calls.map((c) => ({ tool_use_id: c.id, content: "ok\nline two", is_error: opts.error })) },
];

const kinds = (rows: LiteRow[]) => rows.map((r) => r.kind);

describe("toolSentence and durations", () => {
  test("a run summary reads as a sentence", () => {
    expect(toolSentence("read 3 files · ran 2 commands")).toBe("Read 3 files and ran 2 commands");
    expect(toolSentence("read a.ts · ran npm test · edited b.ts")).toBe("Read a.ts, ran npm test and edited b.ts");
    expect(toolSentence("ran npx tsc")).toBe("Ran npx tsc");
  });
  test("durations", () => {
    expect(formatWorkedFor(40_000)).toBe("40s");
    expect(formatWorkedFor(133_000)).toBe("2m 13s");
    expect(formatWorkedFor(3_900_000)).toBe("1h 5m");
  });
});

describe("buildLiteRows", () => {
  test("a finished turn folds its work into one row and keeps its final reply", () => {
    const msgs: Message[] = [
      person("fix the race", 0),
      reply("Looking.", 2),
      ...tools(3, [call("Read", { file_path: "/r/a.ts" })]),
      ...tools(5, [call("Bash", { command: "bun test" })]),
      reply("Fixed it.", 133),
      person("thanks", 200),
    ];
    const rows = buildLiteRows(msgs, { active: false });
    expect(kinds(rows)).toEqual(["user", "turn", "text", "user"]);
    const turn = rows[1] as Extract<LiteRow, { kind: "turn" }>;
    expect(turnLabel(turn)).toBe("Worked for 2m 13s");
    expect(kinds(turn.children)).toEqual(["text", "run"]);
    const run = turn.children[1] as Extract<LiteRow, { kind: "run" }>;
    expect(run.steps.map((s) => s.call.name)).toEqual(["Read", "Bash"]);
    expect(run.label).toBe("Read r/a.ts and ran bun test");
    expect((rows[2] as Extract<LiteRow, { kind: "text" }>).content).toBe("Fixed it.");
  });

  test("the last turn stays open while the agent works, and a working row ends the list", () => {
    const pending = call("Bash", { command: "bun test" });
    const msgs: Message[] = [
      person("go", 0),
      reply("On it.", 1),
      { _id: id(), role: "assistant", content: "", timestamp: at(2), tool_calls: [pending] },
    ];
    const rows = buildLiteRows(msgs, { active: true });
    expect(kinds(rows)).toEqual(["user", "text", "run", "working"]);
    const working = rows[3] as Extract<LiteRow, { kind: "working" }>;
    expect(working.since).toBe(msgs[0].timestamp);
    expect(working.live?.call.id).toBe(pending.id);
  });

  test("an interrupted turn reads as stopped, and its interrupt notice folds into that", () => {
    const msgs: Message[] = [
      person("go", 0),
      ...tools(1, [call("Read", { file_path: "/a" })]),
      person("[Request interrupted by user]", 40),
      person("try again", 50),
    ];
    const rows = buildLiteRows(msgs, { active: false });
    expect(kinds(rows)).toEqual(["user", "turn", "user"]);
    expect(turnLabel(rows[1] as Extract<LiteRow, { kind: "turn" }>)).toBe("You stopped after 40s");
  });

  test("errors and cards stay visible in a finished turn", () => {
    const msgs: Message[] = [
      person("go", 0),
      ...tools(1, [call("Read", { file_path: "/a" })]),
      ...tools(3, [call("Edit", { file_path: "/b", old_string: "x", new_string: "y" })], { error: true }),
      ...tools(5, [call("TodoWrite", { todos: [] })]),
      ...tools(7, [call("Bash", { command: 'cast send jx7abcd "hi"' })]),
      reply("Done.", 9),
    ];
    const rows = buildLiteRows(msgs, { active: false });
    // The read and the failed edit are one run, and the failure keeps it in view.
    expect(kinds(rows)).toEqual(["user", "run", "card", "card", "text"]);
    expect((rows[1] as Extract<LiteRow, { kind: "run" }>).error).toBe(true);
  });

  test("a person's words, a session's message and dividers become rows; machine rows do not", () => {
    const msgs: Message[] = [
      person("<user-message from=\"Sarah Chen\">\nShip it.\n</user-message>", 0),
      person("<session-message from=\"jx7bm3n\" name=\"iOS perf\">\nParser cost is fine.\n</session-message>", 1),
      person("<system-reminder>context only</system-reminder>", 2),
      person("", 3),
      { _id: id(), role: "system", subtype: "compact_boundary", content: "Conversation compacted", timestamp: at(4) },
    ];
    const rows = buildLiteRows(msgs, { active: false });
    expect(kinds(rows)).toEqual(["user", "session_message", "divider"]);
    expect((rows[0] as Extract<LiteRow, { kind: "user" }>).author).toBe("Sarah Chen");
  });

  test("an optimistic send and its echo keep one key", () => {
    const pending: Message = { _id: "client-1", client_id: "client-1", role: "user", content: "hi", timestamp: at(0), _isOptimistic: true };
    const echo: Message = { _id: "jx7server", client_id: "client-1", role: "user", content: "hi", timestamp: at(0) };
    expect(buildLiteRows([pending], { active: false })[0].key).toBe(buildLiteRows([echo], { active: false })[0].key);
  });

  test("opening a fold and a run lays their rows out one level in", () => {
    const msgs: Message[] = [
      person("go", 0),
      ...tools(1, [call("Read", { file_path: "/a" }), call("Read", { file_path: "/b" })]),
      reply("Done.", 5),
    ];
    const rows = buildLiteRows(msgs, { active: false });
    const turn = rows[1];
    const run = (turn as Extract<LiteRow, { kind: "turn" }>).children[0];
    const shut = visibleLiteRows(rows, new Set());
    expect(shut.map((r) => r.kind)).toEqual(["user", "turn", "text"]);
    const open = visibleLiteRows(rows, new Set([turn.key, run.key]));
    expect(open.map((r) => `${r.kind}:${r.depth}`)).toEqual(["user:0", "turn:0", "run:1", "call:2", "call:2", "text:0"]);
  });
});

describe("reuseStableRows", () => {
  test("a rebuild keeps every row that did not change, so memoized rows skip their render", () => {
    const msgs: Message[] = [person("go", 0), reply("Looking.", 1), ...tools(2, [call("Read", { file_path: "/a" })])];
    const first = visibleLiteRows(buildLiteRows(msgs, { active: true }), new Set());
    // The same messages rebuilt: the very same array back.
    expect(reuseStableRows(first, visibleLiteRows(buildLiteRows(msgs, { active: true }), new Set()))).toBe(first);
    // A new reply: the old rows keep their objects, the new one is new.
    const more = [...msgs, reply("Found it.", 9)];
    const next = reuseStableRows(first, visibleLiteRows(buildLiteRows(more, { active: true }), new Set()));
    expect(next).not.toBe(first);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next.some((r) => r.kind === "text" && r.content === "Found it.")).toBe(true);
  });
});

describe("the render gallery", () => {
  const gallery = renderGalleryMessages(1_790_000_000_000) as unknown as Message[];

  test("every row builds without throwing, idle and working, folded and open", () => {
    for (const active of [false, true]) {
      const rows = buildLiteRows(gallery, { agentType: "claude_code", active });
      expect(rows.length).toBeGreaterThan(0);
      const all = new Set<string>();
      const walk = (rs: LiteRow[]) => rs.forEach((r) => { all.add(r.key); if (r.kind === "turn") walk(r.children); if (r.kind === "run") r.steps.forEach((s) => all.add(`call:${s.call.id}`)); });
      walk(rows);
      const open = visibleLiteRows(rows, all);
      const keys = open.map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test("every tool call lands in a run or on a card, once", () => {
    const rows = buildLiteRows(gallery, { agentType: "claude_code", active: false });
    const seen: string[] = [];
    const walk = (rs: LiteRow[]) => rs.forEach((r) => {
      if (r.kind === "turn") walk(r.children);
      else if (r.kind === "run") r.steps.forEach((s) => seen.push(s.call.id));
      else if (r.kind === "card") seen.push(r.step.call.id);
    });
    walk(rows);
    const calls = gallery.filter((m) => m.role === "assistant" && m.subtype !== "workflow_event").flatMap((m) => (m.tool_calls ?? []).map((c) => c.id));
    expect(seen.sort()).toEqual([...calls].sort());
  });

  test("each kind a person reads maps to a row", () => {
    const timeline = gallery.map((m) => ({ type: "message" as const, data: m, timestamp: m.timestamp }));
    const userKinds = classifyUserRows(timeline, gallery, { agentType: "claude_code" });
    const rows = buildLiteRows(gallery, { agentType: "claude_code", active: false });
    const flat: LiteRow[] = [];
    const walk = (rs: LiteRow[]) => rs.forEach((r) => { flat.push(r); if (r.kind === "turn") walk(r.children); });
    walk(rows);
    const shownIds = new Set(flat.flatMap((r) => ("message" in r ? [r.message._id] : [])));
    for (const m of gallery) {
      const k = userKinds.get(m._id)?.kind;
      if (k === "normal" || k === "direct_user" || k === "decision_answer" || k === "session_message") expect(shownIds.has(m._id)).toBe(true);
    }
    const byKind = (kind: LiteRow["kind"]) => flat.filter((r) => r.kind === kind);
    expect(byKind("divider").map((r) => (r as Extract<LiteRow, { kind: "divider" }>).tone).sort()).toEqual(
      expect.arrayContaining(["agent_switch", "compaction", "machine_move"]),
    );
    // A finished turn's interrupt is its fold's label.
    expect(byKind("turn").some((r) => (r as Extract<LiteRow, { kind: "turn" }>).interrupted)).toBe(true);
    const cards = byKind("card").map((r) => (r as Extract<LiteRow, { kind: "card" }>).step.call.name);
    expect(cards).toEqual(expect.arrayContaining(["AskUserQuestion", "TodoWrite", "ExitPlanMode", "StructuredOutput"]));
    const cardCommands = byKind("card").map((r) => (r as Extract<LiteRow, { kind: "card" }>).step.call.input);
    expect(cardCommands.some((input) => input.includes("cast send"))).toBe(true);
    const runCalls = byKind("run").flatMap((r) => (r as Extract<LiteRow, { kind: "run" }>).steps.map((s) => s.call.name));
    expect(runCalls).toEqual(expect.arrayContaining(["Read", "Edit", "Grep", "Glob", "WebFetch"]));
    // Hidden: tool-result carriers, the poll's answer payload, workflow events.
    const carrier = gallery.find((m) => m.tool_results?.length)!;
    expect(shownIds.has(carrier._id)).toBe(false);
    expect(flat.some((r) => r.kind === "text" && r.message.subtype === "workflow_event")).toBe(false);
  });
});
