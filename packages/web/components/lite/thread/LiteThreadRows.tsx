// One row of Codecast Lite's thread, as lib/lite/threadRows builds it. A
// person's words are a bubble on the right; the agent's are plain prose; work
// is one quiet line (a finished turn's fold, a run of calls, one call) that
// opens in place; a card tool is the classic card itself, and so is what woke
// the agent, a system notice and a workflow's anchor. The classic blocks are
// reused, never forked: MessageMarkdown, DiffView, ToolBlock, the question,
// plan, todo and `cast` cards, the session-message card, SystemBlock.
import { memo, useCallback, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen, Brain, ChevronRight, CircleHelp, Copy, FileCode, GitFork, Globe, ListTodo, MessageSquare, Monitor, Move,
  Pencil, Plug, Search, Settings, SquareCheck, Terminal, Upload, Users, Zap, ArrowUpRight,
} from "lucide-react";
import type { Id } from "@codecast/convex/convex/_generated/dataModel";
import {
  activityLine, isAgentTool, isAskTool, isEditTool, isPlanModeTool, isShellTool, isTodoTool, isWriteTool, toolPathFromInput,
  type ToolIconName,
} from "@codecast/shared/render";
import { parseJointMessage } from "@codecast/shared/contracts/jointMessage";
import { useInboxStore } from "../../../store/inboxStore";
import { useCoarseNow } from "../../../hooks/useCoarseNow";
import { useWorkflowRun } from "../../../hooks/useSyncWorkflows";
import { useLiteLayout } from "../../../lib/lite/liteLayout";
import { formatWorkedFor, turnLabel, type LiteStep, type LiteVisibleRow } from "../../../lib/lite/threadRows";
import { liteSessionPath } from "../../../lib/inboxRouting";
import { copyToClipboard } from "../../../lib/utils";
import { getToolPatchInputs, parseApplyPatchSections } from "../../../lib/applyPatchParser";
import { sendToSession } from "../../../lib/sendToSession";
import { MessageMarkdown } from "../../conversation/markdown";
import { parseCastCommand, stripSystemTags } from "../../conversation/classify";
import { DiffView } from "../../DiffView";
import { SentFileBlock } from "../../tools/SentFileBlock";
import { isBackgroundBashToolCall } from "../../monitorRows";
import { AskUserQuestionBlock, ImageBlock, MonitorBlock, PlanModeBlock } from "../../conversation/blocks/interactiveBlocks";
import {
  SendMessageBlock, SkillBlock, StructuredResultBlock, TaskCreateUpdateBlock, TaskListBlock, TaskToolBlock, TeamCreateBlock, TodoWriteBlock,
  ToolBlock, WorkflowToolBlock,
} from "../../conversation/blocks/toolBlocks";
import {
  ChatWakeBlock, ContextRecoveryDivider, FoldedPromptBlock, ScheduleWakeupBlock, SessionMessageBlock, SystemBlock, TaskNotificationLine,
  WorkflowEventBlock, WorkflowTaskBlock,
} from "../../conversation/blocks/systemBlocks";
import { ScheduledTaskBlock } from "../../conversation/blocks/triggerRunBlock";
import { VaultReadyLine } from "../../conversation/blocks/VaultRequestCard";
import { SessionHandoffCard } from "../../conversation/SessionHandoff";
import { CastCommandBlock } from "../../conversation/blocks/castBlocks";

const ICONS: Record<ToolIconName, typeof Terminal> = {
  terminal: Terminal,
  "file-code-o": FileCode,
  search: Search,
  pencil: Pencil,
  globe: Globe,
  "code-fork": GitFork,
  tasks: ListTodo,
  comment: MessageSquare,
  "check-square-o": SquareCheck,
  bolt: Zap,
  "map-o": BookOpen,
  "question-circle-o": CircleHelp,
  users: Users,
  book: BookOpen,
  chrome: Globe,
  desktop: Monitor,
  upload: Upload,
  "arrows-alt": Move,
  plug: Plug,
  cog: Settings,
};

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
// A depth's indent, as padding on top of the row's own 16px gutter: never a
// transform (rows hold still).
const indent = (depth: number) => (depth > 0 ? { paddingLeft: 16 + depth * 20 } : undefined);

export type LiteRowProps = {
  row: LiteVisibleRow;
  open: boolean;
  onToggle: (key: string) => void;
  sessionId: string;
  /** The viewer may answer a question or a plan in this session. */
  canSend: boolean;
  meId: string | null;
  /** The viewer owns the session; otherwise its owner, by id and by name. */
  isOwner: boolean;
  ownerId: string | null;
  ownerName: string | null;
};

