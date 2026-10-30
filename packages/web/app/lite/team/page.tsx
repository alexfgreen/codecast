// /lite/team: the active team in one place. The top bar names the team and
// shows who is online; the page under it is the team's chat (one room at a
// time, a switcher instead of a rail) when the team has chat on, and the
// team's activity feed (teammates' sessions, newest first) when it does not.
// The personal workspace has no team, so there the address goes home. A part
// that fails says so, with Retry and the classic page; "no channels" is said
// only once the server's rail has answered, never from an empty cache.
import "@/components/lite/collab/collab.css";
import { useMemo, useSyncExternalStore } from "react";
import { Navigate, useNavigate } from "react-router";
import Link from "next/link";
import { useTrackedStore } from "@/store/inboxStore";
import { useTeamFeature } from "@/lib/teamFeatures";
import { liteSessionPath } from "@/lib/inboxRouting";
import { liteFaceOf, liteNamesLabel, liteOnlineTeammates, type LiteMember } from "@/lib/lite/collabPeople";
import { LiteTopbar } from "@/components/lite/LiteTopbar";
import { LiteFaces } from "@/components/lite/collab/LiteFaces";
import { LiteChannelSelect, LiteTeamRoom } from "@/components/lite/collab/LiteTeamChat";
import { useLiteTeamChannel } from "@/lib/lite/collabHooks";
import { isChatRailLive, subscribeChatRailLive } from "@/lib/chatLive";
import { ActivityFeed } from "@/components/ActivityFeed";
import { ErrorBoundary } from "@/components/ErrorBoundary";

type TeamRow = { _id?: string; name?: string };

const meIdOf = (s: { currentUser?: { _id?: unknown } | null }) => (s.currentUser?._id ? String(s.currentUser._id) : null);

// Who is online, as a wake signature: a presence push that moves nobody in
// or out (or a heartbeat inside the same state) re-renders nothing.
function onlineSig(members: readonly LiteMember[] | null | undefined, meId: string | null): string {
  return liteOnlineTeammates(members, meId).map((m) => `${m._id}:${m.presence}`).join(",");
}

export default function LiteTeamPage() {
  const s = useTrackedStore([
    (st) => st.clientState.ui?.active_team_id,
    (st) => (st.teams as TeamRow[]).find((t) => t?._id === st.clientState.ui?.active_team_id)?.name,
    (st) => onlineSig(st.teamMembers as LiteMember[], meIdOf(st)),
  ]);
  const teamId = (s.clientState.ui?.active_team_id as string | undefined) ?? null;
  const teamName = teamId ? ((s.teams as TeamRow[]).find((t) => t?._id === teamId)?.name ?? "Team") : null;
  const sig = onlineSig(s.teamMembers as LiteMember[], meIdOf(s));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature stands in for the roster
  const online = useMemo(() => liteOnlineTeammates(s.teamMembers as LiteMember[], meIdOf(s)).map(liteFaceOf), [sig]);
  if (!teamId || teamName === null) return <Navigate to="/lite" replace />;
  return <LiteTeamBody teamId={teamId} teamName={teamName} online={online} />;
}

/** What a failed part of the page shows: that it failed, Retry, and the
 *  classic page that holds the same thing. */
function LiteTeamFailed({ retry, href }: { retry: () => void; href: string }) {
  return (
    <div className="lt-content lt-empty">
      <div className="flex items-center justify-center gap-3" data-lite-placeholder="">
        Couldn't load the team
        <button type="button" className="lt-btn" onClick={retry}>Retry</button>
        <Link href={href} className="lt-btn">Open in classic</Link>
      </div>
    </div>
  );
}

function LiteTeamBody({ teamId, teamName, online }: { teamId: string; teamName: string; online: ReturnType<typeof liteFaceOf>[] }) {
  const chatOn = useTeamFeature("chat");
  const navigate = useNavigate();
  const room = useLiteTeamChannel(teamId);
  // The server's rail has answered in this page load: only then is an empty
  // one known to be empty.
  const railLive = useSyncExternalStore(subscribeChatRailLive, isChatRailLive, () => false);
  return (
    <>
      <LiteTopbar>
        <span className="min-w-0 truncate text-[14px] font-medium">{teamName}</span>
        {online.length > 0 && (
          <LiteFaces faces={online} max={5} label={`${liteNamesLabel(online.map((f) => f.name))} online`} />
        )}
        <span className="flex-1" />
        {chatOn && <LiteChannelSelect channels={room.channels} channelId={room.channelId} onPick={room.pick} />}
      </LiteTopbar>
      {chatOn ? (
        <div className="lt-team-body">
          <ErrorBoundary name="LiteTeamChat" level="inline" fallback={({ retry }) => <LiteTeamFailed retry={retry} href="/chat" />}>
            {room.channel ? (
              <LiteTeamRoom key={room.channel.id} room={room.channel} />
            ) : railLive ? (
              <div className="lt-content lt-empty">
                <div className="flex items-center justify-center gap-3" data-lite-placeholder="">
                  No team channels yet
                  <Link href="/chat" className="lt-btn">Open chat</Link>
                </div>
              </div>
            ) : null}
          </ErrorBoundary>
        </div>
      ) : (
        <div className="lt-scroll">
          <div className="lt-content lt-team-feed">
            <ErrorBoundary name="LiteTeamFeed" level="inline" fallback={({ retry }) => <LiteTeamFailed retry={retry} href="/feed" />}>
              <ActivityFeed mode="team" compact hidePeopleRow onNavigate={(id) => navigate(liteSessionPath(id))} />
            </ErrorBoundary>
          </div>
        </div>
      )}
    </>
  );
}
