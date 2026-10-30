// Codecast Lite's transcript as rows: what a person reads of a session, and
// nothing else. Pure, so the thread (components/lite/thread/LiteThread) and
// its tests build the same rows from the same messages.
//
// Three levels of fold, after T3 Code's timeline:
//   (a) a FINISHED turn (a later prompt exists, or the agent is idle and it is
//       the last turn) folds into one "Worked for 2m 13s" row, everything but
//       its final reply and anything notable (an error, a card, a question);
//   (b) a run of routine tool calls is one line, a sentence from the shared
//       tool helpers ("Read 3 files and ran 2 commands");
//   (c) one call is one line that opens to its body.
//
// The person's words, another session's message and the agent's reply are
// rows of their own; every machine row the classic view also hides stays out
// (tool-result carriers, compaction prompts, noise, a poll's answer payload),
// and the few moments worth marking (an interrupt, an agent or machine
// switch, a compaction) are dividers.
import {
  CARD_TOOLS,
  describeToolGroup,
  foldToolRuns,
  isFoldableToolCall,
  summarizeToolGroup,
  toolResultHint,
  toolSummary,
  toolVisual,
  isShellTool,
  type ToolCallLike,
  type ToolIconName,
} from "@codecast/shared/render";
import { classifyApiErrorBanner, type DecisionAnswerMessage } from "@codecast/shared/contracts";
import { isAlwaysVisibleToolCall, isHiddenStubMessage, parseApiErrorContent, parseCastCommand, parseCommandInvocation, stripSystemTags } from "../../components/conversation/classify";
import { isToolResultCarrier } from "../../components/sessionMessage";
import type { ImageData, Message, TimelineItem, ToolCall, ToolResult, UserMessageKind } from "../../components/conversation/types";
import type { SentFileData } from "@codecast/shared/files";
import { classifyUserRows } from "../userRowKinds";
import { messageRowKey, uniqueRowKeys } from "../messageRowKey";

/** One tool call with what came back. */
export type LiteStep = {
  call: ToolCall;
  result?: ToolResult;
  /** Screenshots the call returned (images tied to it by tool_use_id). */
  images: ImageData[];
  /** Files it delivered (SendUserFile), tied the same way. */
  files: SentFileData[];
  /** The assistant message that made the call. */
  messageId: string;
  messageUuid?: string;
  ts: number;
  /** When its result landed (the carrier row's time), else the call's. */
  endTs: number;
};

export type LiteDividerTone = "interrupt" | "agent_switch" | "machine_move" | "compaction";

export type LiteRow =
  | {
      kind: "user";
      key: string;
      message: Message;
      body: string;
      /** A teammate (or a joint turn's authors) typed it, by name. */
      author?: string;
      decision?: DecisionAnswerMessage;
      images: ImageData[];
      ts: number;
    }
  | { kind: "session_message"; key: string; message: Message; from: string; name?: string; body: string; variant?: "agent"; ts: number }
  | { kind: "divider"; key: string; tone: LiteDividerTone; label: string; ts: number }
  | { kind: "text"; key: string; message: Message; content: string; error: boolean; ts: number }
  | { kind: "thinking"; key: string; content: string; ts: number }
  | { kind: "image"; key: string; image: ImageData; ts: number }
  | {
      kind: "run";
      key: string;
      steps: LiteStep[];
      /** The run as a sentence, or the one call's ("Read src/server.ts"). */
      label: string;
      /** The single call's subject in full, where the label clipped it (a command). */
      detail?: string;
      /** toolResultHint of the last call. */
      hint: string | null;
      icon: ToolIconName;
      error: boolean;
      ts: number;
      endTs: number;
    }
  | { kind: "call"; key: string; step: LiteStep; label: string; detail?: string; hint: string | null; icon: ToolIconName; error: boolean; ts: number }
  | { kind: "card"; key: string; step: LiteStep; ts: number }
  | {
      kind: "turn";
      key: string;
      /** What the fold holds, in order. */
      children: LiteRow[];
      durationMs: number;
      interrupted: boolean;
      ts: number;
    }
  | { kind: "working"; key: string; since: number; live: LiteStep | null; ts: number };

/** A row as the list draws it: its nesting under an open turn or run. */
export type LiteVisibleRow = LiteRow & { depth: number };

export type LiteRowsOptions = {
  agentType?: string;
  /** The agent is mid-turn: the last turn stays open and a working row ends the list. */
  active: boolean;
};

