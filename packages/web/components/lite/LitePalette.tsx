// Codecast Lite's ⌘K palette: actions, then the sessions you were just in,
// and as you type every session you can open (yours and the team's live
// ones), projects (jump to the newest session) and teammates (go to the
// session they are viewing). Enter opens the highlighted row; Escape closes.
//
// Built on cmdk like the classic palette, with its own frame and its own
// open state (lib/lite/liteLayout). The classic CommandPalette is never
// mounted here: it routes to classic addresses and reads the classic tab.
// Mounted only while open, so its store subscriptions cost nothing at rest.
import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router";
import {
  ArrowUpRight,
  Diamond,
  FolderGit2,
  Hash,
  Keyboard,
  Moon,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  SquarePen,
  Sun,
} from "lucide-react";
import { isForeignRow, isSub, ownTeamRowsSig, useInboxStore, useTrackedStore, type InboxSession } from "../../store/inboxStore";
import { useMountEffect } from "../../hooks/useMountEffect";
import { useCoarseNow } from "../../hooks/useCoarseNow";
import { liteTeammateSessionIds } from "../../hooks/useLiteFeeders";
import { rankSessions, searchableSessionsSig, sessionStanding, standingMark } from "../../lib/instantSessionSearch";
import { sessionCardTitle } from "../../lib/sessionCard";
import { liteSessionPath } from "../../lib/inboxRouting";
import { useLiteLayout } from "../../lib/lite/liteLayout";
import { useLiteSidebarModel } from "../../lib/lite/useLiteSidebar";
import { liteAge, type LiteMark } from "../../lib/lite/sidebarModel";
import { bestNameTier, orderLiteGroups, rankByName, type LitePaletteGroupKey } from "../../lib/lite/paletteModel";
import { memberPresenceState } from "../presence/memberPresence";
import { KeyCap, MenuKeyCaps } from "../KeyboardShortcutsHelp";
import { useTheme } from "../ThemeProvider";
import type { ShortcutAction } from "../../shortcuts";
import { LiteAvatar, LiteStatusMark } from "./LiteSidebarRows";

const RECENT_LIMIT = 12;
const SESSION_LIMIT = 20;
const SECONDARY_LIMIT = 5;

type PaletteAction = {
  id: string;
  label: string;
  /** Other words a person might type for it. */
  names?: string[];
  icon: ReactNode;
  shortcut?: ShortcutAction;
  run: () => void;
};

type SessionHit = { id: string; title: string; mark: LiteMark; who: string | null; age: string };
type ProjectHit = { key: string; label: string; detail: string; newestId: string };
type PersonHit = { id: string; name: string; image: string | null; sessionId: string; sessionTitle: string };

