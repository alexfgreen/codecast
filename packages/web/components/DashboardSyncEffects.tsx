// The store's feeders and write wiring for one window, out of DashboardLayout
// so a shell that is not the dashboard (/welcome, /lite) mounts them without
// pulling the classic chrome's module graph into its chunk.
import { Suspense, lazy } from "react";
import { SeatKillDialog } from "./org/SeatKillDialog";
import { useSyncMetricSeries } from "../hooks/useMetricSeries";
import { HuddleStartHost } from "./calls/HuddleStartHost";
import { PANE_EMBED } from "../lib/browserPane";
import { useSyncMachineResources } from "../hooks/useResourceMonitor";
import { LocalDeviceProbe } from "../hooks/useLocalDeviceId";
import { useWallet } from "../hooks/useWallet";
import { useSyncViewerRoles } from "../hooks/useSyncViewerRoles";
import { useSyncAnchors } from "../hooks/useSyncAnchors";
import { useSyncTeamExternalEvents } from "../hooks/useSyncExternalEvents";
import { useSyncIssueSyncSources } from "../hooks/useSyncIssueSyncSources";
import { useAdoptTimezone } from "../hooks/useAdoptTimezone";
import { useSyncAgentDefinitions } from "../hooks/useSyncAgentDefinitions";
import { useSyncSecrets } from "../hooks/useSyncSecrets";
import { useSyncInitiatives } from "../hooks/useInitiatives";
import { useSyncOrgProposals } from "../hooks/useSyncOrgProposals";
import { useSyncOrgTreeFeeder } from "../hooks/useSyncOrgTree";
import { useWorkspaceFeature } from "../lib/teamFeatures";
import { useSyncSettings } from "../hooks/useSyncSettings";
import { useIsSyncHost, useSyncReplication } from "../hooks/useSyncRole";
import { useSessionCommandResults } from "../hooks/useSessionCommands";
import { useEnsureDispatch } from "../hooks/useEnsureDispatch";
import { usePendingMessageCoverage } from "../hooks/usePendingMessageCoverage";
import { ConnectToast } from "./simple/ConnectNotice";
import { useHostedMode } from "../lib/surfaces";
import { usePrefetch } from "../hooks/usePrefetch";
import { useSyncCore } from "../hooks/useSyncCore";
import { useSyncLiteTeamSessions } from "../hooks/useLiteTeammateSessions";
import { useChatChannelsSync } from "../hooks/useChatSync";
import { useThreadUnreadSync } from "../hooks/useThreadsSync";
import { ProfileSignInDialogHost } from "./ProfileSignInDialog";
import { useChatToasts } from "../hooks/useChatToasts";
import { ChatPrefetchFeeder } from "../hooks/useChatPrefetch";
import { useSyncDocs } from "../hooks/useSyncDocs";
import { ModRuntimes } from "./mods/ModRuntimes";
import { useSyncMods } from "../lib/mods/useMods";

const CallSyncEffects = lazy(() =>
  import("./calls/CallSyncEffects").then((module) => ({ default: module.CallSyncEffects })),
);

