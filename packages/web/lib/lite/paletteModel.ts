// Codecast Lite's ⌘K palette, as data: how a typed query names an action, a
// project or a person, and the order its groups take. Sessions are ranked by
// the shared session ranker (lib/instantSessionSearch rankSessions), the same
// one the classic palette's instant tier uses; this file covers the rest.

/**
 * How directly `query` names `text`: 0 when the text starts with it, 1 when
 * every typed word starts a word of the text, 2 when every typed word is
 * somewhere inside it, null when one is missing. An empty query is 0.
 */
export function liteNameTier(text: string, query: string): 0 | 1 | 2 | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return 0;
  const lower = text.toLowerCase();
  if (lower.startsWith(q)) return 0;
  const tokens = q.split(" ");
  if (!tokens.every((t) => lower.includes(t))) return null;
  const words = lower.split(/[\s\-—_,.;:/\\›]+/).filter(Boolean);
  return tokens.every((t) => words.some((w) => w.startsWith(t))) ? 1 : 2;
}

/** The best tier any of `names` reaches (a label and its aliases). */
export function bestNameTier(names: readonly string[], query: string): 0 | 1 | 2 | null {
  let best: 0 | 1 | 2 | null = null;
  for (const n of names) {
    const t = liteNameTier(n, query);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Keep the items a query names, best first, stable within a tier. */
export function rankByName<T>(items: readonly T[], query: string, namesOf: (item: T) => readonly string[], cap = Infinity): T[] {
  const hits: Array<{ item: T; tier: number; at: number }> = [];
  items.forEach((item, at) => {
    const tier = bestNameTier(namesOf(item), query);
    if (tier !== null) hits.push({ item, tier, at });
  });
  hits.sort((a, b) => a.tier - b.tier || a.at - b.at);
  return hits.slice(0, cap).map((h) => h.item);
}

export type LitePaletteGroupKey = "actions" | "sessions" | "projects" | "people";

/**
 * The order the palette's groups take while typing: the group holding the
 * strongest match leads, so "new" puts New session before a session titled
 * "new auth flow". Ties keep the resting order: actions, sessions, projects,
 * people.
 */
export function orderLiteGroups(best: Partial<Record<LitePaletteGroupKey, number | null>>): LitePaletteGroupKey[] {
  const rest: LitePaletteGroupKey[] = ["actions", "sessions", "projects", "people"];
  return rest
    .filter((k) => best[k] !== undefined && best[k] !== null)
    .sort((a, b) => (best[a] as number) - (best[b] as number) || rest.indexOf(a) - rest.indexOf(b));
}
