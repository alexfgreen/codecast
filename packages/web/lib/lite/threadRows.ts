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
// rows of their own, and so is whatever woke the agent without them (a chat
// line, a schedule, a background task, a handoff, a brief): each opens a turn,
// so the work after it never reads as the person's. Every machine row the
// classic view also hides stays out (tool-result carriers, compaction prompts,
// noise, a poll's answer payload); the system rows it draws are the classic
// block itself (a message never delivered, a usage limit, a commit), and a
// workflow's anchor is its card. The few moments worth marking (an interrupt,
// an agent or machine switch, a compaction) are dividers.
//
// A send the server has not taken yet never ends the turn the agent is still
// in: it waits under the working row until it lands.
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
import { CLOUD_AGENT_ACTION_SUBTYPE, classifyApiErrorBanner, isRecoveryContinueClientId, type DecisionAnswerMessage } from "@codecast/shared/contracts";
import { DELIVERY_FAILED_SUBTYPE } from "@codecast/shared/contracts/deliveryFailed";
import {
  extractCompactionSummaryContent, isAlwaysVisibleToolCall, isHiddenStubMessage, parseApiErrorContent, parseCastCommand, parseCommandInvocation,
  parseTaskNotification, parseWorkflowEventContent, stripSystemTags,
} from "../../components/conversation/classify";
import { isToolResultCarrier } from "../../components/sessionMessage";
import type { ImageData, Message, TimelineItem, ToolCall, ToolResult, UserMessageKind } from "../../components/conversation/types";
import type { SentFileData } from "@codecast/shared/files";
import { classifyUserRows } from "../userRowKinds";
import { isHiddenSystemNotice, isLimitNoticeSuperseded, isWarningSystemNotice } from "../conversationProcessor";
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

export type LiteDividerTone = "interrupt" | "agent_switch" | "machine_move" | "compaction" | "continued";

/** The user-row kinds that wake the agent without the person's words. */
export type LiteWakeKind = Extract<UserMessageKind, {
  kind: "chat_wake" | "vault_ready" | "session_handoff" | "context_recovery" | "scheduled_task" | "role_brief" | "workflow_frame" | "task_notification";
}>;

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
  /** Another session's words (`cast send`), or a subagent's report
   *  (`variant: "agent"`). `from` is the wire's reference (a short id, or a
   *  subagent's name); `fromId` the sender's Convex id where the thread knows
   *  it (a subagent's opening brief is its parent's message). */
  | { kind: "session_message"; key: string; message: Message; from: string; fromId?: string; name?: string; body: string; variant?: "agent"; ts: number }
  /** `body`: what a compaction kept, behind the divider (it opens). */
  | { kind: "divider"; key: string; tone: LiteDividerTone; label: string; body?: string; ts: number }
  /** What woke the agent (a chat line, a schedule, a background task): the classic block. */
  | { kind: "wake"; key: string; message: Message; wake: LiteWakeKind; ts: number }
  /** A system row the classic view draws (SystemBlock); `notable` never folds. */
  | { kind: "system"; key: string; message: Message; notable: boolean; ts: number }
  /** A workflow's anchor (WorkflowEventBlock: its run, its gate). */
  | { kind: "event"; key: string; message: Message; ts: number }
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
  /** `blocked`: the agent waits on a permission, not on itself. */
  | { kind: "working"; key: string; since: number; live: LiteStep | null; blocked: boolean; ts: number };

/** A row as the list draws it: its nesting under an open turn or run. */
export type LiteVisibleRow = LiteRow & { depth: number };

export type LiteRowsOptions = {
  agentType?: string;
  /** The agent is mid-turn: the last turn stays open and a working row ends the list. */
  active: boolean;
  /** Mid-turn, but waiting on a permission prompt. */
  blocked?: boolean;
  /** A subagent's parent: its opening brief is the parent's message, not the viewer's. */
  parentConversationId?: string | null;
  /** Older messages exist above the loaded window (the brief may not be the first row). */
  hasMoreAbove?: boolean;
};

