// The sessions this one has talked with (agents messaging each other with
// `cast send`), each a chip that opens it: its title and, when it is a
// teammate's, whose. Derived at read time from the transcript the store holds
// (lib/lite/collabTalk) and resolved through the store's own rows, so a
// session the client has never seen does not show. Two narrow
// subscriptions: the transcript's talk signature (which an ordinary streamed
// message leaves alone) and the resolved peers' signature (which wakes when a
// title or an owner changes).
import "./collab.css";
import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { useInboxStore } from "../../../store/inboxStore";
import { liteSessionPath } from "../../../lib/inboxRouting";
import {
  liteTalkPeersSig,
  liteTalkSig,
  parseLiteTalkPeersSig,
  parseLiteTalkSig,
  resolveLiteTalkPeers,
  type LiteTalkPeer,
} from "../../../lib/lite/collabTalk";

export function useLiteTalkedWith(sessionId: string): LiteTalkPeer[] {
  const talkSig = useInboxStore((s) => liteTalkSig(s.messages[sessionId]));
  const refs = useMemo(() => parseLiteTalkSig(talkSig), [talkSig]);
  const peersSig = useInboxStore((s) => {
    if (refs.length === 0) return "";
    const meId = s.currentUser?._id ? String(s.currentUser._id) : null;
    return liteTalkPeersSig(resolveLiteTalkPeers(s as Parameters<typeof resolveLiteTalkPeers>[0], refs, sessionId, meId));
  });
  return useMemo(() => parseLiteTalkPeersSig(peersSig), [peersSig]);
}

export function liteTalkPeerLabel(peer: LiteTalkPeer): string {
  const dir = peer.inbound && peer.outbound ? "Talked with" : peer.inbound ? "Heard from" : "Messaged";
  return `${dir} ${peer.owner ? `${peer.owner}'s ` : ""}${peer.title}`;
}

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
