// Share on a Lite session's header. The owner gets a Share button and a small
// popover: what the team sees (Hidden, Summary, Full), who can open the link
// (Restricted, Anyone) and the links to copy. Anyone else copies the link
// from the ⋯ menu, which every viewer has, so the bar keeps its room.
//
// The writes are the classic share popover's (ConversationSharePopover): the
// store's optimistic setPrivacy / setTeamVisibility (through
// useTeamShareActions, with its undo toast) and setShareLink with a token the
// caller mints. What differs is the press: widening who reads the session
// (raising the team level, opening the link to anyone) goes through the
// shared confirm flow (components/consequential SwitchReview) before
// anything is written; narrowing it stays one press. The review is held here,
// outside the popover, because the popover closes as the review takes focus.
import "./collab.css";
import { useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { Eye, EyeOff, Globe, Link2, List, Lock, Share2, Users } from "lucide-react";
import { policyTeamOf } from "@codecast/shared/contracts";
import { useInboxStore } from "../../../store/inboxStore";
import { useTeamShareActions } from "../../../hooks/useTeamShareActions";
import { usePolicyRefusal } from "../../../lib/managedPolicy";
import { sessionCardTitle } from "../../../lib/sessionCard";
import { copyLiteLink as copy, liteLinksOf as linksOf } from "../../../lib/lite/collabHooks";
import {
  LITE_TEAM_SHARE_WORDS,
  liteShareLinkLedger,
  liteShareWidens,
  liteTeamShareLedger,
  liteTeamShareOf,
  type LiteTeamShare,
} from "../../../lib/lite/collabShare";
import { SwitchReview, type SwitchLedger } from "../../consequential/ConsequentialSwitch";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";

type ShareFacts = {
  title: string;
  is_private?: boolean;
  team_visibility?: string;
  effective_team_visibility?: string;
  auto_shared?: boolean;
  share_token: string | null;
  team_id: string | null;
  teamName: string | null;
  teamOthers: number;
};

/** The few fields the share controls read, as primitives: a transcript flush
 *  that rewrites the row re-renders nothing here. The conversation's meta
 *  first (it carries the token), then the session row. */
function useShareFacts(sessionId: string): ShareFacts {
  return useInboxStore(useShallow((s) => {
    const meta = s.conversations[sessionId] as Record<string, any> | undefined;
    const row = s.sessions[sessionId] as Record<string, any> | undefined;
    const teamId = (meta?.team_id ?? row?.team_id ?? null) as string | null;
    const team = teamId ? (s.teams as Array<{ _id?: string; name?: string; member_count?: number }>).find((t) => t && String(t._id) === String(teamId)) : undefined;
    const src = row ?? meta;
    return {
      title: src ? sessionCardTitle(src as Parameters<typeof sessionCardTitle>[0]) : "Session",
      is_private: (meta?.is_private ?? row?.is_private) as boolean | undefined,
      team_visibility: (meta?.team_visibility ?? row?.team_visibility) as string | undefined,
      effective_team_visibility: meta?.effective_team_visibility as string | undefined,
      auto_shared: (meta?.auto_shared ?? row?.auto_shared) as boolean | undefined,
      share_token: (meta?.share_token ?? row?.share_token ?? null) as string | null,
      team_id: teamId ? String(teamId) : null,
      teamName: team?.name ?? null,
      teamOthers: Math.max(1, (team?.member_count ?? 2) - 1),
    };
  }));
}

/** Share, for the owner. */
export function LiteShareControl({ sessionId, isOwner }: { sessionId: string; isOwner: boolean }) {
  if (!isOwner) return null;
  return <LiteOwnerShare sessionId={sessionId} />;
}

const TEAM_OPTIONS: Array<{ value: LiteTeamShare; icon: typeof EyeOff }> = [
  { value: "private", icon: EyeOff },
  { value: "summary", icon: List },
  { value: "full", icon: Eye },
];

function LiteOwnerShare({ sessionId }: { sessionId: string }) {
  const facts = useShareFacts(sessionId);
  const { setPrivate, shareWithTeam } = useTeamShareActions(sessionId);
  const setShareLink = useInboxStore((s) => s.setShareLink);
  const refusal = usePolicyRefusal("public_sharing_disabled", policyTeamOf("conversations", facts));
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<{ ledger: SwitchLedger; run: () => void } | null>(null);

  const level = liteTeamShareOf(facts);
  const linkOpen = !!facts.share_token;
  const links = linksOf(sessionId, facts.share_token);

  const applyLevel = (next: LiteTeamShare) => (next === "private" ? setPrivate() : shareWithTeam(next));
  const pickLevel = (next: LiteTeamShare) => {
    if (next === level) return;
    if (!liteShareWidens(level, next)) return applyLevel(next);
    setOpen(false);
    setReview({
      ledger: liteTeamShareLedger({ title: facts.title, team: facts.teamName ?? "the team", others: facts.teamOthers, from: level, to: next }),
      run: () => applyLevel(next),
    });
  };
  const pickLink = (anyone: boolean) => {
    if (anyone === linkOpen) return;
    if (!anyone) {
      setShareLink(sessionId, null);
      toast.success("Link restricted");
      return;
    }
    setOpen(false);
    setReview({
      ledger: liteShareLinkLedger({ title: facts.title, refusal }),
      run: () => {
        const token = crypto.randomUUID();
        setShareLink(sessionId, token);
        copy(linksOf(sessionId, token).share!, "Link open and copied");
      },
    });
  };

  // The button says how far the session reaches, without opening it.
  const Reach = linkOpen ? Globe : level !== "private" ? Users : Lock;
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="lt-btn" aria-label="Share" title={linkOpen ? "Anyone with the link" : level !== "private" ? `Shared with the team: ${LITE_TEAM_SHARE_WORDS[level]}` : "Hidden from the team"}>
            <Reach aria-hidden />
            <span className="max-sm:sr-only">Share</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          data-lite=""
          className="lt-pop"
          tabIndex={-1}
          // The panel takes focus, not its first choice: a ring on "Hidden"
          // beside the real selection reads as a second one. Tab walks in.
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.focus?.(); }}
        >
          <div className="lt-pop-head">
            <b>Share</b>
            <span title={facts.title}>{facts.title}</span>
          </div>
          {facts.team_id && (
            <div className="lt-pop-section">
              <div className="lt-pop-label">
                <span>Team <b>{facts.teamName ?? ""}</b></span>
              </div>
              <div className="lt-seg" role="group" aria-label="What the team sees">
                {TEAM_OPTIONS.map(({ value, icon: Icon }) => (
                  <button key={value} type="button" aria-pressed={level === value} onClick={() => pickLevel(value)}>
                    <Icon aria-hidden />
                    {LITE_TEAM_SHARE_WORDS[value]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="lt-pop-section">
            <div className="lt-pop-label"><span>Link</span></div>
            <div className="lt-seg" role="group" aria-label="Who can open the link">
              <button type="button" aria-pressed={!linkOpen} onClick={() => pickLink(false)}>
                <Lock aria-hidden />
                Restricted
              </button>
              <button type="button" aria-pressed={linkOpen} disabled={!linkOpen && !!refusal} title={!linkOpen && refusal ? refusal : undefined} onClick={() => pickLink(true)}>
                <Globe aria-hidden />
                Anyone
              </button>
            </div>
          </div>
          <div className="lt-pop-foot">
            <button type="button" className="lt-btn" onClick={() => { setOpen(false); copy(links.lite); }}>
              <Link2 aria-hidden />
              Copy link
            </button>
            {links.share && (
              <button type="button" className="lt-btn" title={links.share} onClick={() => { setOpen(false); copy(links.share!, "Public link copied"); }}>
                <Share2 aria-hidden />
                Public link
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {review && (
        <SwitchReview
          ledger={review.ledger}
          onClose={() => setReview(null)}
          onConfirm={() => {
            const run = review.run;
            setReview(null);
            run();
          }}
        />
      )}
    </>
  );
}