// The user-row kinds that are a person's (or a session's) words: each opens a turn.
const PROMPT_KINDS = new Set<UserMessageKind["kind"]>(["normal", "direct_user", "decision_answer", "command", "plan"]);
// What woke the agent without them (classify's FOLD_KEPT_USER_KINDS, less the
// prompts, and a background task's report): each opens a turn as well.
const WAKE_KINDS = new Set<UserMessageKind["kind"]>([
  "chat_wake", "vault_ready", "session_handoff", "context_recovery", "scheduled_task", "role_brief", "workflow_frame", "task_notification", "continuation",
]);
// System rows that wake the agent (a /loop wakeup, a trigger's prompt).
const WAKE_SUBTYPES = new Set(["scheduled_task_fire", "scheduled_task_prompt"]);
// User rows that sit between a compaction prompt and its summary.
const PASS_KINDS = new Set<UserMessageKind["kind"]>(["tool_results_only", "command", "bash_input", "bash_output"]);

/** A quiet this long inside a turn means the agent stopped and woke again. */
const WAKE_GAP_MS = 10 * 60_000;

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

/** Sent from here, and the server has not taken it yet. */
function isUnconfirmed(m: Message): boolean {
  const x = m as Message & { _isLocalQueue?: boolean; _serverPendingStatus?: string };
  return !!(x._isOptimistic || x._isQueued || x._isLocalQueue || (x._serverPendingStatus && x._serverPendingStatus !== "delivered"));
}
const isPendingPrompt = (a: Atom) => !!a.prompt && (a.kind === "user" || a.kind === "session_message") && isUnconfirmed(a.message);

/** How long a turn's agent was at work: its rows' spans and the gaps between
 *  them, less any quiet past WAKE_GAP_MS (it stopped, then woke again). */
function activeSpan(start: number, body: readonly Atom[]): number {
  // A run is its calls: a quiet between two of them is a quiet too.
  const spans = body.flatMap((a) => (a.kind === "run" ? a.steps.map((s) => [s.ts, s.endTs] as const) : [[a.ts, a.endTs ?? a.ts] as const]));
  let total = 0;
  let t = start;
  for (const [s, e] of spans) {
    if (s - t <= WAKE_GAP_MS) total += Math.max(0, s - t);
    total += Math.max(0, e - Math.max(t, s));
    t = Math.max(t, e);
  }
  return total;
}

/**
 * The thread's rows, oldest first, before any fold is opened. A finished
 * turn's fold holds its rows in `children`; visibleLiteRows lays out the open
 * ones. Keys are stable across the optimistic-to-synced handoff (messageRowKey)
 * and as a run grows (a run is keyed by its first message).
 */
