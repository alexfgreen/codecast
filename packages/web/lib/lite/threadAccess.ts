// Who the viewer is to a Lite session: its owner, a teammate who may send
// into it, or a reader. The rule is the server's own send rule
// (canSendProductMessage: the owner set, or a team member of a team-visible
// session; a hosted conversation only its owner), read off what the client
// holds: the conversation's access level once its meta has loaded, and until
// then the row itself (a teammate's row reached the store through the team
// feed, so the team can see it). The server still decides every send.
import { useShallow } from "zustand/react/shallow";
import { isHostedAgentType } from "@codecast/shared/contracts";
import { isConvexId, useInboxStore } from "../../store/inboxStore";

export type LiteSessionAccess = {
  meId: string | null;
  isOwner: boolean;
  canSend: boolean;
  /** The owner's first name when it is someone else ("Maya"), for the composer. */
  ownerFirstName: string | null;
};

type AccessRow = { user_id?: string | null; team_id?: string | null; agent_type?: string; is_own?: boolean; access_level?: string };

export function liteSessionAccess(row: AccessRow | undefined, meta: AccessRow | undefined, meId: string | null, sessionId: string): Omit<LiteSessionAccess, "ownerFirstName" | "meId"> {
  // A stub is the viewer's own new session, not yet on the server.
  if (!isConvexId(sessionId)) return { isOwner: true, canSend: true };
  const ownerId = meta?.user_id ?? row?.user_id ?? null;
  const level = meta?.access_level;
  const isOwner = level === "owner" || meta?.is_own === true || !ownerId || (!!meId && String(ownerId) === meId);
  if (isOwner) return { isOwner, canSend: true };
  const hosted = isHostedAgentType(meta?.agent_type ?? row?.agent_type);
  if (hosted) return { isOwner, canSend: false };
  if (level) return { isOwner, canSend: level === "team" };
  return { isOwner, canSend: !!(row?.team_id ?? meta?.team_id) };
}

export function useLiteSessionAccess(sessionId: string): LiteSessionAccess {
  return useInboxStore(useShallow((s) => {
    const meId = s.currentUser?._id ? String(s.currentUser._id) : null;
    const row = s.sessions[sessionId] as AccessRow | undefined;
    const meta = s.conversations[sessionId] as AccessRow | undefined;
    const access = liteSessionAccess(row, meta, meId, sessionId);
    let ownerFirstName: string | null = null;
    if (!access.isOwner) {
      const ownerId = String(meta?.user_id ?? row?.user_id ?? "");
      const member = (s.teamMembers as Array<{ _id?: string; name?: string }> | undefined)?.find((m) => String(m?._id) === ownerId);
      ownerFirstName = member?.name?.trim().split(/\s+/)[0] || null;
    }
    return { meId, ...access, ownerFirstName };
  }));
}
