// /lite/team: the active team, its people and their live work. Wave 1 holds
// the place; the page lands with the collaboration wave. The personal
// workspace has no team, so there the address goes home.
import { Navigate } from "react-router";
import { useInboxStore } from "@/store/inboxStore";
import { LiteTopbar } from "@/components/lite/LiteTopbar";

export default function LiteTeamPage() {
  const teamName = useInboxStore((s) => {
    const id = s.clientState.ui?.active_team_id;
    return id ? (s.teams.find((t) => t?._id === id)?.name as string | undefined) ?? "Team" : null;
  });
  if (teamName === null) return <Navigate to="/lite" replace />;
  return (
    <>
      <LiteTopbar>
        <span className="text-[14px] font-medium">{teamName}</span>
      </LiteTopbar>
      <div className="lt-scroll">
        <div className="lt-content lt-empty">
          <h1>{teamName}</h1>
          <div data-lite-placeholder="">The team page lands in the collaboration wave</div>
        </div>
      </div>
    </>
  );
}
