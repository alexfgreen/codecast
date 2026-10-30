// The sessions one session has talked with, read off its own transcript.
// Agents message each other with `cast send`: the receiver's transcript holds
// the delivery as a user row wrapped in <session-message from="<short id>">,
// and the sender's holds only its own shell call `cast send <ref> "…"`. Both
// halves name the other session, so the list is derived at read time from the
// messages the store holds now (it grows as older pages load) and is never
// stored. Resolving a reference to a title and an owner goes through the
// store's own rows; a session the store has never seen stays out, since
// there is nothing to show or open for it.
import { isShellTool } from "@codecast/shared/render";
import { parseInboundSessionMessage } from "../../components/sessionMessage";
import { parseCastCommandString } from "../../components/castCommand";
import { sessionCardTitle } from "../sessionCard";

type TalkToolCall = { name?: string; input?: unknown };
export type LiteTalkMessage = {
  role?: string;
  content?: string;
  tool_calls?: readonly TalkToolCall[] | null;
};

/** One session this one exchanged messages with, as the transcript names it. */
export type LiteTalkRef = { ref: string; inbound: boolean; outbound: boolean };

/** A session reference `cast send` takes: a short id or a full id. A role's
 *  @handle is not a session and never reaches here (the parser leaves it in
 *  the args). Store resolution weeds out any other word. */
const SESSION_REF = /^[a-z0-9]{7,32}$/i;

function sendTarget(tool: TalkToolCall): string | null {
  if (!tool?.name || !isShellTool(tool.name)) return null;
  let command = "";
  try {
    const input = (typeof tool.input === "string" ? JSON.parse(tool.input) : tool.input) as { command?: unknown; cmd?: unknown } | null;
    command = String(input?.command ?? input?.cmd ?? "");
  } catch {
    return null;
  }
  if (!command.includes("cast")) return null;
  const cast = parseCastCommandString(command);
  if (!cast || cast.category !== "send") return null;
  return SESSION_REF.test(cast.subcommand) ? cast.subcommand.toLowerCase() : null;
}

const refsCache = new WeakMap<object, LiteTalkRef[]>();

/**
 * Every session the transcript exchanged messages with, the most recent
 * exchange first, each once. Memoized by the messages array, so a selector
 * may call it on every store change.
 */
export function liteTalkRefs(messages: readonly LiteTalkMessage[] | null | undefined): LiteTalkRef[] {
  if (!messages || messages.length === 0) return [];
  const hit = refsCache.get(messages);
  if (hit) return hit;
  const byRef = new Map<string, LiteTalkRef>();
  // Newest first: walk backwards, so the first sighting of a ref is its latest.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "user" && typeof m.content === "string" && m.content.includes("<session-message")) {
      const from = parseInboundSessionMessage(m.content)?.from?.toLowerCase();
      if (from && SESSION_REF.test(from)) {
        const ref = byRef.get(from) ?? { ref: from, inbound: false, outbound: false };
        ref.inbound = true;
        byRef.set(from, ref);
      }
    }
    for (const tool of m.tool_calls ?? []) {
      const to = sendTarget(tool);
      if (!to) continue;
      const ref = byRef.get(to) ?? { ref: to, inbound: false, outbound: false };
      ref.outbound = true;
      byRef.set(to, ref);
    }
  }
  const out = [...byRef.values()];
  refsCache.set(messages, out);
  return out;
}

/** A wake signature of liteTalkRefs: re-renders only when the set (or its
 *  order, or a direction) changes, never on an ordinary streamed message. */
export function liteTalkSig(messages: readonly LiteTalkMessage[] | null | undefined): string {
  return liteTalkRefs(messages).map((r) => `${r.ref}${r.inbound ? "<" : ""}${r.outbound ? ">" : ""}`).join(",");
}

export function parseLiteTalkSig(sig: string): LiteTalkRef[] {
  if (!sig) return [];
  return sig.split(",").map((part) => {
    const ref = part.replace(/[<>]/g, "");
    return { ref, inbound: part.includes("<"), outbound: part.includes(">") };
  });
}