// The user-row kinds that are a person's (or a session's) words: each opens a turn.
const PROMPT_KINDS = new Set<UserMessageKind["kind"]>(["normal", "direct_user", "decision_answer", "command", "plan"]);

const sentenceCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "read 3 files · ran 2 commands" as a sentence: "Read 3 files and ran 2 commands". */
export function toolSentence(summary: string): string {
  const parts = summary.split(" · ").filter(Boolean);
  if (parts.length <= 1) return sentenceCase(summary);
  return sentenceCase(`${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);
}

/** "40s", "2m 13s", "1h 5m". */
export function formatWorkedFor(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The words a folded turn reads as. */
export function turnLabel(row: Extract<LiteRow, { kind: "turn" }>): string {
  return row.interrupted ? `You stopped after ${formatWorkedFor(row.durationMs)}` : `Worked for ${formatWorkedFor(row.durationMs)}`;
}

/** Calls that draw their own card in the thread rather than fold into a run:
 *  the shared CARD_TOOLS, every call the classic view never folds (a question,
 *  a plan, a Monitor, a Workflow, a sent file), every `cast` command (a
 *  `cast send` included) and any call that returned a screenshot. */
export function isCardCall(tc: ToolCall, result: ToolResult | undefined, hasImages: boolean): boolean {
  return hasImages || CARD_TOOLS.has(tc.name) || !isFoldableToolCall(tc) || isAlwaysVisibleToolCall(tc, result) || !!parseCastCommand(tc);
}

function oneCallLabel(tc: ToolCall): { label: string; detail?: string } {
  const label = toolSentence(summarizeToolGroup([tc as ToolCallLike]) || describeToolGroup(tc.name, 1));
  // A shell line names its program ("Ran npm test"); the command itself, in
  // full, rides beside it.
  const detail = isShellTool(tc.name) ? toolSummary(tc as ToolCallLike) : undefined;
  return { label, detail: detail && detail !== label ? detail : undefined };
}

function runRow(key: string, steps: LiteStep[], summary?: string): Extract<LiteRow, { kind: "run" }> {
  const last = steps[steps.length - 1];
  const error = steps.some((s) => s.result?.is_error);
  const one = steps.length === 1 ? oneCallLabel(last.call) : null;
  return {
    kind: "run",
    key,
    steps,
    label: one ? one.label : toolSentence(summary ?? summarizeToolGroup(steps.map((s) => s.call as ToolCallLike))),
    detail: one?.detail,
    hint: toolResultHint(last.call as ToolCallLike, last.result),
    icon: toolVisual(last.call.name).icon,
    error,
    ts: steps[0].ts,
    endTs: Math.max(...steps.map((s) => s.endTs)),
  };
}

/** A run's call as its own line (an open run, or a turn's fold). */
export function callRow(step: LiteStep): Extract<LiteRow, { kind: "call" }> {
  const { label, detail } = oneCallLabel(step.call);
  return {
    kind: "call",
    key: `call:${step.call.id}`,
    step,
    label,
    detail,
    hint: toolResultHint(step.call as ToolCallLike, step.result),
    icon: toolVisual(step.call.name).icon,
    error: !!step.result?.is_error,
    ts: step.ts,
  };
}

function isErrorText(text: string): boolean {
  return !!parseApiErrorContent(text) || !!classifyApiErrorBanner(text);
}

type Atom = LiteRow & { prompt?: boolean; endTs?: number };

/**
 * The thread's rows, oldest first, before any fold is opened. A finished
 * turn's fold holds its rows in `children`; visibleLiteRows lays out the open
 * ones. Keys are stable across the optimistic-to-synced handoff (messageRowKey)
 * and as a run grows (a run is keyed by its first message).
 */
export function buildLiteRows(messages: readonly Message[], opts: LiteRowsOptions): LiteRow[] {
  const list = messages as Message[];
  const timeline: TimelineItem[] = list.map((m) => ({ type: "message", data: m, timestamp: m.timestamp }));
  const kinds = classifyUserRows(timeline, list, { agentType: opts.agentType });

  // Results live on the next user-role row (the carrier); a screenshot names
  // its call by tool_use_id.
  const results = new Map<string, ToolResult>();
  const resultTs = new Map<string, number>();
  const toolImages = new Map<string, ImageData[]>();
  const toolFiles = new Map<string, SentFileData[]>();
  for (const m of list) {
    for (const f of m.files ?? []) {
      if (!f.tool_use_id) continue;
      const arr = toolFiles.get(f.tool_use_id);
      if (arr) arr.push(f);
      else toolFiles.set(f.tool_use_id, [f]);
    }
    for (const r of m.tool_results ?? []) {
      results.set(r.tool_use_id, r);
      resultTs.set(r.tool_use_id, m.timestamp);
    }
    for (const img of m.images ?? []) {
      if (!img.tool_use_id) continue;
      const arr = toolImages.get(img.tool_use_id);
      if (arr) arr.push(img);
      else toolImages.set(img.tool_use_id, [img]);
    }
  }
  const stepOf = (m: Message, tc: ToolCall): LiteStep => ({
    call: tc,
    result: results.get(tc.id),
    images: toolImages.get(tc.id) ?? [],
    files: toolFiles.get(tc.id) ?? [],
    messageId: m._id,
    messageUuid: m.message_uuid,
    ts: m.timestamp,
    endTs: resultTs.get(tc.id) ?? m.timestamp,
  });
  const isCard = (tc: ToolCall) => isCardCall(tc, results.get(tc.id), (toolImages.get(tc.id)?.length ?? 0) > 0);

  const userKind = (m: Message) => kinds.get(m._id);
  const shownUser = (k: UserMessageKind | undefined) =>
    !!k && (PROMPT_KINDS.has(k.kind) || k.kind === "session_message" || k.kind === "interrupt" || k.kind === "agent_switch" || k.kind === "machine_move");
  const hiddenAssistant = (m: Message) =>
    m.subtype === "workflow_event" || isHiddenStubMessage(m)
    || (!stripSystemTags(m.content ?? "").trim() && !m.thinking?.trim() && !(m.tool_calls?.length) && !(m.images?.length));
  // Rows that never draw never break a run.
  const skip = (m: Message) => {
    if (m.role === "user") return isToolResultCarrier(m) || !shownUser(userKind(m));
    if (m.role === "assistant") return hiddenAssistant(m);
    return !(m.role === "system" && m.subtype === "compact_boundary");
  };
  const runs = foldToolRuns(list, skip, (tc) => !isCard(tc as ToolCall));

  const atoms: Atom[] = [];
  let lastDivider: LiteDividerTone | null = null;
  const push = (a: Atom) => {
    if (a.kind === "divider") {
      // One move writes two notices; a run of the same divider reads as one.
      if (lastDivider === a.tone) return;
      lastDivider = a.tone;
    } else {
      lastDivider = null;
    }
    atoms.push(a);
  };

  for (const m of list) {
    if (skip(m)) continue;
    const key = messageRowKey(m);
    if (m.role === "system") {
      push({ kind: "divider", key, tone: "compaction", label: "Context compacted", ts: m.timestamp });
      continue;
    }
    if (m.role === "user") {
      const k = userKind(m)!;
      if (k.kind === "session_message") {
        push({ kind: "session_message", key, message: m, from: k.from, name: k.name, body: k.body, variant: k.variant, ts: m.timestamp, prompt: true });
      } else if (k.kind === "interrupt") {
        push({ kind: "divider", key, tone: "interrupt", label: "Interrupted", ts: m.timestamp });
      } else if (k.kind === "agent_switch") {
        push({ kind: "divider", key, tone: "agent_switch", label: `Switched to ${k.toLabel}`, ts: m.timestamp });
      } else if (k.kind === "machine_move") {
        push({ kind: "divider", key, tone: "machine_move", label: k.destination ? `Moved to ${k.destination}` : "Moved to another machine", ts: m.timestamp });
      } else {
        const images = (m.images ?? []).filter((img) => !img.tool_use_id);
        const body = k.kind === "direct_user" ? k.body
          : k.kind === "decision_answer" ? k.decision.answer
          : k.kind === "plan" ? k.planContent
          : k.kind === "command" ? (() => { const c = parseCommandInvocation(m.content ?? ""); return c.cmdName ? `/${c.cmdName}${c.args ? ` ${c.args}` : ""}` : stripSystemTags(m.content ?? "").trim(); })()
          : stripSystemTags(m.content ?? "").trim();
        push({
          kind: "user",
          key,
          message: m,
          body,
          author: k.kind === "direct_user" ? k.from : undefined,
          decision: k.kind === "decision_answer" ? k.decision : undefined,
          images,
          ts: m.timestamp,
          prompt: true,
        });
      }
      continue;
    }
    // Assistant.
    const run = runs.get(m._id);
    const text = stripSystemTags(m.content ?? "").trim();
    if (run && run.head !== m._id) continue; // its calls ride the run's row
    // A run's reasoning folds with it; a reply's stays above the reply.
    if (m.thinking?.trim() && (!run || text)) push({ kind: "thinking", key: `${key}:thinking`, content: m.thinking.trim(), ts: m.timestamp });
    if (text) push({ kind: "text", key, message: m, content: m.content ?? "", error: isErrorText(text), ts: m.timestamp });
    (m.images ?? []).forEach((img, n) => {
      if (!img.tool_use_id) push({ kind: "image", key: `${key}:img:${n}`, image: img, ts: m.timestamp });
    });
    if (run) {
      const members = new Set(run.members);
      const steps: LiteStep[] = [];
      for (const mm of list) {
        if (!members.has(mm._id)) continue;
        for (const tc of mm.tool_calls ?? []) steps.push(stepOf(mm, tc));
      }
      if (steps.length) push(runRow(`run:${run.head}`, steps, steps.length > 1 ? run.summary : undefined));
      continue;
    }
    // A message that mixes card calls and routine ones: each card is its own
    // row, and the routine calls between them group.
    let group: LiteStep[] = [];
    let groupN = 0;
    const flush = () => {
      if (!group.length) return;
      push(runRow(groupN === 0 ? `run:${m._id}` : `run:${m._id}:${groupN}`, group));
      groupN++;
      group = [];
    };
    for (const tc of m.tool_calls ?? []) {
      const step = stepOf(m, tc);
      if (isCard(tc)) {
        flush();
        push({ kind: "card", key: `card:${tc.id}`, step, ts: m.timestamp, endTs: step.endTs });
      } else {
        group.push(step);
      }
    }
    flush();
  }

  // Turns: a prompt and what the agent did after it.
  const turns: { prompt: Atom | null; body: Atom[] }[] = [];
  for (const a of atoms) {
    if (a.prompt || turns.length === 0) turns.push({ prompt: a.prompt ? a : null, body: a.prompt ? [] : [a] });
    else turns[turns.length - 1].body.push(a);
  }

  const out: LiteRow[] = [];
  turns.forEach((turn, i) => {
    if (turn.prompt) out.push(strip(turn.prompt));
    const finished = i < turns.length - 1 || !opts.active;
    if (!finished) {
      for (const a of turn.body) out.push(strip(a));
      return;
    }
    let finalText = -1;
    for (let j = turn.body.length - 1; j >= 0; j--) {
      if (turn.body[j].kind === "text") { finalText = j; break; }
    }
    const foldable = (a: Atom, j: number) =>
      (a.kind === "text" && j !== finalText && !a.error) || a.kind === "thinking" || (a.kind === "run" && !a.error);
    const folded = turn.body.filter(foldable);
    const interrupted = turn.body.some((a) => a.kind === "divider" && a.tone === "interrupt");
    if (folded.length === 0) {
      for (const a of turn.body) out.push(strip(a));
      return;
    }
    const start = turn.prompt?.ts ?? turn.body[0].ts;
    const end = Math.max(...turn.body.map((a) => a.endTs ?? a.ts), start);
    let placed = false;
    turn.body.forEach((a, j) => {
      if (foldable(a, j)) {
        if (!placed) {
          placed = true;
          out.push({
            kind: "turn",
            key: `turn:${turn.prompt?.key ?? a.key}`,
            children: folded.map(strip),
            durationMs: end - start,
            interrupted,
            ts: a.ts,
          });
        }
        return;
      }
      // The fold's label says the person stopped it.
      if (a.kind === "divider" && a.tone === "interrupt") return;
      out.push(strip(a));
    });
  });

  if (opts.active) {
    const lastPrompt = [...atoms].reverse().find((a) => a.prompt);
    let live: LiteStep | null = null;
    const lastTurn = turns[turns.length - 1];
    for (const a of lastTurn?.body ?? []) {
      if (a.kind === "run") { const s = a.steps[a.steps.length - 1]; live = s.result ? null : s; }
      else if (a.kind === "card") live = a.step.result ? null : a.step;
      else if (a.kind === "text") live = null;
    }
    const since = lastPrompt?.ts ?? atoms[atoms.length - 1]?.ts ?? 0;
    out.push({ kind: "working", key: "working", since, live, ts: since });
  }
  return out;
}

function strip(a: Atom): LiteRow {
  const { prompt: _p, endTs: _e, ...row } = a as Atom & { prompt?: boolean };
  // A run keeps its own endTs; every other row's was bookkeeping.
  return (a.kind === "run" ? { ...row, endTs: a.endTs } : row) as LiteRow;
}

/**
 * The rows the list draws: an open fold's rows follow it one level in, an
 * open run's calls follow it as their own lines. `open` holds row keys.
 * A single call opens in place (its body), so it adds no rows.
 */
export function visibleLiteRows(rows: readonly LiteRow[], open: ReadonlySet<string>): LiteVisibleRow[] {
  const out: LiteVisibleRow[] = [];
  const add = (row: LiteRow, depth: number) => {
    out.push({ ...row, depth });
    if (!open.has(row.key)) return;
    if (row.kind === "turn") for (const child of row.children) add(child, depth + 1);
    else if (row.kind === "run" && row.steps.length > 1) for (const step of row.steps) add(callRow(step), depth + 1);
  };
  for (const row of rows) add(row, 0);
  // A double-stamped client id must not share a list key (lib/messageRowKey).
  const keys = uniqueRowKeys(out.map((r) => r.key));
  return out.map((r, i) => (keys[i] === r.key ? r : { ...r, key: keys[i] }));
}

/** Whether a row opens: a fold, a run, a call with a body, a long thought. */
export function rowOpens(row: LiteRow): boolean {
  return row.kind === "turn" || row.kind === "run" || row.kind === "call" || row.kind === "thinking";
}

/** The list's first guess at a row's height, before it measures. */
export function estimateLiteRow(row: LiteVisibleRow | undefined, open: boolean): number {
  if (!row) return 40;
  switch (row.kind) {
    case "user": return 52 + Math.min(10, Math.ceil(row.body.length / 70)) * 20 + (row.images.length ? 110 : 0);
    case "session_message": return 96;
    case "text": return 24 + Math.min(40, Math.ceil(row.content.length / 90)) * 22;
    case "divider": return 36;
    case "image": return 140;
    case "card": return 120;
    case "working": return 36;
    case "thinking": return open ? 160 : 30;
    case "run":
    case "call":
    case "turn": return open && row.kind !== "turn" && !(row.kind === "run" && row.steps.length > 1) ? 260 : 30;
  }
}

/** The same row, drawn the same way: what the list may keep across a
 *  rebuild. Messages are identity-stable in the store, so a row that still
 *  holds the same message (and the same results) has nothing new to show. */
function sameRow(a: LiteVisibleRow, b: LiteVisibleRow): boolean {
  if (a.kind !== b.kind || a.key !== b.key || a.depth !== b.depth) return false;
  const sameSteps = (x: readonly LiteStep[], y: readonly LiteStep[]) =>
    x.length === y.length && x.every((s, i) => s.call === y[i].call && s.result === y[i].result && s.images.length === y[i].images.length);
  switch (a.kind) {
    case "user":
    case "session_message":
      return a.message === (b as typeof a).message;
    case "text":
      return a.message === (b as typeof a).message && a.content === (b as typeof a).content;
    case "thinking":
      return a.content === (b as typeof a).content;
    case "image":
      return a.image === (b as typeof a).image;
    case "divider":
      return a.label === (b as typeof a).label;
    case "run":
      return sameSteps(a.steps, (b as typeof a).steps);
    case "call":
    case "card":
      return sameSteps([a.step], [(b as typeof a).step]);
    case "turn": {
      const t = b as typeof a;
      return a.children.length === t.children.length && a.durationMs === t.durationMs && a.interrupted === t.interrupted;
    }
    case "working": {
      const w = b as typeof a;
      return a.since === w.since && a.live?.call === w.live?.call && a.live?.result === w.live?.result;
    }
  }
}

/** `next`, with each row that did not change swapped for its previous
 *  object, so a memoized row skips its render when a message streams in
 *  somewhere else. */
export function reuseStableRows(prev: readonly LiteVisibleRow[], next: LiteVisibleRow[]): LiteVisibleRow[] {
  if (prev.length === 0) return next;
  const byKey = new Map(prev.map((r) => [r.key, r]));
  let changed = prev.length !== next.length;
  const out = next.map((r, i) => {
    const old = byKey.get(r.key);
    const keep = old && sameRow(old, r) ? old : r;
    if (keep !== prev[i]) changed = true;
    return keep;
  });
  return changed ? out : (prev as LiteVisibleRow[]);
}
