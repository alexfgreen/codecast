// /lite/team: the active team, its people and their live work. Wave 1 holds
// the place; the page lands with the collaboration wave.
import { useInboxStore } from "@/store/inboxStore";
import { LiteTopbar } from "@/components/lite/LiteTopbar";

export default function LiteTeamPage() {
  const teamName = useInboxStore((s) => {
    const id = s.clientState.ui?.active_team_id;
    return id ? (s.teams.find((t) => t?._id === id)?.name as string | undefined) ?? "Team" : null;
  });
  return (
    <>
      <LiteTopbar>
        <span className="text-[14px] font-medium">{teamName ?? "Team"}</span>
      </LiteTopbar>
      <div className="lt-scroll">
        <div className="lt-content lt-empty">
          <h1>{teamName ?? "Personal workspace"}</h1>
          <div data-lite-placeholder="">{teamName ? "The team page lands in the collaboration wave" : "Switch to a team to see it here"}</div>
        </div>
      </div>
    </>
  );
}
