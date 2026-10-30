// Agents on one team talking to each other, in Lite's own style: a card with
// the agent hue down its left edge, a header naming whose agent and which
// session ("From Maya's agent · Ship mobile"), the message as markdown, and
// the time on hover. Both halves of a `cast send` draw one: the recipient's
// delivered turn (inbound) and the sender's own shell call (outbound, with
// how it came out). The session's title opens it in Lite. A reference the
// viewer cannot resolve stays its bare short id, in mono.
//
// Names come from the store's row on the first frame and the reference query
// (conversations.webGet, the one the classic id pill reads) after, never-throw:
// the card is honest without them.
import { memo, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, CornerDownRight } from "lucide-react";
import { api } from "@codecast/convex/convex/_generated/api";
import { useQueryNoThrow } from "../../../hooks/useQueryNoThrow";
import { isConvexId, useInboxStore } from "../../../store/inboxStore";
import { liteSessionPath } from "../../../lib/inboxRouting";
import {
  agentHeadline, agentIdentity, findAgentSession, isSessionShortId, rosterName, sendDeliveredTo, sendDelivery,
  type AgentIdentity, type AgentSessionFacts, type OutboundSend,
} from "../../../lib/lite/agentMessages";
import type { LiteRow } from "../../../lib/lite/threadRows";
import type { ToolResult } from "../../conversation/types";
import { MessageMarkdown } from "../../conversation/markdown";
import { SessionMessageBlock } from "../../conversation/blocks/systemBlocks";

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The session a reference names: the store's row at once, the reference
 *  query's when it answers (a teammate's session the store never held). */
function useAgentSession(ref: string | null): AgentSessionFacts | null {
  // Read once, not subscribed: a card must not re-render on every heartbeat
  // of a collection with thousands of rows; the query keeps it fresh.
  const seed = useMemo(() => findAgentSession(useInboxStore.getState(), ref), [ref]);
  const args = !ref ? "skip" : isConvexId(ref) ? { id: ref } : isSessionShortId(ref) ? { short_id: ref } : "skip";
  const served = useQueryNoThrow(api.conversations.webGet, args).data as AgentSessionFacts | null | undefined;
  return served ?? seed;
}

function useAgentIdentity(ref: string | null, wireName?: string): AgentIdentity {
  const session = useAgentSession(ref);
  const meId = useInboxStore((s) => (s.currentUser?._id ? String(s.currentUser._id) : null));
  const ownerId = session?.user_id ? String(session.user_id) : null;
  const roster = useInboxStore((s) => rosterName(s.teamMembers, ownerId));
  return useMemo(() => agentIdentity(session, { meId, rosterName: roster, wireName }), [session, meId, roster, wireName]);
}

/** The card's frame. `title` opens the session when its id is known;
 *  without a title, the bare reference stands in, in mono. */
function AgentCard({ dir, headline, who, fallbackRef, state, ts, children }: {
  dir: "from" | "to";
  headline: string;
  who: AgentIdentity | null;
  fallbackRef?: string | null;
  state?: ReactNode;
  ts: number;
  children: ReactNode;
}) {
  const label = who?.title ?? fallbackRef ?? null;
  const mono = !who?.title;
  // Nobody known and nothing to name: still an agent, never a bare verb.
  const head = !label && (headline === "From" || headline === "To") ? `${headline} an agent` : headline;
  const named = label && (who?.id
    ? <Link href={liteSessionPath(who.id)} className="lt-agent-title" data-mono={mono ? "" : undefined} title="Open this session">{label}</Link>
    : <span className="lt-agent-title" data-mono={mono ? "" : undefined}>{label}</span>);
  return (
    <div className="lt-agent" data-dir={dir}>
      <div className="lt-agent-head">
        {dir === "from" ? <CornerDownRight aria-hidden /> : <ArrowUpRight aria-hidden />}
        <span className="lt-agent-who">{head}</span>
        {named && head !== "From" && head !== "To" && <span className="lt-agent-sep" aria-hidden>·</span>}
        {named}
        {state}
        <time className="lt-agent-time" dateTime={new Date(ts).toISOString()}>{clock(ts)}</time>
      </div>
      {children}
    </div>
  );
}