export function buildLiteRows(messages: readonly Message[], opts: LiteRowsOptions): LiteRow[] {
  const list = messages as Message[];
  const timeline: TimelineItem[] = list.map((m) => ({ type: "message", data: m, timestamp: m.timestamp }));
  const kinds = classifyUserRows(timeline, list, { agentType: opts.agentType, parentConversationId: opts.parentConversationId, hasMoreAbove: opts.hasMoreAbove });

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
  const shownUser = (m: Message, k: UserMessageKind | undefined) =>
    !!k && (PROMPT_KINDS.has(k.kind) || k.kind === "session_message" || k.kind === "interrupt" || k.kind === "agent_switch" || k.kind === "machine_move"
      || (WAKE_KINDS.has(k.kind) && (k.kind !== "task_notification" || !!parseTaskNotification(m.content ?? ""))));
  // The row before `i` a reply answers to, past result carriers and a
  // command's echo (classic's getPreviousNonToolResultMessage).
  const previousOf = (i: number): Message | null => {
    for (let j = i - 1; j >= 0; j--) {
      const pm = list[j];
      if (pm.role === "user" && PASS_KINDS.has(userKind(pm)?.kind ?? "normal")) continue;
      return pm;
    }
    return null;
  };
  const isRecoveryContinue = (m: Message | undefined) =>
    !!m && m.role === "user" && (isRecoveryContinueClientId(m.client_id) || !!(m as Message & { _recoveryContinue?: boolean })._recoveryContinue);
  // A compaction's summary is the agent's reply to the compaction prompt: a
  // divider holds it, never the turn's final reply.
  const summaries = new Map<string, string>();
  // A workflow run's anchor draws once (classic's wfRunCardOwner).
  const events = new Set<string>();
  const runAnchors = new Set<string>();
  // The system rows the classic view draws; the rest (context notices, a
  // limit notice the park card or a recovery already says) stay out.
  const systemShown = new Set<string>();
  list.forEach((m, i) => {
    if (m.role === "assistant") {
      const wf = parseWorkflowEventContent(m.content);
      if (m.subtype === "workflow_event" || wf) {
        const runId = wf?.__wf === "workflow_run" ? (wf.run_id as string | undefined) : undefined;
        if (!runId || !runAnchors.has(runId)) events.add(m._id);
        if (runId) runAnchors.add(runId);
        return;
      }
      const prev = previousOf(i);
      if (prev?.role === "user" && userKind(prev)?.kind === "compaction_prompt") summaries.set(m._id, extractCompactionSummaryContent(m.content ?? ""));
    } else if (m.role === "system" && m.subtype !== "compact_boundary") {
      const content = m.content ?? "";
      if (!content.trim() || isHiddenSystemNotice(content, m.subtype)) return;
      if (isLimitNoticeSuperseded(content, m.subtype, previousOf(i), isRecoveryContinue(list[i + 1]))) return;
      systemShown.add(m._id);
    }
  });
  const hiddenAssistant = (m: Message) =>
    events.has(m._id) ? false
    : m.subtype === "workflow_event" || parseWorkflowEventContent(m.content) !== null || summaries.get(m._id) === "" || isHiddenStubMessage(m)
    || (!stripSystemTags(m.content ?? "").trim() && !m.thinking?.trim() && !(m.tool_calls?.length) && !(m.images?.length));
  // Rows that never draw never break a run.
  const skip = (m: Message) => {
    if (m.role === "user") return isToolResultCarrier(m) || !shownUser(m, userKind(m));
    if (m.role === "assistant") return hiddenAssistant(m);
    return !(m.role === "system" && (m.subtype === "compact_boundary" || systemShown.has(m._id)));
  };
  const runs = foldToolRuns(list, skip, (tc) => !isCard(tc as ToolCall));
  const byId = new Map(list.map((m) => [m._id, m] as const));

  const atoms: Atom[] = [];
  let lastDivider: LiteDividerTone | null = null;
  const push = (a: Atom) => {
    if (a.kind === "divider") {
      // One move writes two notices; a run of the same divider reads as one
      // (a compaction's boundary and its summary are one divider).
      if (lastDivider === a.tone) {
        const held = atoms[atoms.length - 1];
        if (a.body && held?.kind === "divider" && !held.body) held.body = a.body;
        return;
      }
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
      if (m.subtype === "compact_boundary") {
        push({ kind: "divider", key, tone: "compaction", label: "Context compacted", ts: m.timestamp });
      } else {
        const notable = m.subtype === DELIVERY_FAILED_SUBTYPE || m.subtype === CLOUD_AGENT_ACTION_SUBTYPE || m.subtype === "plan" || isWarningSystemNotice(m.content, m.subtype);
        push({ kind: "system", key, message: m, notable, ts: m.timestamp, prompt: WAKE_SUBTYPES.has(m.subtype ?? "") });
      }
      continue;
    }
    if (m.role === "user") {
      const k = userKind(m)!;
      if (k.kind === "continuation") {
        push({ kind: "divider", key, tone: "continued", label: "Session continued", ts: m.timestamp, prompt: true });
      } else if (WAKE_KINDS.has(k.kind)) {
        push({ kind: "wake", key, message: m, wake: k as LiteWakeKind, ts: m.timestamp, prompt: true });
      } else if (k.kind === "session_message") {
        // A subagent's brief names its parent by the head of its id (userRowKinds).
        const parent = opts.parentConversationId;
        const fromId = parent && k.from === parent.slice(0, 7) ? parent : undefined;
        push({ kind: "session_message", key, message: m, from: k.from, fromId, name: k.name, body: k.body, variant: k.variant, ts: m.timestamp, prompt: true });
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
    if (events.has(m._id)) {
      push({ kind: "event", key, message: m, ts: m.timestamp });
      continue;
    }
    const summary = summaries.get(m._id);
    if (summary) {
      push({ kind: "divider", key, tone: "compaction", label: "Context compacted", body: summary, ts: m.timestamp });
      continue;
    }
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
      // run.members is in message order.
      const steps: LiteStep[] = [];
      for (const mid of run.members) {
        const mm = byId.get(mid);
        for (const tc of mm?.tool_calls ?? []) steps.push(stepOf(mm!, tc));
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

  // A send the server has not taken yet, made while the agent is still in a
  // turn (its last row is work, not a reply), waits under the working row:
  // the turn it interrupts stays open, and the agent's next calls for it land
  // in it, not in a fold. Sent to an idle agent, it opens the turn it starts.
  let stream: Atom[] = atoms;
  let waiting: Atom[] = [];
  if (opts.active && atoms.some(isPendingPrompt)) {
    const confirmed = atoms.filter((a) => !isPendingPrompt(a));
    let at = confirmed.length - 1;
    while (at >= 0 && !confirmed[at].prompt) at--;
    const last = confirmed[confirmed.length - 1];
    if (at < confirmed.length - 1 && last && (last.kind === "run" || last.kind === "card" || last.kind === "thinking" || last.kind === "image")) {
      stream = confirmed;
      waiting = atoms.filter(isPendingPrompt);
    }
  }

  // Turns: a prompt and what the agent did after it.
  const turns: { prompt: Atom | null; body: Atom[] }[] = [];
  for (const a of stream) {
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
      (a.kind === "text" && j !== finalText && !a.error) || a.kind === "thinking" || (a.kind === "run" && !a.error) || (a.kind === "system" && !a.notable);
    const folded = turn.body.filter(foldable);
    const interrupted = turn.body.some((a) => a.kind === "divider" && a.tone === "interrupt");
    if (folded.length === 0) {
      for (const a of turn.body) out.push(strip(a));
      return;
    }
    const start = turn.prompt?.ts ?? turn.body[0].ts;
    let placed = false;
    turn.body.forEach((a, j) => {
      if (foldable(a, j)) {
        if (!placed) {
          placed = true;
          out.push({
            kind: "turn",
            key: `turn:${turn.prompt?.key ?? a.key}`,
            children: folded.map(strip),
            durationMs: activeSpan(start, turn.body),
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
    const lastPrompt = [...stream].reverse().find((a) => a.prompt);
    let live: LiteStep | null = null;
    const lastTurn = turns[turns.length - 1];
    for (const a of lastTurn?.body ?? []) {
      if (a.kind === "run") { const s = a.steps[a.steps.length - 1]; live = s.result ? null : s; }
      else if (a.kind === "card") live = a.step.result ? null : a.step;
      else if (a.kind === "text") live = null;
    }
    // The turn's start, or, when the agent woke again after a long quiet in
    // the same turn (a wake, a scheduled run), when it woke.
    let since = lastPrompt?.ts ?? stream[stream.length - 1]?.ts ?? 0;
    let prev = since;
    for (const a of lastTurn?.body ?? []) {
      if (a.ts - prev > WAKE_GAP_MS) since = a.ts;
      prev = Math.max(prev, a.endTs ?? a.ts);
    }
    out.push({ kind: "working", key: "working", since, live, blocked: !!opts.blocked, ts: since });
    for (const a of waiting) out.push(strip(a));
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

/** Whether a row opens: a fold, a run, a call with a body, a long thought,
 *  a compaction's summary. */
export function rowOpens(row: LiteRow): boolean {
  return row.kind === "turn" || row.kind === "run" || row.kind === "call" || row.kind === "thinking" || (row.kind === "divider" && !!row.body);
}

/** The list's first guess at a row's height, before it measures. */
export function estimateLiteRow(row: LiteVisibleRow | undefined, open: boolean): number {
  if (!row) return 40;
  switch (row.kind) {
    case "user": return 72 + Math.min(10, Math.ceil(row.body.length / 70)) * 20 + (row.images.length ? 110 : 0);
    case "session_message": return 96;
    case "text": return 44 + Math.min(40, Math.ceil(row.content.length / 90)) * 22;
    case "divider": return open ? 240 : 36;
    case "wake": return 56;
    case "system": return 44;
    case "event": return 96;
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
 *  rebuild. Compared by value: a live-tail push re-sends every row after its
 *  anchor as fresh objects, so identity would rebuild every row on each push.
 *  Keeping the old row keeps its old message and step objects too, so a
 *  memoized body (an input parse, a diff) holds. */
function sameMessage(x: Message, y: Message): boolean {
  return x._id === y._id && x.content === y.content && x._isOptimistic === y._isOptimistic && x._isQueued === y._isQueued
    && x.from_user_id === y.from_user_id && x.subtype === y.subtype && (x.images?.length ?? 0) === (y.images?.length ?? 0)
    && (x as { _serverPendingStatus?: string })._serverPendingStatus === (y as { _serverPendingStatus?: string })._serverPendingStatus;
}
function sameStep(x: LiteStep, y: LiteStep): boolean {
  return x.call.id === y.call.id && x.call.input === y.call.input && x.result?.content === y.result?.content
    && x.result?.is_error === y.result?.is_error && x.images.length === y.images.length && x.files.length === y.files.length
    && x.endTs === y.endTs;
}
function sameRow(a: LiteVisibleRow, b: LiteVisibleRow): boolean {
  if (a.kind !== b.kind || a.key !== b.key || a.depth !== b.depth) return false;
  switch (a.kind) {
    case "user": {
      const u = b as typeof a;
      return sameMessage(a.message, u.message) && a.body === u.body && a.author === u.author && a.decision?.question === u.decision?.question;
    }
    case "session_message":
      return sameMessage(a.message, (b as typeof a).message) && a.body === (b as typeof a).body && a.fromId === (b as typeof a).fromId;
    case "text":
      return sameMessage(a.message, (b as typeof a).message) && a.content === (b as typeof a).content && a.error === (b as typeof a).error;
    case "wake":
    case "system":
    case "event":
      return sameMessage(a.message, (b as typeof a).message) && (a.kind !== "system" || a.notable === (b as typeof a).notable);
    case "thinking":
      return a.content === (b as typeof a).content;
    case "image": {
      const i = (b as typeof a).image;
      return a.image === i || (a.image.storage_id === i.storage_id && a.image.preview_url === i.preview_url && a.image.data?.length === i.data?.length);
    }
    case "divider":
      return a.label === (b as typeof a).label && a.tone === (b as typeof a).tone && a.body === (b as typeof a).body;
    case "run": {
      const r = b as typeof a;
      return a.steps.length === r.steps.length && a.steps.every((s, i) => sameStep(s, r.steps[i])) && a.label === r.label;
    }
    case "call":
    case "card":
      return sameStep(a.step, (b as typeof a).step);
    case "turn": {
      const t = b as typeof a;
      return a.children.length === t.children.length && a.durationMs === t.durationMs && a.interrupted === t.interrupted;
    }
    case "working": {
      const w = b as typeof a;
      return a.since === w.since && a.blocked === w.blocked && a.live?.call.id === w.live?.call.id && a.live?.result?.content === w.live?.result?.content;
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
