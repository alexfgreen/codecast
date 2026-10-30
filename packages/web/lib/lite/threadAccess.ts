// Who the viewer is to a Lite session: its owner, a teammate who may send
// into it, a share-link reader (who sends only on the owner's grant), or a
// reader. The rule is the server's own send rule (canSendProductMessage: the
// owner, or a team member of a team-visible session, or a shared viewer the
// owner granted; a hosted conversation only its owner), read off what the
// client holds: the viewer's own row says owner at once; anyone else waits
// for the conversation's access level, which its meta brings. Never off the
// row's team_id: that is routing (which team's feed it flows to) and grants
// nothing. Until the level arrives the access is not known, and nothing that
// sends is drawn. The server still decides every send.
import { useShallow } from "zustand/react/shallow";
import { isHostedAgentType } from "@codecast/shared/contracts";
import { isConvexId, useInboxStore } from "../../store/inboxStore";

export type LiteSessionAccess = {
  meId: string | null;
  /** The client knows yet: the viewer's own row, or the meta's access level. */
  known: boolean;
  isOwner: boolean;
  canSend: boolean;
  /** A share-link viewer: a send needs the owner's grant, which the
   *  collaboration composer asks for. */
  shared: boolean;
  ownerId: string | null;
  /** The owner's name when it is someone else ("Maya Kim"). */
  ownerName: string | null;
  /** Its first word ("Maya"), for the composer. */
  ownerFirstName: string | null;
};

type AccessRow = { user_id?: string | null; agent_type?: string; is_own?: boolean; access_level?: string; user?: { name?: string | null } | null };

export type LiteAccessVerdict = Pick<LiteSessionAccess, "known" | "isOwner" | "canSend" | "shared">;

export function liteSessionAccess(row: AccessRow | undefined, meta: AccessRow | undefined, meId: string | null, sessionId: string): LiteAccessVerdict {
  // A stub is the viewer's own new session, not yet on the server.
  if (!isConvexId(sessionId)) return { known: true, isOwner: true, canSend: true, shared: false };
  const ownerId = meta?.user_id ?? row?.user_id ?? null;
  const level = meta?.access_level;
  const isOwner = level === "owner" || meta?.is_own === true || (!!meId && !!ownerId && String(ownerId) === meId);
  if (isOwner) return { known: true, isOwner, canSend: true, shared: false };
  if (!level) return { known: false, isOwner: false, canSend: false, shared: false };
  if (isHostedAgentType(meta?.agent_type ?? row?.agent_type)) return { known: true, isOwner, canSend: false, shared: false };
  return { known: true, isOwner, canSend: level === "team", shared: level === "shared" };
}

export function useLiteSessionAccess(sessionId: string): LiteSessionAccess {
  return useInboxStore(useShallow((s) => {
    const meId = s.currentUser?._id ? String(s.currentUser._id) : null;
    const row = s.sessions[sessionId] as AccessRow | undefined;
    const meta = s.conversations[sessionId] as AccessRow | undefined;
    const access = liteSessionAccess(row, meta, meId, sessionId);
    let ownerName: string | null = null;
    const owner = meta?.user_id ?? row?.user_id;
    const ownerId = owner ? String(owner) : null;
    if (!access.isOwner && ownerId) {
      const member = (s.teamMembers as Array<{ _id?: string; name?: string }> | undefined)?.find((m) => String(m?._id) === ownerId);
      ownerName = member?.name?.trim() || meta?.user?.name?.trim() || null;
    }
    return { meId, ...access, ownerId, ownerName, ownerFirstName: ownerName?.split(/\s+/)[0] || null };
  }));
}