export function LitePalette() {
  const layout = useLiteLayout();
  const model = useLiteSidebarModel();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const q = deferred.trim().toLowerCase();
  const now = useCoarseNow(15_000);

  // Give focus back to whatever had it (a row, the composer) on close.
  const returnFocus = useRef<HTMLElement | null>(null);
  useMountEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    return () => {
      const el = returnFocus.current;
      if (el && el.isConnected) el.focus({ preventScroll: true });
    };
  });

  const close = () => layout.setPaletteOpen(false);
  const go = (path: string) => {
    close();
    navigate(path);
  };
  const run = (fn: () => void) => {
    close();
    fn();
  };

  const s = useTrackedStore([
    (st) => searchableSessionsSig(st.sessions),
    (st) => ownTeamRowsSig(st.sessions),
    (st) => st.currentUser?._id,
    (st) => st.clientState.ui?.active_team_id,
    (st) => st.teamMembers,
  ]);
  const meId = s.currentUser?._id ? String(s.currentUser._id) : null;
  const activeTeamId = (s.clientState.ui?.active_team_id as string | undefined) ?? null;
  const activeId = model.activeId;

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [
      { id: "new", label: "New session", names: ["start", "create"], icon: <SquarePen aria-hidden />, shortcut: "lite.newSession", run: () => navigate("/lite") },
      { id: "needs", label: "Needs you", names: ["inbox", "questions", "waiting"], icon: <Diamond aria-hidden />, shortcut: "lite.needsYou", run: () => navigate("/lite/needs-you") },
    ];
    if (activeTeamId) list.push({ id: "team", label: "Team", names: ["teammates", "people"], icon: <Hash aria-hidden />, shortcut: "lite.team", run: () => navigate("/lite/team") });
    list.push(
      { id: "theme", label: theme === "dark" ? "Use the light theme" : "Use the dark theme", names: ["toggle theme", "dark mode", "light mode"], icon: theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />, run: toggleTheme },
      { id: "sidebar", label: "Toggle sidebar", names: ["hide sidebar", "show sidebar"], icon: <PanelLeft aria-hidden />, shortcut: "lite.toggleSidebar", run: layout.toggleSidebar },
    );
    if (activeId) {
      list.push(
        { id: "right", label: "Toggle right panel", names: ["changes", "diff", "details"], icon: <PanelRight aria-hidden />, shortcut: "lite.toggleRightPanel", run: layout.toggleRightPanel },
        // A plain router move: the compat router would turn /inbox?s= back into Lite.
        { id: "classic-session", label: "Open this session in classic", names: ["classic"], icon: <ArrowUpRight aria-hidden />, run: () => navigate(`/inbox?s=${encodeURIComponent(activeId)}`) },
      );
    } else {
      list.push({ id: "classic", label: "Open the classic app", names: ["classic", "inbox"], icon: <ArrowUpRight aria-hidden />, run: () => navigate("/inbox") });
    }
    list.push(
      { id: "keys", label: "Keyboard shortcuts", names: ["keys", "hotkeys", "help"], icon: <Keyboard aria-hidden />, shortcut: "ui.toggleShortcutsHelp", run: () => useInboxStore.getState().toggleShortcutsPanel() },
      { id: "settings", label: "Settings", names: ["preferences"], icon: <Settings aria-hidden />, run: () => useInboxStore.getState().openSettingsModal() },
    );
    return list;
  }, [activeTeamId, activeId, theme, toggleTheme, layout.toggleSidebar, layout.toggleRightPanel, navigate]);

  // At rest: the sessions most recently active, the open one left out.
  const recents = useMemo<SessionHit[]>(() => {
    const rows = model.projects.flatMap((g) => g.all).filter((r) => r.id !== activeId);
    rows.sort((a, b) => b.activityAt - a.activityAt);
    return rows.slice(0, RECENT_LIMIT).map((r) => ({ id: r.id, title: r.title, mark: r.mark, who: r.projectLabel, age: liteAge(r.activityAt, now) }));
  }, [model.projects, activeId, now]);

  const sessionHits = useMemo<SessionHit[]>(() => {
    if (!q) return [];
    const teammateIds = activeTeamId ? new Set(liteTeammateSessionIds(s, activeTeamId, meId)) : new Set<string>();
    const pool: InboxSession[] = [];
    for (const row of Object.values(s.sessions)) {
      if (!row || isSub(row)) continue;
      if (!isForeignRow(row, meId) || teammateIds.has(row._id)) pool.push(row);
    }
    const ranked = rankSessions(pool, q, (row) => sessionStanding(row, meId, row), SESSION_LIMIT);
    return ranked.map((row) => {
      const mark = standingMark(sessionStanding(row, meId, row));
      const mine = !isForeignRow(row, meId);
      return {
        id: row._id,
        title: sessionCardTitle(row),
        mark: mark === "needs_input" ? "needs" : mark,
        who: mine ? null : row.author_name?.split(" ")[0] ?? null,
        age: liteAge(row.updated_at, now),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, searchableSessionsSig(s.sessions), ownTeamRowsSig(s.sessions), meId, activeTeamId]);

  const projectHits = useMemo<ProjectHit[]>(() => {
    if (!q) return [];
    const groups = model.projects.map((g) => ({ key: g.key, label: g.label, detail: g.detail, newestId: g.all[0]!.id }));
    return rankByName(groups, q, (g) => [g.label, g.detail], SECONDARY_LIMIT);
  }, [q, model.projects]);

  const personHits = useMemo<PersonHit[]>(() => {
    if (!q || !activeTeamId) return [];
    const people: PersonHit[] = [];
    for (const m of (s.teamMembers ?? []) as any[]) {
      const id = m?._id ? String(m._id) : "";
      if (!id || id === meId || !m.viewing_conversation_id || memberPresenceState(m) === "offline") continue;
      const sessionId = String(m.viewing_conversation_id);
      const row = s.sessions[sessionId];
      people.push({
        id,
        name: m.name || m.github_username || "Teammate",
        image: m.image || m.github_avatar_url || null,
        sessionId,
        sessionTitle: row ? sessionCardTitle(row) : "a session",
      });
    }
    return rankByName(people, q, (p) => [p.name], SECONDARY_LIMIT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activeTeamId, meId, s.teamMembers]);

  const actionHits = useMemo(() => (q ? rankByName(actions, q, (a) => [a.label, ...(a.names ?? [])]) : actions), [q, actions]);

  // While typing, the group holding the strongest match leads.
  const groupOrder = useMemo<LitePaletteGroupKey[]>(() => {
    if (!q) return ["actions", "sessions"];
    return orderLiteGroups({
      actions: actionHits.length ? bestNameTier([actionHits[0]!.label, ...(actionHits[0]!.names ?? [])], q) : null,
      // A session match is ranked by the shared ranker, which already put the
      // best first; its title tier stands for the group.
      sessions: sessionHits.length ? bestNameTier([sessionHits[0]!.title], q) ?? 2 : null,
      projects: projectHits.length ? bestNameTier([projectHits[0]!.label, projectHits[0]!.detail], q) : null,
      people: personHits.length ? bestNameTier([personHits[0]!.name], q) : null,
    });
  }, [q, actionHits, sessionHits, projectHits, personHits]);

  const sessions = q ? sessionHits : recents;
  const groups: Record<LitePaletteGroupKey, ReactNode> = {
    actions: actionHits.length > 0 && (
      <Command.Group key="actions" heading="Actions">
        {actionHits.map((a) => (
          <Command.Item key={a.id} value={`action:${a.id}`} onSelect={() => run(a.run)}>
            {a.icon}
            <span className="flex-1 truncate">{a.label}</span>
            {a.shortcut && <MenuKeyCaps action={a.shortcut} className="flex items-center gap-[2px]" />}
          </Command.Item>
        ))}
      </Command.Group>
    ),
    sessions: sessions.length > 0 && (
      <Command.Group key="sessions" heading={q ? "Sessions" : "Recent sessions"}>
        {sessions.map((hit) => (
          <Command.Item key={hit.id} value={`session:${hit.id}`} onSelect={() => go(liteSessionPath(hit.id))}>
            <LiteStatusMark mark={hit.mark} />
            <span className="flex-1 truncate text-[var(--lt-text)]">{hit.title}</span>
            {hit.who && <span className="lt-meta max-w-[120px] truncate">{hit.who}</span>}
            <span className="lt-meta">{hit.age}</span>
          </Command.Item>
        ))}
      </Command.Group>
    ),
    projects: projectHits.length > 0 && (
      <Command.Group key="projects" heading="Projects">
        {projectHits.map((p) => (
          <Command.Item key={p.key} value={`project:${p.key}`} onSelect={() => go(liteSessionPath(p.newestId))}>
            <FolderGit2 aria-hidden />
            <span className="flex-1 truncate text-[var(--lt-text)]">{p.label}</span>
            {p.detail !== p.label && <span className="lt-meta lt-mono max-w-[220px] truncate">{p.detail}</span>}
          </Command.Item>
        ))}
      </Command.Group>
    ),
    people: personHits.length > 0 && (
      <Command.Group key="people" heading="People">
        {personHits.map((p) => (
          <Command.Item key={p.id} value={`person:${p.id}`} onSelect={() => go(liteSessionPath(p.sessionId))}>
            <LiteAvatar name={p.name} image={p.image} size={18} />
            <span className="shrink-0 text-[var(--lt-text)]">{p.name}</span>
            <span className="lt-meta min-w-0 flex-1 truncate">in {p.sessionTitle}</span>
          </Command.Item>
        ))}
      </Command.Group>
    ),
  };

  return (
    <div className="lt-overlay" data-lite="" role="dialog" aria-modal="true" aria-label="Command menu">
      <div className="lt-backdrop" onClick={close} aria-hidden />
      <Command
        className="lt-palette"
        label="Command menu"
        shouldFilter={false}
        loop
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="lt-palette-input">
          <Search aria-hidden />
          <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Search sessions, projects, people and actions" />
        </div>
        <Command.List>
          <Command.Empty>Nothing matches</Command.Empty>
          {groupOrder.map((key) => groups[key])}
        </Command.List>
        <div className="lt-palette-foot" aria-hidden>
          <span><KeyCap size="xs">↑</KeyCap><KeyCap size="xs">↓</KeyCap> Move</span>
          <span><KeyCap size="xs">↵</KeyCap> Open</span>
          <span><KeyCap size="xs">Esc</KeyCap> Close</span>
        </div>
      </Command>
    </div>
  );
}
