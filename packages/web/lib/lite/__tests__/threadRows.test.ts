import { describe, expect, test } from "bun:test";
import { buildLiteRows, formatWorkedFor, reuseStableRows, toolSentence, turnLabel, visibleLiteRows, type LiteRow } from "../threadRows";
import { DELIVERY_FAILED_SUBTYPE, formatDeliveryFailedNotice } from "@codecast/shared/contracts/deliveryFailed";
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

  test("a send made mid-turn waits under the working row and leaves the live turn open", () => {
    const live = call("Bash", { command: "bun test" });
    const msgs: Message[] = [
      person("go", 0),
      reply("On it.", 1),
      ...tools(2, [call("Read", { file_path: "/a" })]),
      { _id: id(), role: "assistant", content: "", timestamp: at(4), tool_calls: [live] },
      person("also check b.ts", 30, { _isOptimistic: true }),
    ];
    const rows = buildLiteRows(msgs, { active: true });
    expect(kinds(rows)).toEqual(["user", "text", "run", "working", "user"]);
    const working = rows[3] as Extract<LiteRow, { kind: "working" }>;
    expect(working.since).toBe(msgs[0].timestamp);
    expect(working.live?.call.id).toBe(live.id);
    // Sent to an idle agent that has just woken, the send opens the turn it starts.
    const idle: Message[] = [person("go", 0), reply("Done.", 5), person("next", 30, { _isOptimistic: true })];
    const next = buildLiteRows(idle, { active: true });
    expect(kinds(next)).toEqual(["user", "text", "user", "working"]);
    expect((next[3] as Extract<LiteRow, { kind: "working" }>).since).toBe(idle[2].timestamp);
  });

  test("a wake opens its own turn: the person's turn ends at its own reply, and the quiet is not work", () => {
    const msgs: Message[] = [
      person("start the build", 0),
      ...tools(1, [call("Bash", { command: "bun run build" })]),
      reply("Started; I will report when done.", 30),
      person("<task-notification>\n<task-id>a6d86171</task-id>\n<status>completed</status>\n<summary>Build finished</summary>\n</task-notification>", 7200),
      reply("Build finished cleanly.", 7205),
    ];
    const rows = buildLiteRows(msgs, { active: false });
    expect(kinds(rows)).toEqual(["user", "turn", "text", "wake", "text"]);
    expect(turnLabel(rows[1] as Extract<LiteRow, { kind: "turn" }>)).toBe("Worked for 30s");
    expect((rows[2] as Extract<LiteRow, { kind: "text" }>).content).toBe("Started; I will report when done.");
    // A long quiet inside one turn counts only the work on either side of it.
    const gap: Message[] = [person("go", 0), ...tools(1, [call("Read", { file_path: "/a" })]), ...tools(3600, [call("Read", { file_path: "/b" })]), reply("Done.", 3610)];
    expect(turnLabel(buildLiteRows(gap, { active: false })[1] as Extract<LiteRow, { kind: "turn" }>)).toBe("Worked for 12s");
  });

  test("a scheduled run and a chat wake are rows that open turns", () => {
    const msgs: Message[] = [
      person("hi", 0),
      reply("Hello.", 1),
      person('<scheduled-task title="Nightly audit">Run the audit and post what changed.</scheduled-task>', 10_800),
      ...tools(10_801, [call("Read", { file_path: "/a" })]),
      reply("Audit posted.", 10_900),
    ];
    const rows = buildLiteRows(msgs, { active: false });
    expect(kinds(rows)).toEqual(["user", "text", "wake", "turn", "text"]);
    expect((rows[2] as Extract<LiteRow, { kind: "wake" }>).wake.kind).toBe("scheduled_task");
  });

  test("system rows the classic view draws stay, and a message never delivered never folds", () => {
    const msgs: Message[] = [
      person("go", 0),
      ...tools(1, [call("Read", { file_path: "/a" })]),
      { _id: id(), role: "system", subtype: DELIVERY_FAILED_SUBTYPE, content: formatDeliveryFailedNotice({ writes: 3, submitted: false, message: "also b" }), timestamp: at(3) },
      { _id: id(), role: "system", subtype: "informational", content: "Usage limit reached · continuing automatically at 2:20am", timestamp: at(4) },
      { _id: id(), role: "system", subtype: "commit", content: "fix the race", timestamp: at(5) },
      reply("Done.", 6),
    ];
    const rows = buildLiteRows(msgs, { active: false });
    expect(kinds(rows)).toEqual(["user", "turn", "system", "system", "text"]);
    const turn = rows[1] as Extract<LiteRow, { kind: "turn" }>;
    expect(kinds(turn.children)).toEqual(["run", "system"]);
    expect(rows.slice(2, 4).every((r) => r.kind === "system" && r.notable)).toBe(true);
  });

  test("a compaction's summary is a divider, never the turn's final reply; a workflow anchor without its subtype is a card", () => {
    const msgs: Message[] = [
      person("go", 0),
      ...tools(1, [call("Read", { file_path: "/a" })]),
      reply("Real final reply.", 3),
      person("Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests.", 10),
      reply("<summary>\nThe user asked for a fix.\n</summary>", 20),
      { _id: id(), role: "assistant", content: '{"__wf":"workflow_run","run_id":"r1"}', timestamp: at(30) },
    ];
    const rows = buildLiteRows(msgs, { active: false });
    expect(kinds(rows)).toEqual(["user", "turn", "text", "divider", "event"]);
    expect((rows[2] as Extract<LiteRow, { kind: "text" }>).content).toBe("Real final reply.");
    const divider = rows[3] as Extract<LiteRow, { kind: "divider" }>;
    expect(divider.body).toBe("The user asked for a fix.");
  });

  test("a subagent's opening brief is its parent's message, not the viewer's prompt", () => {
    const msgs: Message[] = [person("Audit the retry worker.", 0), reply("Found it.", 9)];
    const rows = buildLiteRows(msgs, { active: false, parentConversationId: "jx7parent0000000000000000000000" });
    expect(kinds(rows)).toEqual(["session_message", "text"]);
    // The card resolves the parent by its id, not the head of it the wire carries.
    expect((rows[0] as Extract<LiteRow, { kind: "session_message" }>).fromId).toBe("jx7parent0000000000000000000000");
  });

  test("another session's message names its sender; a person typing into the session is a named bubble", () => {
    const msgs: Message[] = [
      person('<session-message from="jx7c6zk" name="Maya Kim">\nDoes mobile pin the old client?\n</session-message>', 0),
      reply("Checking.", 3),
      person('<user-message from="Ann Lee">\nplease also bump it\n</user-message>', 10),
    ];
    const rows = buildLiteRows(msgs, { active: false });
    const inbound = rows.find((r) => r.kind === "session_message") as Extract<LiteRow, { kind: "session_message" }>;
    expect(inbound).toMatchObject({ from: "jx7c6zk", name: "Maya Kim", body: "Does mobile pin the old client?" });
    expect(inbound.fromId).toBeUndefined();
    const typed = rows.find((r) => r.kind === "user") as Extract<LiteRow, { kind: "user" }>;
    expect(typed).toMatchObject({ author: "Ann Lee", body: "please also bump it" });
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

  test("a live-tail push re-sends every row as fresh objects: rows compare by value and keep theirs", () => {
    const msgs: Message[] = [person("go", 0), reply("Looking.", 1), ...tools(2, [call("Read", { file_path: "/a" })]), ...tools(4, [call("Bash", { command: "ls" })])];
    const first = visibleLiteRows(buildLiteRows(msgs, { active: true }), new Set());
    expect(reuseStableRows(first, visibleLiteRows(buildLiteRows(structuredClone(msgs), { active: true }), new Set()))).toBe(first);
    const next = reuseStableRows(first, visibleLiteRows(buildLiteRows([...structuredClone(msgs), reply("Found it.", 9)], { active: true }), new Set()));
    expect(next.slice(0, 3)).toEqual(first.slice(0, 3));
    for (let i = 0; i < 3; i++) expect(next[i]).toBe(first[i]);
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