type TalkRow = {
  _id?: string;
  short_id?: string;
  user_id?: string | null;
  author_name?: string | null;
  user?: { name?: string | null } | null;
  title?: string | null;
};
type TalkState = {
  sessions?: Record<string, TalkRow | undefined> | null;
  conversations?: Record<string, TalkRow | undefined> | null;
  teamMembers?: ReadonlyArray<{ _id?: string; name?: string | null }> | null;
};

const shortIndexes = new WeakMap<object, Map<string, TalkRow>>();

function byShort(collection: Record<string, TalkRow | undefined>): Map<string, TalkRow> {
  const cached = shortIndexes.get(collection);
  if (cached) return cached;
  const index = new Map<string, TalkRow>();
  for (const id in collection) {
    const row = collection[id];
    if (!row) continue;
    // A session's short id is its stored one, else the first seven of its id
    // (conversations.ts writes it the same way).
    const short = (row.short_id || String(row._id ?? id).slice(0, 7)).toLowerCase();
    if (!index.has(short)) index.set(short, row);
  }
  shortIndexes.set(collection, index);
  return index;
}

/** The session row a `cast send` reference names, as the store holds it. */
export function liteSessionByRef(state: TalkState, ref: string): TalkRow | undefined {
  const direct = state.sessions?.[ref] ?? state.conversations?.[ref];
  if (direct) return direct;
  if (ref.length > 12) return undefined;
  const short = ref.toLowerCase();
  return (state.sessions ? byShort(state.sessions).get(short) : undefined)
    ?? (state.conversations ? byShort(state.conversations).get(short) : undefined);
}

/** A peer as the header draws it: the session to open, what it is called and
 *  whose it is (null when it is the viewer's own). */
export type LiteTalkPeer = LiteTalkRef & { id: string; title: string; owner: string | null };

/** The peers the store can name, in the refs' order, this session left out. */
export function resolveLiteTalkPeers(
  state: TalkState,
  refs: readonly LiteTalkRef[],
  selfId: string,
  meId: string | null,
): LiteTalkPeer[] {
  const out: LiteTalkPeer[] = [];
  const seen = new Set<string>();
  const selfShort = selfId.slice(0, 7).toLowerCase();
  for (const r of refs) {
    const row = liteSessionByRef(state, r.ref);
    const id = row?._id ? String(row._id) : null;
    if (!row || !id || id === selfId || r.ref === selfShort || seen.has(id)) continue;
    seen.add(id);
    const ownerId = row.user_id ? String(row.user_id) : null;
    const mine = !!meId && ownerId === meId;
    const member = !mine && ownerId ? state.teamMembers?.find((m) => String(m?._id) === ownerId) : undefined;
    const ownerName = mine ? null : (member?.name || row.author_name || row.user?.name || "").trim() || null;
    out.push({
      ...r,
      id,
      title: sessionCardTitle(row as Parameters<typeof sessionCardTitle>[0]) || "Session",
      owner: ownerName ? ownerName.split(/\s+/)[0]! : null,
    });
  }
  return out;
}

/** One line per peer, for a subscription that wakes when a title or an owner
 *  changes and at no other time. */
export function liteTalkPeersSig(peers: readonly LiteTalkPeer[]): string {
  return peers.map((p) => [p.id, p.ref, p.title, p.owner ?? "", p.inbound ? 1 : 0, p.outbound ? 1 : 0].join("\u0001")).join("\u0002");
}

export function parseLiteTalkPeersSig(sig: string): LiteTalkPeer[] {
  if (!sig) return [];
  return sig.split("\u0002").map((line) => {
    const [id = "", ref = "", title = "", owner = "", inbound, outbound] = line.split("\u0001");
    return { id, ref, title, owner: owner || null, inbound: inbound === "1", outbound: outbound === "1" };
  });
}

/**
 * What the composer gets when the person picks a session to message: a
 * reference their agent can act on (it runs `cast send`), then their own
 * words after the colon. The session is named the way a person would say it.
 */
export function liteAgentMessagePrompt(target: { shortId: string; title: string; owner: string | null }): string {
  const whose = target.owner ? `${target.owner}'s` : "my";
  const title = target.title.replace(/"/g, "'").trim() || "session";
  return `Message session ${target.shortId} (${whose} "${title}"): `;
}
