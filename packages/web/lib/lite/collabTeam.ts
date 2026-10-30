// Lite's team page, as data: which of the team's chat rooms it offers and
// which one it opens on. One team surface, so its rooms only: no direct
// messages (the classic chat has them) and no public community rooms. The
// rooms come from the chat rail (useChatRail), already scoped to the active
// workspace and sorted by activity; this file only picks from it.

type RailRoom = { id: string; name: string; kind?: string; joined?: boolean; unreadCount?: number; mentionCount?: number };

/** The team's rooms the viewer is in, by name. */
export function liteTeamChannels<T extends RailRoom>(rail: readonly T[]): T[] {
  return rail
    .filter((c) => c.kind !== "dm" && c.kind !== "community" && c.joined !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The room the page opens on: the one the viewer picked last, while it is
 * still one of the team's; else the team's main room (#general, the room
 * every member joins); else the busiest (the rail's first).
 */
export function liteMainChannelId(channels: readonly RailRoom[], rail: readonly RailRoom[], remembered: string | null | undefined): string | null {
  if (remembered && channels.some((c) => c.id === remembered)) return remembered;
  const general = channels.find((c) => c.name.toLowerCase() === "general");
  if (general) return general.id;
  const busiest = rail.find((r) => channels.some((c) => c.id === r.id));
  return busiest?.id ?? channels[0]?.id ?? null;
}

/** How a room reads in the switcher: its name, and what is unread there. */
export function liteChannelOption(c: RailRoom): string {
  const unread = c.mentionCount ? ` · @${c.mentionCount}` : c.unreadCount ? ` · ${c.unreadCount > 99 ? "99+" : c.unreadCount}` : "";
  return `#${c.name}${unread}`;
}
