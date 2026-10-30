// The hooks behind Lite's collaboration surfaces, kept out of the component
// files (a module that exports anything but components is a failed Fast
// Refresh boundary, so every save would re-run its importers). Each reads the
// store through a narrow signature and keeps no copy of what it reads.
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useInboxStore } from "../../store/inboxStore";
import { useChatRail } from "../../hooks/useChatSync";
import { copyToClipboard, shareOrigin } from "../utils";
import { readLitePref, writeLitePref } from "./liteLayout";
import { liteSessionLinks } from "./collabShare";
import { liteMainChannelId, liteTeamChannels } from "./collabTeam";
import {
  liteTalkPeersSig,
  liteTalkSig,
  parseLiteTalkPeersSig,
  parseLiteTalkSig,
  resolveLiteTalkPeers,
  type LiteTalkPeer,
} from "./collabTalk";

/**
 * The sessions `sessionId` has talked with, resolved to a title and an owner,
 * the most recent exchange first. Two narrow subscriptions: the transcript's
 * talk signature (an ordinary streamed message leaves it alone) and the
 * resolved peers' signature (wakes when a title or an owner changes).
 */
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

/** Copy a link and say so. */
export function copyLiteLink(url: string, what = "Link copied"): void {
  void copyToClipboard(url)
    .then(() => toast.success(what))
    .catch(() => toast.error("Could not copy the link"));
}

/** One session's addresses from this window: Lite's own, the classic page,
 *  and the public link once there is a token. */
export function liteLinksOf(sessionId: string, token: string | null) {
  return liteSessionLinks({ appOrigin: window.location.origin, shareOrigin: shareOrigin(), id: sessionId, token });
}

/** The copy acts for a session's menu: its Lite link, and the public link
 *  when its owner has opened one. */
export function useLiteCopyLinks(sessionId: string): { copyLite: () => void; copyPublic: (() => void) | null } {
  const token = useInboxStore((s) => ((s.conversations[sessionId] as { share_token?: string | null } | undefined)?.share_token ?? null));
  return {
    copyLite: () => copyLiteLink(liteLinksOf(sessionId, null).lite),
    copyPublic: token ? () => copyLiteLink(liteLinksOf(sessionId, token).share!, "Public link copied") : null,
  };
}

/** The team's chat rooms and the one on screen: the viewer's last pick while
 *  it is still one of them (remembered per team, in this browser), else
 *  #general, else the busiest. */
export function useLiteTeamChannel(teamId: string) {
  const rail = useChatRail("team");
  const channels = useMemo(() => liteTeamChannels(rail), [rail]);
  const prefKey = `team-channel:${teamId}`;
  const [picked, setPicked] = useState<string | null>(() => readLitePref<string | null>(prefKey, null));
  const channelId = liteMainChannelId(channels, rail, picked);
  const pick = useCallback((id: string) => {
    setPicked(id);
    writeLitePref(prefKey, id);
  }, [prefKey]);
  return { channels, channelId, channel: channels.find((c) => c.id === channelId) ?? null, pick };
}

export type LiteTeamChannels = ReturnType<typeof useLiteTeamChannel>;
