// The sessions this one has talked with (agents messaging each other with
// `cast send`), each a chip that opens it: its title and, when it is a
// teammate's, whose. The list is derived at read time from the transcript the
// store holds and resolved through the store's own rows (useLiteTalkedWith,
// lib/lite/collabHooks), so a session the client has never seen does not
// show.
import "./collab.css";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { liteSessionPath } from "../../../lib/inboxRouting";
import { liteTalkPeerLabel, type LiteTalkPeer } from "../../../lib/lite/collabTalk";

/** Up to `max` chips, the most recent exchange first. The rest live in the
 *  session's ⋯ menu, which lists them all. */
export function LiteTalkedWithChips({ peers, max = 3, className }: { peers: readonly LiteTalkPeer[]; max?: number; className?: string }) {
  if (peers.length === 0) return null;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className ?? ""}`} aria-label="Talked with">
      {peers.slice(0, max).map((p) => (
        <Link key={p.id} href={liteSessionPath(p.id)} className="lt-chip" title={liteTalkPeerLabel(p)}>
          <ArrowLeftRight aria-hidden />
          <span>{p.title}</span>
          {p.owner && <span className="lt-chip-owner">{p.owner}</span>}
        </Link>
      ))}
    </span>
  );
}