export const LiteRowView = memo(function LiteRowView(props: LiteRowProps) {
  const { row } = props;
  switch (row.kind) {
    case "user": return <UserRow {...props} row={row} />;
    case "session_message":
      return (
        <div className="lt-th-row lt-th-gap">
          <SessionMessageBlock variant={row.variant === "agent" ? "agent" : "session"} from={row.from} name={row.name} body={row.body} timestamp={row.ts} />
        </div>
      );
    case "text":
      return (
        <div className="lt-th-row lt-th-gap" style={indent(row.depth)}>
          <div className="lt-th-text" data-error={row.error ? "" : undefined}>
            <MessageMarkdown content={row.content} />
          </div>
          <Meta ts={row.ts} text={row.content} />
        </div>
      );
    case "image":
      return <div className="lt-th-row lt-th-gap" style={indent(row.depth)}><ImageBlock image={row.image} /></div>;
    case "divider":
      // A compaction's divider opens onto what it kept.
      if (row.body) {
        return (
          <div className="lt-th-row lt-th-gap">
            <button type="button" className="lt-th-divider" data-tone={row.tone} aria-expanded={props.open} onClick={() => props.onToggle(row.key)}>
              {row.label}
            </button>
            {props.open && <div className="lt-th-summary"><MessageMarkdown content={row.body} /></div>}
          </div>
        );
      }
      return <div className="lt-th-row lt-th-gap"><div className="lt-th-divider" data-tone={row.tone} role="separator">{row.label}</div></div>;
    case "wake":
      return <div className="lt-th-row lt-th-gap"><div className="lt-th-card"><WakeBlock row={row} /></div></div>;
    case "system":
      return (
        <div className="lt-th-row lt-th-gap" style={indent(row.depth)}>
          <div className="lt-th-card">
            <SystemBlock
              content={row.message.content || ""}
              subtype={row.message.subtype}
              timestamp={row.message.timestamp}
              messageUuid={row.message.message_uuid}
              messageId={row.message._id}
              conversationId={props.sessionId as Id<"conversations">}
            />
          </div>
        </div>
      );
    case "event":
      return (
        <div className="lt-th-row lt-th-gap">
          <div className="lt-th-card"><WorkflowEventRow content={row.message.content || ""} sessionId={props.sessionId} canSend={props.canSend} /></div>
        </div>
      );
    case "thinking":
      return (
        <div className="lt-th-row lt-th-tight" style={indent(row.depth)}>
          <Line icon={<Brain aria-hidden />} label="Thought" ts={row.ts} open={props.open} onToggle={() => props.onToggle(row.key)} />
          {props.open && <div className="lt-th-thought">{row.content}</div>}
        </div>
      );
    case "turn":
      return (
        <div className="lt-th-row lt-th-tight" style={indent(row.depth)}>
          <Line label={turnLabel(row)} ts={row.ts} open={props.open} onToggle={() => props.onToggle(row.key)} />
        </div>
      );
    case "run":
    case "call": {
      const Icon = ICONS[row.icon] ?? Settings;
      const single = row.kind === "call" || row.steps.length === 1;
      const step = row.kind === "call" ? row.step : row.steps[0];
      return (
        <div className="lt-th-row lt-th-tight" style={indent(row.depth)}>
          <Line
            icon={<Icon aria-hidden />}
            label={row.label}
            detail={row.detail}
            hint={row.hint}
            error={row.error}
            ts={row.ts}
            open={props.open}
            onToggle={() => props.onToggle(row.key)}
          />
          {single && props.open && <CallBody step={step} sessionId={props.sessionId} />}
        </div>
      );
    }
    case "card":
      return (
        <div className="lt-th-row lt-th-gap" style={indent(row.depth)}>
          <div className="lt-th-card"><CardTool step={row.step} sessionId={props.sessionId} canSend={props.canSend} /></div>
        </div>
      );
    case "working":
      return (
        <div className="lt-th-row lt-th-gap">
          {row.blocked
            ? <WaitingRow owner={props.isOwner ? null : props.ownerName} />
            : <WorkingRow since={row.since} live={row.live} />}
        </div>
      );
  }
});

