import { useCallback, useState } from "react";
import { useInboxStore, isConvexId, type InboxSession } from "../store/inboxStore";
import { useTeamSessionsFeed } from "./useSyncTeamInboxSessions";
import { useInterval } from "./useInterval";
import { onSyncWake } from "./syncWake";
import { useWatchEffect } from "./useWatchEffect";

// Codecast Lite shows the active team's live sessions whatever the classic
// inbox's scope. The subscription is a global feed, so only the sync host
// runs it (docs/architecture/sync-host.md), and the host is often a classic
// window that mounts nothing of Lite: a Lite tab opened beside a classic one
// follows it. So a Lite window says it is open by holding a shared Web Lock,
// and the host, whichever shell it is, feeds the team's rows while any window
// holds one. The rows replicate to every window like any other session row.

const LITE_LOCK = "codecast-lite-open";
/** How often the host re-reads whether a Lite window is open. A Lite window
 *  that opens is fed within this; one that closes stops costing within it. */
const LITE_POLL_MS = 5_000;

/** Scoped to the account like the host's own lock: a Lite window signed in as
 *  someone else must not make this account's host feed anything. */
function liteLockName(principalId: string): string {
  return `${LITE_LOCK}:${principalId}`;
}

/** Locks this document holds. A host that is itself the Lite window learns
 *  of its own at once through these, without waiting for a poll; a browser
 *  with no LockManager has nothing else, and there every window is its own
 *  solo host, so its own Lite is the only one it needs to see. */
const heldHere = new Set<string>();
const heldHereListeners = new Set<() => void>();

function setHeldHere(name: string, held: boolean): void {
  if (held) heldHere.add(name);
  else heldHere.delete(name);
  for (const listener of heldHereListeners) listener();
}

function onHeldHereChange(listener: () => void): () => void {
  heldHereListeners.add(listener);
  return () => { heldHereListeners.delete(listener); };
}

function locksApi(): LockManager | undefined {
  return typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
}

/** Mounted by the Lite shell: holds its open-lock while mounted. */
export function useLitePresenceLock(): void {
  const principal = useInboxStore((s) => s.currentUser?._id?.toString?.() ?? null);
  useWatchEffect(() => {
    if (!principal) return;
    const name = liteLockName(principal);
    setHeldHere(name, true);
    const abort = new AbortController();
    let release: (() => void) | null = null;
    locksApi()?.request(name, { mode: "shared", signal: abort.signal }, () => {
      // Held until unmount; a grant landing after it returns at once.
      if (abort.signal.aborted) return;
      return new Promise<void>((resolve) => { release = resolve; });
    }).catch(() => {});
    return () => {
      setHeldHere(name, false);
      abort.abort();
      release?.();
    };
  }, [principal]);
}

/** Whether any window of this account has Lite open, this one included. */
function useLiteOpenAnywhere(enabled: boolean): boolean {
  const principal = useInboxStore((s) => s.currentUser?._id?.toString?.() ?? null);
  const [open, setOpen] = useState(false);
  const check = useCallback(() => {
    if (!enabled || !principal) {
      setOpen(false);
      return;
    }
    const name = liteLockName(principal);
    const locks = locksApi();
    if (heldHere.has(name) || !locks?.query) {
      setOpen(heldHere.has(name));
      return;
    }
    locks.query().then(
      (snapshot) => setOpen(!!snapshot.held?.some((lock) => lock.name === name)),
      () => setOpen(false),
    );
  }, [enabled, principal]);
  useWatchEffect(() => {
    check();
    const offWake = onSyncWake(check);
    const offHeld = onHeldHereChange(check);
    return () => { offWake(); offHeld(); };
  }, [check]);
  useInterval(check, LITE_POLL_MS, enabled && !!principal);
  return open;
}

/**
 * The host's feed of the active team's sessions for Codecast Lite, mounted in
 * HostFeeders beside the classic team board's own (useSyncCore). Same list and
 * overlay as the board, but the rows land in the sessions cache and nothing
 * else: no teamInboxIds, which belongs to the board's scope. Lite derives a
 * teammate's row from the row itself at read time (liteTeammateSessionIds).
 * No team, no feed: the personal workspace has no teammates.
 */
export function useSyncLiteTeamSessions(): void {
  const activeTeamId = useInboxStore((s) => s.clientState.ui?.active_team_id) as string | undefined;
  // A freshly created team holds an optimistic stub id until the server
  // echoes; a stub is not an Id<"teams">, so skip rather than throw.
  const teamId = activeTeamId && isConvexId(String(activeTeamId)) ? activeTeamId : undefined;
  const liteOpen = useLiteOpenAnywhere(!!teamId);
  useTeamSessionsFeed(teamId, !!teamId && liteOpen, useCallback((data: any) => {
    const sessions = data?.sessions;
    if (!Array.isArray(sessions)) return false;
    useInboxStore.getState().syncTable("sessions", sessions as unknown as InboxSession[]);
    return true;
  }, []));
}
