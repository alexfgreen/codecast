// Codecast Lite's sidebar: where the viewer's work is and what needs them.
//
//   workspace ▾
//   [ Search                        ⌘K ]
//   ◆ Needs you                          3
//   # Team
//   PROJECTS
//   codecast                             ▾
//     ● Fix auth race               mac 2m
//   TEAMMATES
//   (MK) Maya
//     ● Ship mobile                     4m
//     ◇ Billing export                  9m   (waiting on Maya, not you)
//   (AG) Alex                ☾  Classic  ⚙
//
// It draws the shared model (lib/lite/useLiteSidebar) and owns no session
// data of its own. Arrow keys move between rows; Enter opens one.
import type { KeyboardEvent } from "react";
import Link from "next/link";
import { useLocation } from "react-router";
import { ArrowUpRight, ChevronDown, Diamond, Hash, Moon, Search, Settings, Sun } from "lucide-react";
import { useInboxStore } from "../../store/inboxStore";
import { useCoarseNow } from "../../hooks/useCoarseNow";
import { useTheme } from "../ThemeProvider";
import { MenuKeyCaps, ShortcutTooltip } from "../KeyboardShortcutsHelp";
import { useLiteLayout } from "../../lib/lite/liteLayout";
import { useLiteSidebarModel } from "../../lib/lite/useLiteSidebar";
import { LITE_PROJECT_CAP, liteAge, visibleRowsOf, type LiteProjectGroup } from "../../lib/lite/sidebarModel";
import { LiteAvatar, LiteNavRow, LiteSessionRow, LiteStatusMark } from "./LiteSidebarRows";
import { LiteWorkspaceSwitcher } from "./LiteWorkspaceSwitcher";

/** ArrowUp/Down, Home and End move focus between the sidebar's rows (links
 *  and project headers); focus moves, nothing opens until Enter. */
function moveRowFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-lt-nav]"));
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at === -1 && (e.key === "ArrowDown" || e.key === "ArrowUp")) return;
  e.preventDefault();
  const next = e.key === "Home" ? 0
    : e.key === "End" ? items.length - 1
    : Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
  items[next]?.focus();
}

