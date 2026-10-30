// The people around a Lite session or team, as data: the faces a header
// shows and how many it folds into "+N", who is forming words in the
// session's composer, who is online on the team, and the teammates a session
// can be handed to. Presence comes off the roster the store already holds
// (teamMembers, which the Lite feeds keep fresh) and off the composer's
// presence rows; nothing here keeps a copy of either.
import { isPerson } from "@codecast/shared/team/memberKind";
import { memberPresenceVisual, type PresenceVisual } from "../../components/presence/memberPresence";

export type LiteMember = {
  _id?: string;
  name?: string | null;
  github_username?: string | null;
  email?: string | null;
  image?: string | null;
  github_avatar_url?: string | null;
  is_bot?: boolean;
  presence_state?: string;
  status?: string;
  in_huddle?: boolean;
  in_room_key?: string | null;
  viewing_conversation_id?: string | null;
};

/** A face to draw: an id, a name and a photo when there is one. */
export type LiteFace = { id: string; name: string; image: string | null };

export function liteMemberName(m: LiteMember | null | undefined): string {
  return (m?.name || m?.github_username || m?.email?.split("@")[0] || "Teammate").trim();
}

export function liteFaceOf(m: LiteMember): LiteFace {
  return { id: String(m._id ?? ""), name: liteMemberName(m), image: m.image || m.github_avatar_url || null };
}

/** The first `max` faces, and how many more the stack folds into "+N". */
export function liteFacepile<T>(items: readonly T[], max = 3): { shown: T[]; more: number } {
  const shown = items.slice(0, max);
  return { shown, more: items.length - shown.length };
}

/** "Maya is typing", "Maya and Jon are typing", "Maya, Jon and 2 others are typing". */
export function liteTypingLabel(names: readonly string[]): string {
  const first = (n: string) => n.trim().split(/[\s@]+/)[0] || n;
  if (names.length === 0) return "";
  if (names.length === 1) return `${first(names[0]!)} is typing`;
  if (names.length === 2) return `${first(names[0]!)} and ${first(names[1]!)} are typing`;
  const rest = names.length - 2;
  return `${first(names[0]!)}, ${first(names[1]!)} and ${rest} ${rest === 1 ? "other" : "others"} are typing`;
}

/** "Maya Kim", "Maya and Jon", "Maya, Jon and 2 others": who is here, for a
 *  facepile's tooltip. */
export function liteNamesLabel(names: readonly string[]): string {
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${first(names[0]!)} and ${first(names[1]!)}`;
  const rest = names.length - 2;
  return `${first(names[0]!)}, ${first(names[1]!)} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

const PRESENCE_ORDER: Record<PresenceVisual, number> = { active: 0, busy: 1, idle: 2, away: 3, offline: 4 };

/** The people on the team who are online now, the viewer left out: the most
 *  present first (active, busy, idle, away), then by name. Bots are not
 *  people and never show. */
export function liteOnlineTeammates<T extends LiteMember>(members: readonly T[] | null | undefined, meId: string | null): Array<T & { presence: PresenceVisual }> {
  const out: Array<T & { presence: PresenceVisual }> = [];
  for (const m of members ?? []) {
    if (!isPerson(m) || !m._id || String(m._id) === meId) continue;
    const presence = memberPresenceVisual(m);
    if (presence === "offline") continue;
    out.push({ ...m, presence });
  }
  return out.sort((a, b) => PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence] || liteMemberName(a).localeCompare(liteMemberName(b)));
}

/** A teammate a session can be handed to. */
export type LiteHandoffPerson = LiteFace & { owner: boolean; presence: PresenceVisual };

/**
 * Who a session can be handed to: the people on the roster (the session
 * team's, once the server's list lands, else the active team's), never the
 * viewer and never a bot. Online people first, then by name; an existing
 * co-owner stays in the list (handing to them makes them its reporting line).
 */
export function liteHandoffPeople(
  roster: readonly LiteMember[] | null | undefined,
  meId: string | null | undefined,
  ownerIds: ReadonlySet<string>,
): LiteHandoffPerson[] {
  const out: LiteHandoffPerson[] = [];
  const seen = new Set<string>();
  for (const m of roster ?? []) {
    if (!isPerson(m) || !m._id) continue;
    const id = String(m._id);
    if (id === meId || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...liteFaceOf(m), owner: ownerIds.has(id), presence: memberPresenceVisual(m) });
  }
  return out.sort((a, b) => Number(a.presence === "offline") - Number(b.presence === "offline") || a.name.localeCompare(b.name));
}