/** One quiet line that opens: icon, words, how it came out, the time on hover. */
function Line({ icon, label, detail, hint, error, ts, open, onToggle }: {
  icon?: ReactNode;
  label: string;
  detail?: string;
  hint?: string | null;
  error?: boolean;
  ts: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="lt-th-line" aria-expanded={open} data-error={error ? "" : undefined} onClick={onToggle}>
      <ChevronRight className="lt-th-chev" aria-hidden />
      {icon}
      <span className="lt-th-label">{label}</span>
      {detail && <span className="lt-th-detail">{detail}</span>}
      {hint && <span className="lt-th-hint">{hint}</span>}
      <span className="lt-th-time">{clock(ts)}</span>
    </button>
  );
}

const LONG_PROMPT = 600;

function UserRow({ row, open, onToggle, meId, isOwner, ownerId, ownerName }: LiteRowProps & { row: Extract<LiteVisibleRow, { kind: "user" }> }) {
  // Who typed it, as the classic view reads it: the row's sender, else the
  // viewer for a send still on its way, else the session's owner (a prompt
  // typed at the terminal carries no sender).
  const fromUserId = row.message.from_user_id ? String(row.message.from_user_id) : null;
  const sentHere = !!(row.message._isOptimistic || row.message._isQueued);
  const sender = fromUserId ?? (sentHere ? meId : ownerId);
  // A teammate's name off the roster: a string, so the roster changing
  // elsewhere re-renders nothing here.
  const typedBy = useInboxStore((s) => {
    if (!sender || sender === meId || sender === ownerId) return null;
    const member = (s.teamMembers as Array<{ _id?: string; name?: string }> | undefined)?.find((m) => String(m?._id) === sender);
    return member?.name ?? null;
  });
  // In someone else's session every bubble is named, the viewer's as "You".
  const named = !sender ? null : sender === meId ? (isOwner ? null : "You") : sender === ownerId ? ownerName : typedBy;
  const author = row.author ?? named ?? undefined;
  const joint = useMemo(() => parseJointMessage(row.body), [row.body]);
  const long = row.body.length > LONG_PROMPT || row.body.split("\n").length > 8;
  const pending = !!row.message._isOptimistic;
  return (
    <div className="lt-th-row" style={{ paddingTop: 14, paddingBottom: 2 }}>
      <div className="lt-th-user">
        {author && !joint && <span className="lt-th-author">{author}</span>}
        {row.images.length > 0 && (
          <div className="lt-th-images">
            {row.images.map((img, i) => <ImageBlock key={img.storage_id ?? img.preview_url ?? i} image={img} />)}
          </div>
        )}
        {row.body && (
          <div className="lt-th-bubble" data-pending={pending ? "" : undefined}>
            {row.decision?.question && <div className="lt-th-quote">{row.decision.question}</div>}
            <div className="lt-th-bubble-body" data-clamped={long && !open ? "" : undefined}>
              {joint ? joint.map((part, i) => (
                <div key={i} className="lt-th-joint">
                  <div className="lt-th-joint-name">{part.from || "Someone"}</div>
                  <MessageMarkdown content={part.body} userText />
                </div>
              )) : <MessageMarkdown content={row.body} userText />}
            </div>
            {long && (
              <button type="button" className="lt-th-more" onClick={() => onToggle(row.key)}>
                {open ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}
        {row.message._isQueued && <span className="lt-th-author">Queued</span>}
        {row.body && <Meta ts={row.ts} text={row.body} />}
      </div>
    </div>
  );
}

/** Under a bubble or a reply: its time and a copy, shown on hover (always on
 *  a touch screen). No animation beyond the fade, so the row holds still. */
function Meta({ ts, text }: { ts: number; text: string }) {
  const copy = () => {
    void copyToClipboard(text)
      .then(() => toast.success("Copied"))
      .catch(() => toast.error("Could not copy"));
  };
  return (
    <div className="lt-th-meta">
      <time dateTime={new Date(ts).toISOString()}>{clock(ts)}</time>
      <button type="button" className="lt-th-meta-btn" aria-label="Copy" title="Copy" onClick={copy}>
        <Copy aria-hidden />
      </button>
    </div>
  );
}

/** What woke the agent, as the classic view draws it. */
function WakeBlock({ row }: { row: Extract<LiteVisibleRow, { kind: "wake" }> }) {
  const { message: m, wake: k } = row;
  switch (k.kind) {
    case "chat_wake": return <ChatWakeBlock wake={k.wake} timestamp={m.timestamp} />;
    case "scheduled_task": return <ScheduledTaskBlock content={m.content ?? ""} timestamp={m.timestamp} />;
    case "task_notification": return <TaskNotificationLine content={m.content ?? ""} timestamp={m.timestamp} />;
    case "context_recovery": return <ContextRecoveryDivider recovery={k.recovery} timestamp={m.timestamp} />;
    case "vault_ready": return <VaultReadyLine vault={k.vault} timestamp={m.timestamp} />;
    case "session_handoff": return <HandoffBlock handoff={k.handoff} timestamp={m.timestamp} />;
    case "workflow_frame":
      // The launching session's ask is context, folded; the computed task is
      // this agent's brief from the workflow script.
      return k.frame === "user request"
        ? <FoldedPromptBlock label="Request" preview={k.body.split("\n")[0]} content={k.body} timestamp={m.timestamp} />
        : <WorkflowTaskBlock body={k.body} timestamp={m.timestamp} />;
    case "role_brief": {
      const body = stripSystemTags(m.content ?? "").trim();
      return <FoldedPromptBlock label="Role brief" preview={body.split("\n")[0].replace(/\*\*/g, "")} content={body} timestamp={m.timestamp} />;
    }
  }
}

/** A handoff's card; its source opens in Lite (the compat router maps the
 *  classic address). */
function HandoffBlock({ handoff, timestamp }: { handoff: Extract<Extract<LiteVisibleRow, { kind: "wake" }>["wake"], { kind: "session_handoff" }>["handoff"]; timestamp: number }) {
  const router = useRouter();
  const go = useCallback((id: string) => router.push(`/conversation/${id}`), [router]);
  return <SessionHandoffCard handoff={handoff} timestamp={timestamp} convLink={liteSessionPath} navigateToSession={go} />;
}

/** A workflow's anchor: its run, and the gate answered from here. */
function WorkflowEventRow({ content, sessionId, canSend }: { content: string; sessionId: string; canSend: boolean }) {
  const runId = useInboxStore((s) => (s.conversations[sessionId] as { workflow_run_id?: string } | undefined)?.workflow_run_id ?? null);
  const run = useWorkflowRun(runId);
  const respondToGate = useInboxStore((s) => s.respondToGate);
  const onGateChoice = useCallback((key: string) => {
    if (run?._id && key.trim()) respondToGate(run._id, key.trim());
  }, [run?._id, respondToGate]);
  return <WorkflowEventBlock content={content} workflowRun={run} onGateChoice={canSend ? onGateChoice : undefined} />;
}

function parseInput(step: LiteStep): Record<string, any> {
  try {
    const v = JSON.parse(step.call.input || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const OUTPUT_CAP = 20_000;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** An open call: an edit's diff (with the way into the changes panel), a
 *  command's output, or the classic tool block for anything else. */
function CallBody({ step, sessionId }: { step: LiteStep; sessionId: string }) {
  const { openRightPanel } = useLiteLayout();
  const { call, result } = step;
  const input = useMemo(() => parseInput(step), [step]);

  const openInChanges = (file: string) => (
    <div className="lt-th-body-head">
      <button type="button" className="lt-btn" onClick={() => openRightPanel("changes", { file })}>
        Open in changes
        <ArrowUpRight aria-hidden />
      </button>
    </div>
  );

  // An apply_patch, or a command that carried one (a heredoc): the patch as a diff.
  const patches = getToolPatchInputs(call);
  if (patches.length > 0) {
    const sections = patches.flatMap(parseApplyPatchSections);
    if (sections.length > 0) {
      return (
        <div className="lt-th-body">
          {openInChanges(sections[0].filePath)}
          {sections.map((s, i) => (
            <div key={`${s.filePath}-${i}`} className={i > 0 ? "mt-2" : undefined}>
              <DiffView hunks={s.hunks} fileName={s.filePath} showLineNumbers />
            </div>
          ))}
        </div>
      );
    }
  }
  if (isEditTool(call.name) || isWriteTool(call.name)) {
    const file = toolPathFromInput(input);
    const edits: Array<{ old_string?: string; new_string?: string }> = Array.isArray(input.edits)
      ? input.edits
      : [{ old_string: isWriteTool(call.name) ? "" : input.old_string, new_string: isWriteTool(call.name) ? input.content : input.new_string }];
    return (
      <div className="lt-th-body">
        {file && openInChanges(file)}
        {result?.is_error && <pre className="lt-th-pre mb-2" data-error="">{result.content}</pre>}
        {edits.map((e, i) => (
          <div key={i} className={i > 0 ? "mt-2" : undefined}>
            <DiffView oldStr={String(e.old_string ?? "")} newStr={String(e.new_string ?? "")} fileName={file || undefined} showLineNumbers />
          </div>
        ))}
      </div>
    );
  }
  if (isShellTool(call.name)) {
    const command = String(input.command ?? input.cmd ?? "");
    const out = (result?.content ?? "").replace(ANSI, "");
    return (
      <div className="lt-th-body">
        {command && <div className="lt-th-cmd">$ {command}</div>}
        {result ? (
          <pre className="lt-th-pre" data-error={result.is_error ? "" : undefined}>
            {out.length > OUTPUT_CAP ? `${out.slice(0, OUTPUT_CAP)}\n…` : out || "(no output)"}
          </pre>
        ) : (
          <div className="lt-th-status">Running</div>
        )}
      </div>
    );
  }
  return (
    <div className="lt-th-body">
      <ToolBlock
        tool={call}
        result={result}
        messageId={step.messageId}
        conversationId={sessionId as Id<"conversations">}
        timestamp={step.ts}
        globalImageMap={step.images.length ? { [call.id]: step.images } : undefined}
      />
    </div>
  );
}

/** A tool that draws its own card: the classic card, answered from here. */
function CardTool({ step, sessionId, canSend }: { step: LiteStep; sessionId: string; canSend: boolean }) {
  const { call: tc, result } = step;
  const send = canSend ? (content: string) => sendToSession(sessionId, content) : undefined;
  const imageMap = step.images.length ? { [tc.id]: step.images } : undefined;
  const convId = sessionId as Id<"conversations">;
  if (isAskTool(tc.name)) return <AskUserQuestionBlock tool={tc} result={result} onSendMessage={send} />;
  if (isPlanModeTool(tc.name)) return <PlanModeBlock tool={tc} result={result} conversationId={sessionId} messageId={step.messageId} onSendMessage={send} />;
  if (isTodoTool(tc.name)) return <TodoWriteBlock tool={tc} />;
  if (isAgentTool(tc.name)) return <TaskToolBlock tool={tc} result={result} />;
  if (tc.name === "TaskList") return <TaskListBlock tool={tc} result={result} />;
  if (tc.name === "TaskCreate" || tc.name === "TaskUpdate" || tc.name === "TaskGet") return <TaskCreateUpdateBlock tool={tc} result={result} />;
  if (tc.name === "SendUserFile" && step.files.length) return <SentFileBlock files={step.files} />;
  if (tc.name === "SendMessage") return <SendMessageBlock tool={tc} />;
  if (tc.name === "TeamCreate" || tc.name === "TeamDelete") return <TeamCreateBlock tool={tc} />;
  if (tc.name === "Workflow" || tc.name === "workflow") return <WorkflowToolBlock tool={tc} result={result} conversationId={sessionId} />;
  if (tc.name === "StructuredOutput") return <StructuredResultBlock tool={tc} result={result} />;
  if (tc.name === "Skill") return <SkillBlock tool={tc} />;
  if (tc.name === "Monitor" || tc.name === "monitor" || isBackgroundBashToolCall(tc)) return <MonitorBlock tool={tc} conversationId={sessionId} />;
  if (tc.name === "ScheduleWakeup") return <ScheduleWakeupBlock tool={tc} result={result} timestamp={step.ts} />;
  if (parseCastCommand(tc)) return <CastCommandBlock tool={tc} result={result} globalImageMap={imageMap} conversationId={convId} />;
  return <ToolBlock tool={tc} result={result} messageId={step.messageId} conversationId={convId} timestamp={step.ts} globalImageMap={imageMap} />;
}

/** The agent waits on a permission: the viewer's to answer (the stack in the
 *  composer's place), or the owner's. Still: nothing ticks while it waits. */
function WaitingRow({ owner }: { owner: string | null }) {
  return (
    <div className="lt-th-working" role="status">
      <span className="lt-mark" data-mark={owner ? "waiting" : "needs"} aria-hidden />
      <span>{owner ? `Waiting on ${owner.split(/\s+/)[0]}` : "Waiting for your approval"}</span>
    </div>
  );
}

/** The agent is mid-turn: for how long, and the call it is in. Its own
 *  one-second clock, so the tick re-renders this line and nothing else. */
function WorkingRow({ since, live }: { since: number; live: LiteStep | null }) {
  const now = useCoarseNow(1000);
  const doing = live ? activityLine(live.call) : "";
  return (
    <div className="lt-th-working" role="status">
      <span className="lt-mark" data-mark="working" aria-hidden />
      <span>Working for {formatWorkedFor(Math.max(0, now - since))}</span>
      {doing && <span className="lt-th-live">· {doing[0].toUpperCase() + doing.slice(1)}</span>}
    </div>
  );
}