// Eager background-sync hooks isolated into their own component so a failing
// Convex query (e.g. an OOMing list query) throws HERE and is caught by the
// inline <ErrorBoundary> each shell wraps this in (DashboardLayoutInner,
// LiteShell) — degrading to "this data didn't prefetch" instead of taking
// down the entire shell.
// None of these power the core shell/conversation view; they warm stores.
// The global feeder set — everything that subscribes workspace-wide server
// data into the store. Mounted only while this window is the sync host (or its
// own solo host); a follower window receives the same slice over replication
// instead (store/syncReplication.ts), so mounting these there would only
// duplicate every subscription.
function HostFeeders() {
  // The tasks delta cursor machine: its empty deltas re-rendered the whole
  // layout when it lived in DashboardLayoutInner.
  usePrefetch();
  useSyncDocs();
  // THE feeder mount set (useSyncCore, sync-convergence C5): live window,
  // liveness overlay, recovery probes, team feeders, sync-log applier, the
  // decision queue and labels — one hook both platforms mount, so web and
  // mobile replicas are fed identically.
  useSyncCore("web");
  // Codecast Lite's teammates: the active team's sessions whatever the inbox
  // scope, fed here while any window of this account has Lite open (it holds
  // a Web Lock that says so), since a Lite tab often follows a classic host.
  useSyncLiteTeamSessions();
  // Chat's channel rail runs app-wide, not on the chat page: the sidebar badge,
  // the document title and the arrival toasts all read it, and a toast that only
  // fires while chat is open is a toast nobody needs.
  useChatChannelsSync();
  // The Threads badge: one scalar, every workspace, not chat-gated — comment
  // and task threads exist whether or not the team has chat on.
  useThreadUnreadSync();
  // The anchors collection feeds the header chip, the slide-over, the inbox's
  // anchor marks and chat's DM naming — one subscription for the whole shell.
  useSyncAnchors();
  // Every role the viewer can see, in any workspace: the one home of a role's
  // face and name, so a role from another workspace still wears its own.
  useSyncViewerRoles();
  // The team's git activity: the team feed reads it, and so does any page that
  // wants recent events without opening a scope of its own.
  useSyncTeamExternalEvents();
  // Imported Linear/GitHub containers. Small, workspace-wide and read by the
  // integrations panel and any project surface that shows where its tasks
  // came from — one subscription rather than one per opened card.
  useSyncIssueSyncSources();
  // Codecast mods: every mod the viewer can see; ModRuntimes runs the enabled ones.
  useSyncMods();
  // The workspace's metric series: the live numbers goals and projects read
  // wherever they are drawn (hooks/useMetricSeries), one subscription for all.
  useSyncMetricSeries();
  // A profile with no timezone takes this device's (team day cuts, local clocks).
  useAdoptTimezone();
  // Hosted mode's wallet: the rail's meter, Plan and the composer's held
  // month all read it, in every window, so the host feeds it whether or not
  // its own rail shows the meter.
  useWallet(useHostedMode());
  // The workspace's agent definitions and chains: the compose "as" chooser,
  // the settings library and the spawn actions all read them.
  useSyncAgentDefinitions();
  // Vault metadata: the Vault page and every sec-N reference read it.
  useSyncSecrets();
  // The workspace's initiatives: few rows, read by the list, a project's
  // line, the task board's axis and every `in-N` pill.
  useSyncInitiatives();
  // The rail's Org count (Waits on you) reads the org on every page: the
  // proposals, and the roles that map a decision's conversation to the role
  // that asked (org.roles, which reads no session, so it re-runs only when
  // the org changes). Without these a fresh device or a workspace switch
  // counts no decisions until Org is opened.
  const orgOn = useWorkspaceFeature("org");
  useSyncOrgProposals(orgOn);
  useSyncOrgTreeFeeder(undefined, orgOn);
  useSyncSettings();
  // Machine resource reports: the pressure notice and /resources read them.
  useSyncMachineResources();
  return null;
}

/** The store's feeders and write wiring for one window. Every shell that
 *  renders store data mounts this: the dashboard, /lite, and /welcome
 *  (components/simple/LaneSync), which passes `windowEffects={false}` because
 *  call rings, chat toasts and mods belong to the full app's window. */
export function DashboardSyncEffects({ windowEffects = !PANE_EMBED }: { windowEffects?: boolean } = {}) {
  // Cross-window replication: elect a sync host, follow one, or run solo.
  // Everything below the feeder gate still runs in every window — toasts,
  // calls and badges READ the store, which replication keeps fed.
  useSyncReplication(true);
  // Dispatch wiring is NOT a feeder: a follower still sends its own writes to
  // the server (replication only mirrors state). Ungated, in every window —
  // without this a follower's actions would park in the outbox until the
  // window happened to be promoted.
  useEnsureDispatch();
  usePendingMessageCoverage();
  const isSyncHost = useIsSyncHost();
  return <>
    {/* A browser pane's page shows a route; it is not a window. Toasts, the
        title badge and the call surfaces belong to the window AROUND it, and a
        second copy inside a pane doubles all three — the badge worst of all,
        since it rewrites the document title the pane reads for its strip.
        A component boundary rather than a conditional hook: PANE_EMBED cannot
        change while the document lives, but the rule stays visible. */}
    {windowEffects ? <WindowOnlyEffects /> : null}
    <SessionCommandResultsFeeder />
    <LocalDeviceProbe />
    {isSyncHost ? <HostFeeders /> : null}
    {isSyncHost ? <ChatPrefetchFeeder /> : null}
  </>;
}

/** Settles this window's daemon commands (restart, move, switch, hibernate)
 *  wherever they were asked from. The collection is per-window, so every
 *  window feeds its own: never host-gated. Its own component, so a new
 *  request re-renders only this. */
function SessionCommandResultsFeeder() {
  useSessionCommandResults();
  return null;
}

/** What belongs to a window rather than to a route: unread toasts, the title
 *  badge, the call surfaces. */
function WindowOnlyEffects() {
  useChatToasts();
  return <><Suspense fallback={null}><CallSyncEffects /></Suspense><SeatKillDialog /><HuddleStartHost /><ProfileSignInDialogHost /><ModRuntimes /><ConnectToast /></>;
}
