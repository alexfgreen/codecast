// Sharing one Lite session, as data: what each level shows, which changes
// widen who can read it, and the review each widening goes through. Opening a
// session to more people is a consequential press (components/consequential):
// it opens the shared review before anything is written. Narrowing it is one
// press, since stopping is the safe direction. The writes themselves are the
// store's own share actions (setTeamVisibility, setPrivacy, setShareLink),
// the same ones the classic share popover makes.
import type { SwitchLedger } from "../../components/consequential/ConsequentialSwitch";
import { liteSessionPath } from "../inboxRouting";

export type LiteTeamShare = "private" | "summary" | "full";

const RANK: Record<LiteTeamShare, number> = { private: 0, summary: 1, full: 2 };

export const LITE_TEAM_SHARE_WORDS: Record<LiteTeamShare, string> = {
  private: "Hidden",
  summary: "Summary",
  full: "Full",
};

/** The level a session sits at, the classic popover's own reading: a row with
 *  no privacy flag is private, and a shared one without a level shows its
 *  summary. */
export function liteTeamShareOf(row: { is_private?: boolean | null; team_visibility?: string | null; effective_team_visibility?: string | null } | null | undefined): LiteTeamShare {
  if (!row || row.is_private !== false) return "private";
  const level = row.team_visibility || row.effective_team_visibility;
  return level === "full" ? "full" : level === "private" ? "private" : "summary";
}

/** Whether moving from one level to the other lets more people read more. */
export function liteShareWidens(from: LiteTeamShare, to: LiteTeamShare): boolean {
  return RANK[to] > RANK[from];
}

/** The review for widening a session's team level. */
export function liteTeamShareLedger(r: { title: string; team: string; others: number; from: LiteTeamShare; to: LiteTeamShare }): SwitchLedger {
  const full = r.to === "full";
  return {
    name: `Share with ${r.team}`,
    subject: r.title,
    shift: [LITE_TEAM_SHARE_WORDS[r.from], LITE_TEAM_SHARE_WORDS[r.to]],
    figures: [{ value: String(Math.max(1, r.others)), label: r.others === 1 ? "teammate reads" : "teammates read", tone: "warn" }],
    rows: [
      { k: "They see", v: full ? "The whole transcript" : "Title and summary", tone: full ? "warn" : undefined },
      { k: "Team feed", v: "Listed" },
      { k: "Other sessions", v: "Unchanged", tone: "ok" },
    ],
    stop: "Share › Hidden",
    confirm: full ? "Share in full" : "Share summary",
    keep: "Not now",
  };
}

/** The review for opening a session's link to anyone who has it. `refusal`
 *  is the workspace policy that forbids it, when one does. */
export function liteShareLinkLedger(r: { title: string; refusal?: string | null }): SwitchLedger {
  return {
    name: "Anyone with the link",
    subject: r.title,
    shift: ["Restricted", "Anyone"],
    figures: [],
    rows: [
      { k: "Who reads", v: "Anyone with the link", tone: "warn" },
      { k: "Sign in", v: "Not needed", tone: "warn" },
      { k: "They see", v: "The whole transcript" },
      { k: "They send", v: "Only once you allow it", tone: "ok" },
    ],
    stop: "Share › Restricted",
    confirm: "Open the link",
    keep: "Keep restricted",
    ...(r.refusal ? { blocked: r.refusal } : {}),
  };
}

/** The addresses of one session: Lite's own, the classic page (opens for
 *  anyone who can already see it) and, once the owner opened it, the link
 *  that carries its token (a bare id grants nothing to anyone else). */
export function liteSessionLinks(r: { appOrigin: string; shareOrigin: string; id: string; token?: string | null }): { lite: string; page: string; share: string | null } {
  const page = `${r.shareOrigin}/conversation/${r.id}`;
  return {
    lite: `${r.appOrigin}${liteSessionPath(r.id)}`,
    page,
    share: r.token ? `${page}?share=${encodeURIComponent(r.token)}` : null,
  };
}
