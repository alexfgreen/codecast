// Who is around a Lite session or team, as faces. A small stack of round
// faces (three, then "+N"), the names in its tooltip; and, on a session, a
// quiet chip naming whoever is forming words in its composer right now.
//
// The faces on a session are the teammates viewing it this minute: the
// roster's viewing field, which each teammate's own window reports
// (usePresenceReporter follows /lite/<id> too). One subscription on the
// viewer-id signature, so a roster push that changes nothing about who is
// here re-renders nothing. The typing chip reads the composer's presence rows
// (compose:<id>), which only someone in the box writes; a solo session costs
// one silent subscription. Neither keeps a copy of anything.
import "./collab.css";
import { memo, useMemo } from "react";
import { useConvexAuth } from "convex/react";
import { PenLine } from "lucide-react";
import { isConvexId, useTrackedStore } from "../../../store/inboxStore";
import { usePresenceRows } from "../../../hooks/useDocPresence";
import { composeDocId, typingRows } from "../../../lib/composerPresence";
import { viewersOf, viewersSig } from "../../presence/memberPresence";
import { liteFaceOf, liteFacepile, liteNamesLabel, liteTypingLabel, type LiteFace } from "../../../lib/lite/collabPeople";
import { LiteAvatar } from "../LiteSidebarRows";

/** A stack of faces, three and then "+N"; the names are its tooltip. */
export function LiteFaces({ faces, size = 20, max = 3, label }: { faces: readonly LiteFace[]; size?: number; max?: number; label?: string }) {
  if (faces.length === 0) return null;
  const { shown, more } = liteFacepile(faces, max);
  const names = label ?? liteNamesLabel(faces.map((f) => f.name));
  return (
    <span className="lt-faces" role="img" aria-label={names} title={names}>
      {shown.map((f) => <LiteAvatar key={f.id} name={f.name} image={f.image} size={size} />)}
      {more > 0 && (
        <span className="lt-faces-more" style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }}>
          +{more}
        </span>
      )}
    </span>
  );
}

const meIdOf = (s: { currentUser?: { _id?: unknown } | null }) => (s.currentUser?._id ? String(s.currentUser._id) : null);

/** The teammates who have this session open right now. */
export const LiteViewerFaces = memo(function LiteViewerFaces({ sessionId }: { sessionId: string }) {
  const st = useTrackedStore([(s) => viewersSig(s.teamMembers, sessionId, meIdOf(s))]);
  const sig = viewersSig(st.teamMembers, sessionId, meIdOf(st));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature stands in for the roster
  const faces = useMemo(() => viewersOf(st.teamMembers, sessionId, meIdOf(st)).map(liteFaceOf), [sig, sessionId]);
  if (faces.length === 0) return null;
  const names = faces.map((f) => f.name);
  return <LiteFaces faces={faces} label={`${liteNamesLabel(names)} ${names.length === 1 ? "is" : "are"} viewing`} />;
});

/** "Maya is typing": someone else forming words in this session's composer. */
export const LiteTypingChip = memo(function LiteTypingChip({ sessionId }: { sessionId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const rows = usePresenceRows(composeDocId(sessionId), isAuthenticated && isConvexId(sessionId));
  // The rows carry every keystroke's draft; only the names reach the screen.
  const label = liteTypingLabel(typingRows(rows).map((r) => r.user_name));
  if (!label) return null;
  return (
    <span className="lt-chip" data-chip="typing" role="status" title={label}>
      <PenLine aria-hidden />
      <span>{label}</span>
    </span>
  );
});
