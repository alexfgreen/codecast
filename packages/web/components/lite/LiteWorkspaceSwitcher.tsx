// The sidebar's workspace picker: Personal or one of the viewer's teams. It
// switches through useSwitchWorkspace, the one writer of both halves of the
// active-team pointer, so the classic app, the phone and the CLI all follow.
import { Check, ChevronDown, User } from "lucide-react";
import { useInboxStore } from "../../store/inboxStore";
import { useSwitchWorkspace } from "../../hooks/useSwitchWorkspace";
import { TeamCrest } from "../team/TeamCrest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

type TeamRow = { _id: string; name?: string; icon?: string; icon_color?: string } | null | undefined;

export function LiteWorkspaceSwitcher() {
  const teams = useInboxStore((s) => s.teams) as TeamRow[];
  const activeTeamId = useInboxStore((s) => s.clientState.ui?.active_team_id) as string | undefined;
  const switchWorkspace = useSwitchWorkspace();
  const active = teams.find((t) => t?._id === activeTeamId) ?? null;
  const label = active?.name || "Personal";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="lt-row min-w-0 flex-1 !h-8 font-medium !text-[var(--lt-text)]" aria-label={`Workspace: ${label}. Switch workspace`}>
          {active ? (
            <TeamCrest icon={active.icon} color={active.icon_color} size="sm" className="!w-5 !h-5 !rounded" />
          ) : (
            <span className="lt-avatar" style={{ width: 20, height: 20 }} aria-hidden><User className="w-3 h-3" /></span>
          )}
          <span className="lt-row-title">{label}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[var(--lt-text-3)]" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-lite="" className="lt-menu">
        <DropdownMenuLabel className="lt-menu-label">Workspace</DropdownMenuLabel>
        <DropdownMenuItem className="lt-menu-item" onSelect={() => void switchWorkspace(null)}>
          <User className="w-4 h-4 text-[var(--lt-text-3)]" aria-hidden />
          <span className="flex-1">Personal</span>
          {!active && <Check className="w-4 h-4 text-[var(--lt-accent)]" aria-label="Current" />}
        </DropdownMenuItem>
        {teams.some(Boolean) && <DropdownMenuSeparator className="lt-menu-sep" />}
        {teams.map((team) => team && (
          <DropdownMenuItem key={team._id} className="lt-menu-item" onSelect={() => void switchWorkspace(team._id)}>
            <TeamCrest icon={team.icon} color={team.icon_color} size="sm" className="!w-5 !h-5 !rounded" />
            <span className="flex-1 truncate">{team.name}</span>
            {team._id === activeTeamId && <Check className="w-4 h-4 text-[var(--lt-accent)]" aria-label="Current" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
