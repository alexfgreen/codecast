export function isInboxRoute(pathname?: string | null): boolean {
  return pathname === "/inbox" || pathname?.startsWith("/inbox/") || false;
}

export function isInboxSessionView(pathname?: string | null, source?: string | null): boolean {
  return isInboxRoute(pathname) || ((pathname?.startsWith("/conversation/") ?? false) && source === "inbox");
}

/**
 * Codecast Lite's addresses (src/App.tsx): its home at /lite, two pages of its
 * own (/lite/needs-you, /lite/team), and one session at /lite/<id>. Lite is a
 * shell of its own outside the tab shell, so none of these is an inbox route
 * or a conversation page to the classic rail: only presence (which session
 * this window shows) and Lite's own navigation read them.
 */
export const LITE_ROOT = "/lite";
const LITE_PAGES = new Set(["needs-you", "team"]);

/** The session /lite/<id> opens, or null on Lite's other pages and off Lite. */
export function liteSessionIdFromPath(pathname?: string | null): string | null {
  const segment = pathname?.split(/[?#]/)[0].match(/^\/lite\/([^/]+)\/?$/)?.[1];
  if (!segment || LITE_PAGES.has(segment)) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The Lite address of one session: what /conversation/<id> is to the classic shell. */
export function liteSessionPath(id: string): string {
  return `${LITE_ROOT}/${encodeURIComponent(id)}`;
}

/**
 * Where an address a reused component pushes leads from inside Lite. A
 * conversation page (its diff included) and an inbox selection (/inbox?s=<id>)
 * open that session in Lite, their query and hash riding along (a message deep
 * link, a share token); the bare inbox is Lite's home. Every other address is
 * a page Lite does not have, and leads to the classic one unchanged.
 */
export function liteNavigationTarget(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const url = new URL(path, "https://codecast.local");
  const conversation = url.pathname.match(/^\/conversation\/([^/]+)(?:\/diff)?\/?$/)?.[1];
  if (conversation) return `${LITE_ROOT}/${conversation}${url.search}${url.hash}`;
  if (!isInboxRoute(url.pathname)) return path;
  const session = url.searchParams.get("s");
  url.searchParams.delete("s");
  const rest = url.searchParams.toString();
  return `${session ? liteSessionPath(session) : LITE_ROOT}${rest ? `?${rest}` : ""}${url.hash}`;
}

/**
 * WHICH pointer the session rail highlights on a surface. Three-way, and the
 * split is not "inbox vs everything else":
 *  - "current" — the inbox: it highlights the attended conversation,
 *    `viewingDismissedId ?? currentSessionId`.
 *  - "url"     — a conversation page: the id in the URL, because a non-owner
 *    viewer never sets the store pointer.
 *  - "panel"   — everywhere else: the side panel's own selection.
 *
 * Shared so the rail's highlight (DashboardLayout) and anything that has to
 * MOVE that highlight (the workbench filter's focus eviction) can't disagree
 * about which pointer is live. Inbox is tested first, so a /conversation/ page
 * opened from the inbox counts as the inbox — exactly as isInboxSessionView says.
 */
export type SessionFocusKind = "current" | "url" | "panel";

export function sessionFocusKind(pathname?: string | null, source?: string | null): SessionFocusKind {
  if (isInboxSessionView(pathname, source)) return "current";
  if (pathname?.includes("/conversation/")) return "url";
  return "panel";
}

/**
 * Whether the mounted PAGE publishes the "panel" pointer itself. Leaving the
 * inbox carries the attended conversation into the rail so the highlight
 * survives the move; that carry-over is a default for pages that say nothing
 * about the rail. The decision stepper (/decisions?mode=step) is not one of them: it
 * writes the question you are reading into sidePanelSessionId from its own
 * effect, and that effect commits BEFORE the layout's (children first), so an
 * unconditional carry-over lands on top of it and the rail lights the inbox's
 * conversation, or nothing, instead of the question. The layout asks here
 * before it writes a default.
 */
export function pageOwnsRailHighlight(pathname?: string | null): boolean {
  return pathname === "/decisions";
}

/**
 * What NAVIGATION does to the rail's own pointer (`sidePanelSessionId`).
 *
 * The rail highlights what is on the stage. A page like /tasks or /docs puts no
 * conversation there, so nothing on it is selected and the rail must show no
 * lit row — carrying the inbox's attended session (or the session you just left)
 * into the pointer made /tasks read as "this session is open" when it was not.
 * So arriving on a "panel" surface CLEARS the pointer; a deliberate selection
 * made while standing on that page (a liveness dot, a call panel, a new session)
 * still lights the rail, because that is a click, not a navigation.
 *
 * "keep" covers the inbox and conversation pages, which highlight their own
 * pointer anyway, and the pages that publish the rail pointer themselves.
 */
export function railPointerOnNavigate(pathname?: string | null, source?: string | null): "clear" | "keep" {
  if (pageOwnsRailHighlight(pathname)) return "keep";
  return sessionFocusKind(pathname, source) === "panel" ? "clear" : "keep";
}

/**
 * What clicking a session in the global list should do, given which surface is
 * mounted:
 *  - "leave": promote to the stage — navigate to the inbox with the session
 *    selected. The default everywhere outside the inbox: a conversation is a
 *    primary object and always opens on the stage; the rail stays the
 *    glanceable session list and never hosts content. Side by side is a
 *    DRAG (onto the stage), never a click's side effect.
 *  - "inboxInPlace": already on the inbox — select without navigating.
 *
 * Settings is checked FIRST and deliberately: the tab-aware `pathname` reports the
 * carried "/inbox" tab while you're in Settings, so `isOnInboxPage` is spuriously
 * true there. Without this precedence the click would select in place and never
 * leave Settings. Callers must pass `isOnSettingsPage` from the real router URL.
 */
export type SessionSelectKind = "leave" | "inboxInPlace";

export function resolveSessionSelectKind(opts: {
  isOnSettingsPage: boolean;
  isOnInboxPage: boolean;
}): SessionSelectKind {
  if (opts.isOnSettingsPage) return "leave";
  if (opts.isOnInboxPage) return "inboxInPlace";
  return "leave";
}