type InboundRow = Extract<LiteRow, { kind: "session_message" }>;

/** What another agent sent into this session. A message still queued for
 *  this session's daemon is the classic card, which carries its Send and
 *  Cancel; a subagent's report names the subagent. */
export const LiteAgentInbound = memo(function LiteAgentInbound({ row, sessionId }: { row: InboundRow; sessionId: string }) {
  const m = row.message as InboundRow["message"] & { _serverPendingStatus?: string; _serverPendingReason?: string; _serverPendingScreen?: string };
  if (m._serverPendingStatus && m._serverPendingStatus !== "delivered") {
    return (
      <SessionMessageBlock
        from={row.from}
        name={row.name}
        body={row.body}
        timestamp={row.ts}
        pendingStatus={m._serverPendingStatus}
        pendingReason={m._serverPendingReason}
        pendingScreen={m._serverPendingScreen}
        pendingMessageId={m._id}
        recipientConversationId={sessionId}
      />
    );
  }
  if (row.variant === "agent") {
    return (
      <AgentCard dir="from" headline={`Report from ${row.from}`} who={null} ts={row.ts}>
        <div className="lt-agent-body lt-md"><MessageMarkdown content={row.body} /></div>
      </AgentCard>
    );
  }
  return <InboundCard row={row} />;
});

function InboundCard({ row }: { row: InboundRow }) {
  const ref = row.fromId ?? (row.from && row.from !== "unknown" ? row.from : null);
  const who = useAgentIdentity(ref, row.name);
  return (
    <AgentCard dir="from" headline={agentHeadline("from", who)} who={who} fallbackRef={row.from && row.from !== "unknown" ? row.from : null} ts={row.ts}>
      <div className="lt-agent-body lt-md"><MessageMarkdown content={row.body} /></div>
    </AgentCard>
  );
}

const DELIVERY_LABEL = { sending: "Sending", sent: "Sent", queued: "Queued", failed: "Failed" } as const;

/** This session's agent messaging another: `cast send <session>` or
 *  `cast send @handle` (a role, whose standing session the server picks and
 *  the CLI names). How it came out reads off the call's result; a refusal
 *  opens what the CLI said, as the thread's open state for the row (`open`,
 *  toggled by its key), so the list's height cache follows it. */
export const LiteAgentOutbound = memo(function LiteAgentOutbound({ send, result, ts, open = false, onToggle, rowKey }: {
  send: OutboundSend;
  result?: ToolResult;
  ts: number;
  open?: boolean;
  onToggle?: (key: string) => void;
  rowKey?: string;
}) {
  const delivery = sendDelivery(result);
  const reached = sendDeliveredTo(result);
  const ref = send.target.kind === "session" ? send.target.ref : reached;
  const who = useAgentIdentity(ref);
  const why = open && delivery === "failed";
  const headline = send.target.kind === "role" ? `To ${send.target.handle}` : agentHeadline("to", who);
  // Unresolved, the reference as typed; a role's, the session the CLI named.
  const fallbackRef = send.target.kind === "role" ? reached : isConvexId(send.target.ref) ? null : send.target.ref;
  const state = delivery === "failed" ? (
    <button type="button" className="lt-agent-state" data-state="failed" aria-expanded={why} onClick={() => rowKey && onToggle?.(rowKey)}>
      {DELIVERY_LABEL.failed}
    </button>
  ) : (
    <span className="lt-agent-state" data-state={delivery}>
      {delivery === "sent" && <Check aria-hidden />}
      {DELIVERY_LABEL[delivery]}
    </span>
  );
  return (
    <AgentCard dir="to" headline={headline} who={who} fallbackRef={fallbackRef} state={state} ts={ts}>
      {send.dynamic ? (
        // The shell computed what arrived; the transcript holds only the recipe.
        <div className="lt-agent-body">
          <span className="lt-agent-note">As typed</span>
          <code className="lt-agent-raw">{send.body}</code>
        </div>
      ) : (
        <div className="lt-agent-body lt-md"><MessageMarkdown content={send.body} /></div>
      )}
      {why && result?.content && <pre className="lt-th-pre lt-agent-why" data-error="">{result.content}</pre>}
    </AgentCard>
  );
});