export function LiteSidebar() {
  const model = useLiteSidebarModel();
  const { setPaletteOpen } = useLiteLayout();
  const pathname = useLocation().pathname;
  const now = useCoarseNow(15_000);

  return (
    <nav className="lt-sidebar" aria-label="Sessions">
      <div className="lt-side-head">
        {/* No New session control until Lite has a composer (the conversation
            wave): one that led to a page that cannot start a session would
            mislead. Home's empty state hands off to the classic app. */}
        <div className="flex items-center gap-1">
          <LiteWorkspaceSwitcher />
        </div>
        <button type="button" className="lt-search" onClick={() => setPaletteOpen(true)} aria-label="Search sessions, projects and people">
          <Search aria-hidden />
          <span className="flex-1 text-left">Search</span>
          <MenuKeyCaps action="palette.toggle" className="flex items-center gap-[2px]" />
        </button>
      </div>

      <div className="lt-scroll px-2 pb-3" onKeyDown={moveRowFocus}>
        <LiteNavRow
          href="/lite/needs-you"
          icon={<Diamond className="w-3.5 h-3.5" />}
          label="Needs you"
          count={model.needsYouCount}
          attention={model.needsYouCount > 0}
          active={pathname === "/lite/needs-you"}
        />
        {model.onTeam && (
          <LiteNavRow href="/lite/team" icon={<Hash className="w-3.5 h-3.5" />} label="Team" active={pathname === "/lite/team"} />
        )}

        <div className="lt-section-label" id="lt-projects-label">Projects</div>
        <div role="group" aria-labelledby="lt-projects-label">
          {model.projects.length === 0 ? (
            <div className="px-2 py-1 text-[13px] text-[var(--lt-text-3)]">No sessions yet</div>
          ) : (
            model.projects.map((group) => (
              <LiteProject
                key={group.key}
                group={group}
                collapsed={model.collapsed.has(group.key)}
                showingAll={model.showAll.has(group.key)}
                activeId={model.activeId}
                now={now}
                onToggle={model.toggleCollapsed}
                onShowAll={model.toggleShowAll}
              />
            ))
          )}
        </div>

        {model.onTeam && model.teammates.length > 0 && (
          <>
            <div className="lt-section-label" id="lt-teammates-label">Teammates</div>
            <div role="group" aria-labelledby="lt-teammates-label">
              {model.teammates.map((person) => (
                <div key={person.ownerId} role="group" aria-label={person.ownerName}>
                  <div className="lt-person">
                    <LiteAvatar name={person.ownerName} image={person.ownerImage} size={18} />
                    <span className="truncate">{person.ownerName}</span>
                  </div>
                  {person.rows.map((row) => (
                    <LiteSessionRow
                      key={row.id}
                      id={row.id}
                      title={row.title}
                      mark={row.mark}
                      markLabel={row.mark === "waiting" ? `Waiting on ${person.ownerName}` : undefined}
                      age={liteAge(row.activityAt, now)}
                      active={row.id === model.activeId}
                      nested
                    />
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <LiteSidebarFooter />
    </nav>
  );
}

function LiteProject({ group, collapsed, showingAll, activeId, now, onToggle, onShowAll }: {
  group: LiteProjectGroup;
  collapsed: boolean;
  showingAll: boolean;
  activeId: string | null;
  now: number;
  onToggle: (key: string) => void;
  onShowAll: (key: string) => void;
}) {
  const rows = visibleRowsOf(group, collapsed, activeId);
  const listId = `lt-project-${group.key}`;
  return (
    <div className="mt-0.5">
      <button
        type="button"
        className="lt-project"
        data-lt-nav=""
        aria-expanded={!collapsed}
        aria-controls={listId}
        title={group.detail}
        onClick={() => onToggle(group.key)}
      >
        <ChevronDown className="lt-chevron" aria-hidden />
        <span className="lt-row-title">{group.label}</span>
        {/* Closed, the project still says whether anything inside needs you. */}
        {collapsed && <LiteStatusMark mark={group.mark} />}
        {collapsed && <span className="lt-count">{group.all.length}</span>}
      </button>
      <div id={listId}>
        {rows.map((row) => (
          <LiteSessionRow
            key={row.id}
            id={row.id}
            title={row.title}
            mark={row.mark}
            machine={row.machine}
            age={liteAge(row.activityAt, now)}
            active={row.id === activeId}
            nested
          />
        ))}
        {!collapsed && (showingAll ? group.all.length > LITE_PROJECT_CAP : group.hiddenCount > 0) && (
          <button type="button" className="lt-more" onClick={() => onShowAll(group.key)}>
            {showingAll ? "Show fewer" : `Show ${group.hiddenCount} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function LiteSidebarFooter() {
  const user = useInboxStore((s) => s.currentUser) as { name?: string; email?: string; image?: string; github_avatar_url?: string } | null;
  const { theme, toggleTheme } = useTheme();
  const name = user?.name || user?.email || "You";
  const dark = theme === "dark";
  return (
    <div className="lt-side-foot">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
        <LiteAvatar name={name} image={user?.image || user?.github_avatar_url} size={22} />
        <span className="truncate text-[13px] font-medium">{name}</span>
      </div>
      <ShortcutTooltip label={dark ? "Light theme" : "Dark theme"} side="top">
        <button type="button" className="lt-icon-btn" onClick={toggleTheme} aria-label={dark ? "Use the light theme" : "Use the dark theme"}>
          {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
        </button>
      </ShortcutTooltip>
      <Link href="/inbox" className="lt-btn !h-7 !px-2 !border-transparent !bg-transparent" aria-label="Open the classic app">
        Classic
        <ArrowUpRight aria-hidden />
      </Link>
      <ShortcutTooltip label="Settings" side="top">
        <Link href="/settings" className="lt-icon-btn" aria-label="Settings">
          <Settings aria-hidden />
        </Link>
      </ShortcutTooltip>
    </div>
  );
}
