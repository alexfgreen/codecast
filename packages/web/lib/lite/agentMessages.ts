// Agents on one team talking to each other, as Lite's thread names them. Two
// sides of one `cast send`: the sender's transcript holds only its agent's own
// shell call (`cast send jx7c6zk "…"`, or `cast send @handle "…"` to a role's
// standing session), and the recipient's holds the wrapped turn
// (`<session-message from="jx…" name="…">`, classified upstream). Both read as
// a card that says whose agent and which session, never as a person's typed
// words. Pure, so the cards and their tests resolve the same way.
import type { ToolCall, ToolResult } from "../../components/conversation/types";
import { parseCastCommand } from "../../components/conversation/classify";
import { extractSendBody } from "../../components/castCommand";
import { findEntityInStore } from "../liveEntities";
import { isConvexId } from "../entityLinks";

/** A session's 7-character short id (`jx7c6zk`). */
export function isSessionShortId(ref: string): boolean {
  return /^jx[a-z0-9]{5,}$/i.test(ref);
}

export type AgentTarget = { kind: "session"; ref: string } | { kind: "role"; handle: string };

/** An agent's `cast send`, as its card draws it. */
export type OutboundSend = {
  target: AgentTarget;
  body: string;
  /** The shell computed the payload (`$(…)`, a pipe, `$VAR`): `body` is the
   *  command as typed, not what arrived. */
  dynamic: boolean;
};

// Flags that can sit between `send` and its target; `--from` swallows a value.
const LEADING_SEND_FLAGS = /^(?:(?:--from|-f)\s+\S+\s+|--(?:wake|no-wake|raw|queue)\s+)*/;
const TARGET = /^(jx[a-z0-9]{5,}|@[\w.-]+)(?=\s|$)/i;

/**
 * The `cast send` a tool call ran, or null when it ran something else. The
 * command parser keeps a session's id (short or full) in the subcommand slot; a role's handle
 * (and any flag before the target) is not a word, so it leads the args.
 */
export function parseOutboundSend(tc: ToolCall): OutboundSend | null {
  const cast = parseCastCommand(tc);
  if (!cast || cast.category !== "send") return null;
  let target: string;
  let rest: string;
  if (isSessionShortId(cast.subcommand) || isConvexId(cast.subcommand)) {
    target = cast.subcommand;
    rest = cast.args;
  } else if (!cast.subcommand) {
    const args = cast.args.trim().replace(LEADING_SEND_FLAGS, "");
    const m = args.match(TARGET);
    if (!m) return null;
    target = m[1];
    rest = args.slice(m[0].length);
  } else {
    return null;
  }
  const { body, kind } = extractSendBody(rest);
  return {
    target: target.startsWith("@") ? { kind: "role", handle: target } : { kind: "session", ref: isConvexId(target) ? target : target.toLowerCase() },
    body,
    dynamic: kind === "dynamic",
  };
}

export type SendDelivery = "sending" | "sent" | "queued" | "failed";

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** How the send came out, from what the CLI printed: still running, sent,
 *  queued for a daemon that is away (it arrives when that daemon is back), or
 *  refused. */
export function sendDelivery(result: ToolResult | undefined): SendDelivery {
  if (!result) return "sending";
  if (result.is_error) return "failed";
  return /\bqueued for\b/i.test((result.content ?? "").replace(ANSI, "")) ? "queued" : "sent";
}

/** The session the server delivered to, as the CLI printed it: a role's
 *  handle names its standing session only there. */
export function sendDeliveredTo(result: ToolResult | undefined): string | null {
  const m = (result?.content ?? "").replace(ANSI, "").match(/\b(?:sent to|queued for)\s+(jx[a-z0-9]{5,})\b/i);
  return m ? m[1].toLowerCase() : null;
}

/** What a card knows about the session on the other end: the store's row or
 *  the reference query's (conversations.webGet), whichever it holds. */
export type AgentSessionFacts = {
  _id?: string;
  short_id?: string;
  title?: string | null;
  short_title?: string | null;
  user_id?: string | null;
  is_own?: boolean;
  author_name?: string | null;
  user?: { name?: string | null } | null;
};

/** The session a sender's or a target's reference names, as the store
 *  already holds it: by Convex id, or by short id. */
export function findAgentSession(state: unknown, ref: string | null | undefined): AgentSessionFacts | null {
  if (!ref) return null;
  return (findEntityInStore(state, "session", ref) as AgentSessionFacts | undefined) ?? null;
}

/** A teammate's name off the roster, by user id. */
export function rosterName(members: unknown, userId: string | null | undefined): string | null {
  if (!userId || !Array.isArray(members)) return null;
  const m = (members as Array<{ _id?: string; name?: string | null }>).find((x) => String(x?._id) === String(userId));
  return m?.name?.trim() || null;
}

export type AgentIdentity = {
  /** The session's Convex id, for the link that opens it. */
  id: string | null;
  title: string | null;
  /** The owner's first name ("Maya"), when it is someone else's. */
  owner: string | null;
  mine: boolean;
};

export function firstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

/**
 * Whose agent and which session. The owner's name comes from the session
 * (its author, then the roster, then the conversation's user), and last from
 * the wire's `name`, which a cross-user send carries even when the viewer
 * cannot see the sender's session.
 */
export function agentIdentity(
  session: AgentSessionFacts | null | undefined,
  opts: { meId: string | null; rosterName?: string | null; wireName?: string | null },
): AgentIdentity {
  const mine = !!session && (session.is_own === true || (!!opts.meId && !!session.user_id && String(session.user_id) === opts.meId));
  const ownerName = mine ? null : session?.author_name?.trim() || opts.rosterName || session?.user?.name?.trim() || opts.wireName?.trim() || null;
  const id = session?._id && isConvexId(session._id) ? session._id : null;
  return { id, title: session?.title?.trim() || session?.short_title?.trim() || null, owner: firstName(ownerName), mine };
}

/** "From Maya's agent", "To your agent"; just "From" when nobody is known,
 *  and the card shows the bare reference beside it. */
export function agentHeadline(dir: "from" | "to", who: AgentIdentity): string {
  const verb = dir === "from" ? "From" : "To";
  if (who.mine) return `${verb} your agent`;
  if (who.owner) return `${verb} ${who.owner}'s agent`;
  return who.title ? `${verb} an agent` : verb;
}
