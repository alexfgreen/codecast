// The ⋯ menu on a Lite session's header: who owns the session, its links,
// the collaboration acts (hand it to a teammate, connect it to another agent,
// message a teammate's agent), every session it has talked with, and the way
// to the classic view. The content mounts only while the menu is open, so the
// owners query (useOwnersFromStore → listOwners) runs only then. The dialogs
// the acts open live in the header, outside the menu, which unmounts on
// close.
import "./collab.css";
import { useRef } from "react";
import { useNavigate } from "react-router";
import { ArrowLeftRight, ArrowRightLeft, ArrowUpRight, Ellipsis, Link2, MessageSquarePlus, PenLine, Share2 } from "lucide-react";
import { isConvexId } from "../../../store/inboxStore";
import { liteSessionPath } from "../../../lib/inboxRouting";
import { useLiteSessionAccess } from "../../../lib/lite/threadAccess";
import { getLiteComposerHandle } from "../../../lib/lite/composerHandle";
import { liteNamesLabel } from "../../../lib/lite/collabPeople";
import { liteTalkPeerLabel, type LiteTalkPeer } from "../../../lib/lite/collabTalk";
import { useLiteCopyLinks } from "../../../lib/lite/collabHooks";
import { useOwnersFromStore } from "../../OwnersBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { LiteFaces } from "./LiteFaces";

const ICON = "w-4 h-4 text-[var(--lt-text-3)]";

export function LiteSessionMenu({ sessionId, talked, onHandoff, onMessageAgent }: {
  sessionId: string;
  talked: readonly LiteTalkPeer[];
  onHandoff: () => void;
  onMessageAgent: () => void;
}) {
  // "Message this agent" hands the keyboard to the composer: the menu would
  // otherwise give focus back to its trigger as it closes.
  const toComposer = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="lt-icon-btn" aria-label="More">
          <Ellipsis aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        data-lite=""
        className="lt-menu max-w-[320px]"
        onCloseAutoFocus={(e) => {
          if (!toComposer.current) return;
          toComposer.current = false;
          const composer = getLiteComposerHandle(sessionId);
          if (!composer) return;
          e.preventDefault();
          composer.focus();
        }}
      >
        <LiteSessionMenuItems
          sessionId={sessionId}
          talked={talked}
          onHandoff={onHandoff}
          onMessageAgent={onMessageAgent}
          onMessageThis={() => { toComposer.current = true; }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LiteSessionMenuItems({ sessionId, talked, onHandoff, onMessageAgent, onMessageThis }: {
  sessionId: string;
  talked: readonly LiteTalkPeer[];
  onHandoff: () => void;
  onMessageAgent: () => void;
  onMessageThis: () => void;
}) {
  const navigate = useNavigate();
  const access = useLiteSessionAccess(sessionId);
  const owners = useOwnersFromStore(sessionId);
  const { copyLite, copyPublic } = useLiteCopyLinks(sessionId);
  const real = isConvexId(sessionId);
  const ownerFaces = owners.ownerList.map((uid) => {
    const d = owners.displayFor(uid);
    return { id: uid, name: d.name, image: d.image ?? null };
  });
  // The owner, or anyone on the session's owner line, may pass it on.
  const canHand = real && (access.isOwner || (!!access.meId && owners.ownerIds.has(access.meId)));
  const canConnect = real && access.canSend;
  // A teammate's session the viewer may send into: their composer is right
  // there, and its placeholder says whose agent it reaches.
  const canMessageThis = real && access.canSend && !access.isOwner;

  return (
    <>
      {ownerFaces.length > 0 && (
        <>
          <div className="lt-menu-label">{ownerFaces.length === 1 ? "Owner" : "Owners"}</div>
          <div className="lt-menu-owners">
            <LiteFaces faces={ownerFaces} size={18} />
            <span title={ownerFaces.map((o) => o.name).join(", ")}>{liteNamesLabel(ownerFaces.map((o) => o.name))}</span>
          </div>
          <DropdownMenuSeparator className="lt-menu-sep" />
        </>
      )}
      <DropdownMenuItem className="lt-menu-item" onSelect={copyLite}>
        <Link2 className={ICON} aria-hidden />
        Copy link
      </DropdownMenuItem>
      {copyPublic && (
        <DropdownMenuItem className="lt-menu-item" onSelect={copyPublic}>
          <Share2 className={ICON} aria-hidden />
          Copy public link
        </DropdownMenuItem>
      )}
      {(canHand || canConnect || canMessageThis) && <DropdownMenuSeparator className="lt-menu-sep" />}
      {canHand && (
        <DropdownMenuItem className="lt-menu-item" onSelect={onHandoff}>
          <ArrowRightLeft className={ICON} aria-hidden />
          Hand to…
        </DropdownMenuItem>
      )}
      {canConnect && (
        <DropdownMenuItem className="lt-menu-item" onSelect={onMessageAgent}>
          <MessageSquarePlus className={ICON} aria-hidden />
          Message another agent…
        </DropdownMenuItem>
      )}
      {canMessageThis && (
        <DropdownMenuItem className="lt-menu-item" onSelect={onMessageThis}>
          <PenLine className={ICON} aria-hidden />
          <span className="lt-menu-text">Message {access.ownerFirstName ? `${access.ownerFirstName}'s` : "this"} agent</span>
        </DropdownMenuItem>
      )}
      {talked.length > 0 && (
        <>
          <DropdownMenuSeparator className="lt-menu-sep" />
          <div className="lt-menu-label">Talked with</div>
          {talked.map((p) => (
            <DropdownMenuItem key={p.id} className="lt-menu-item" title={liteTalkPeerLabel(p)} onSelect={() => navigate(liteSessionPath(p.id))}>
              <ArrowLeftRight className={ICON} aria-hidden />
              <span className="lt-menu-text">{p.title}</span>
              {p.owner && <span className="lt-menu-meta">{p.owner}</span>}
            </DropdownMenuItem>
          ))}
        </>
      )}
      <DropdownMenuSeparator className="lt-menu-sep" />
      {/* A plain router move: the compat router would turn /inbox?s= back into Lite. */}
      <DropdownMenuItem className="lt-menu-item" onSelect={() => navigate(`/inbox?s=${encodeURIComponent(sessionId)}`)}>
        <ArrowUpRight className={ICON} aria-hidden />
        Open in classic
      </DropdownMenuItem>
    </>
  );
}
