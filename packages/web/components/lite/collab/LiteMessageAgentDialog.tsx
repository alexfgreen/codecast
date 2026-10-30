// Connect this session to another agent: pick a session (yours, or a
// teammate's the team can see), and this session's composer gets a reference
// to it with the caret after it. The person says what to ask, and their own
// agent runs `cast send`, so the exchange lands as cards in both threads.
// Who can be reached is the server's rule, unchanged: the list holds only
// sessions the client already shows (the viewer's own and the team's live
// ones, lib/lite/useLiteSidebar's teammates), and the send is checked again
// where it runs.
//
// The ranking is the Lite palette's (lib/instantSessionSearch rankSessions
// over the same pool); at rest it lists the most recently active. Each hit
// wears the session's one mark, the sidebar model's (useLiteSidebarModel's
// marks), so the picker never disagrees with the sidebar or the header.
import "./collab.css";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { isConvexId, isForeignRow, isSub, ownTeamRowsSig, useTrackedStore, type InboxSession } from "../../../store/inboxStore";
import { useCoarseNow } from "../../../hooks/useCoarseNow";
import { liteTeammateSessionIds } from "../../../hooks/useLiteFeeders";
import { rankSessions, searchableSessionsSig, sessionStanding } from "../../../lib/instantSessionSearch";
import { sessionCardTitle } from "../../../lib/sessionCard";
import { copyToClipboard } from "../../../lib/utils";
import { liteAge } from "../../../lib/lite/sidebarModel";
import { useLiteSidebarModel, type LiteSessionMark } from "../../../lib/lite/useLiteSidebar";
import { liteAgentMessagePrompt } from "../../../lib/lite/collabTalk";
import { getLiteComposerHandle } from "../../../lib/lite/composerHandle";
import { LiteStatusMark } from "../LiteSidebarRows";
import { LiteDialog } from "./LiteDialog";

const REST_LIMIT = 12;
const HIT_LIMIT = 20;

type Hit = { row: InboxSession; title: string; owner: string | null; mark: LiteSessionMark; age: string };

const NO_MARK: LiteSessionMark = { mark: null, label: null };

export function LiteMessageAgentDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query).trim().toLowerCase();
  const now = useCoarseNow(15_000);
  const s = useTrackedStore([
    (st) => searchableSessionsSig(st.sessions),
    (st) => ownTeamRowsSig(st.sessions),
    (st) => st.currentUser?._id,
    (st) => st.clientState.ui?.active_team_id,
    (st) => st.teamInboxIds,
    (st) => st.teamInboxIdSnapshot?.team_id,
  ]);
  const meId = s.currentUser?._id ? String(s.currentUser._id) : null;
  const activeTeamId = (s.clientState.ui?.active_team_id as string | undefined) ?? null;
  const { marks } = useLiteSidebarModel();

  // The viewer's own top-level sessions and the team's live ones, this one
  // and any not yet on the server (a stub has no id to send to) left out.
  const pool = useMemo(() => {
    const teammates = activeTeamId ? new Set(liteTeammateSessionIds(s, activeTeamId, meId)) : new Set<string>();
    const out: InboxSession[] = [];
    for (const row of Object.values(s.sessions)) {
      if (!row || row._id === sessionId || !isConvexId(row._id) || isSub(row)) continue;
      if (!isForeignRow(row, meId) || teammates.has(row._id)) out.push(row);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signatures stand in for the churny map
  }, [searchableSessionsSig(s.sessions), ownTeamRowsSig(s.sessions), meId, activeTeamId, s.teamInboxIds, s.teamInboxIdSnapshot?.team_id, sessionId]);

  const hits = useMemo<Hit[]>(() => {
    const rows = q
      ? rankSessions(pool, q, (row) => sessionStanding(row, meId, row), HIT_LIMIT)
      : [...pool].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0)).slice(0, REST_LIMIT);
    return rows.map((row) => {
      const mine = !isForeignRow(row, meId);
      const owner = mine ? null : row.author_name?.trim().split(/\s+/)[0] || null;
      return { row, title: sessionCardTitle(row), owner, mark: marks.get(row._id) ?? NO_MARK, age: liteAge(row.updated_at, now) };
    });
  }, [pool, q, meId, now, marks]);

  // Focus goes to the composer on close, not back to the menu that opened us.
  const toComposer = useRef(false);
  const pick = (hit: Hit) => {
    const shortId = ((hit.row as { short_id?: string }).short_id || hit.row._id.slice(0, 7)).toLowerCase();
    const text = liteAgentMessagePrompt({ shortId, title: hit.title, owner: hit.owner });
    const composer = getLiteComposerHandle(sessionId);
    if (composer) {
      composer.populate(text);
      toComposer.current = true;
    } else {
      // No box to fill (a permission prompt stands in its place): the words
      // wait on the clipboard instead.
      void copyToClipboard(text).then(() => toast.success("Copied for the composer")).catch(() => toast.error("Could not copy"));
    }
    onClose();
  };

  return (
    <LiteDialog
      title="Message another agent"
      label="Message another agent"
      onClose={onClose}
      onCloseAutoFocus={(e) => {
        if (!toComposer.current) return;
        e.preventDefault();
        getLiteComposerHandle(sessionId)?.focus();
      }}
    >
      <Command label="Sessions" shouldFilter={false} loop className="flex min-h-0 flex-1 flex-col">
        <div className="lt-dialog-search">
          <Search aria-hidden />
          <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Find a session" />
        </div>
        <Command.List>
          <Command.Empty>{pool.length === 0 ? "No other sessions to reach" : "Nothing matches"}</Command.Empty>
          {hits.length > 0 && (
            <Command.Group heading={q ? "Sessions" : "Recent"}>
              {hits.map((hit) => (
                <Command.Item key={hit.row._id} value={hit.row._id} onSelect={() => pick(hit)}>
                  <LiteStatusMark mark={hit.mark.mark} label={hit.mark.label} />
                  <span className="flex-1 truncate text-[var(--lt-text)]">{hit.title}</span>
                  <span className="lt-meta max-w-[120px] truncate">{hit.owner ?? "You"}</span>
                  <span className="lt-meta">{hit.age}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </LiteDialog>
  );
}
