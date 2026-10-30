// The Lite sidebar's small parts: a status mark, a face, a session row, a
// navigation row. Visuals live in app/lite/lite.css under [data-lite]; the
// failed mark's, with Needs you's, in components/lite/needs/needs.css.
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import { AvatarImg } from "../../lib/avatarCache";
import { liteSessionPath } from "../../lib/inboxRouting";
import type { LiteMark } from "../../lib/lite/sidebarModel";
import { useLiteSessionMark } from "../../lib/lite/useLiteSidebar";
import "./needs/needs.css";

const MARK_WORDS: Record<NonNullable<LiteMark>, string> = {
  working: "Working",
  needs: "Needs you",
  error: "Failed",
  waiting: "Waiting on its owner",
  done: "Done, not read yet",
};

/** One row's status: a still blue ring (working), an amber diamond (needs
 *  you), a red cross (failed: stuck on something the person must fix), a
 *  hollow diamond (a teammate's, waiting on them: `label` names who), an
 *  emerald check (done, not read yet), or an empty slot. */
export function LiteStatusMark({ mark, label }: { mark: LiteMark; label?: string | null }) {
  return (
    <span className="lt-mark" data-mark={mark ?? undefined} role={mark ? "img" : undefined} aria-label={mark ? label ?? MARK_WORDS[mark] : undefined} aria-hidden={mark ? undefined : true}>
      {mark === "done" ? <Check aria-hidden /> : mark === "error" ? <X aria-hidden /> : null}
    </span>
  );
}

/** A person's face: their photo, else their initials. */
export function LiteAvatar({ name, image, size = 20 }: { name: string; image?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const fallback = (
    <span className="lt-avatar" style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }} aria-hidden>
      {initials}
    </span>
  );
  return <AvatarImg src={image} alt="" className="lt-avatar" style={{ width: size, height: size }} fallback={fallback} />;
}

/**
 * One session, one line: its mark, its title, and one fact in the meta slot:
 * the machine a live row runs on (the viewer's own sessions, when they have
 * more than one), else its age. On hover that slot gives way to "Open in
 * classic". The mark is the session's one mark (useLiteSessionMark), which
 * `mark` may only restate. A row that needs the person, has failed or holds
 * an unread result keeps full contrast; the rest recede, a teammate's
 * waiting row among them. `detail` is a second name, for a wide list.
 */
export function LiteSessionRow({ id, title, mark: given, markLabel, machine, detail, age, active, nested }: {
  id: string;
  title: string;
  mark?: LiteMark;
  markLabel?: string;
  machine?: string | null;
  detail?: string | null;
  age: string;
  active: boolean;
  nested?: boolean;
}) {
  const own = useLiteSessionMark(id);
  const mark = given === undefined ? own.mark : given;
  const label = markLabel ?? (mark === own.mark ? own.label : null);
  const attention = mark === "needs" || mark === "error" || mark === "done";
  const showMachine = !!machine && (mark === "working" || mark === "needs" || mark === "error");
  return (
    <div className="lt-rowwrap">
      <Link
        href={liteSessionPath(id)}
        className="lt-row"
        data-lt-nav=""
        data-nested={nested ? "" : undefined}
        data-attention={attention ? "" : undefined}
        aria-current={active ? "page" : undefined}
        title={machine ? `${title} · runs on ${machine}` : title}
      >
        <LiteStatusMark mark={mark} label={label} />
        <span className="lt-row-title">{title}</span>
        {detail ? <span className="lt-meta lt-detail">{detail}</span> : null}
        <span className="lt-meta lt-time">{showMachine ? <span className="lt-machine">{machine}</span> : age}</span>
      </Link>
      <div className="lt-row-actions">
        <Link href={`/inbox?s=${encodeURIComponent(id)}`} className="lt-icon-btn" aria-label={`Open ${title} in the classic app`} title="Open in classic">
          <ArrowUpRight aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/** A place in Lite (Needs you, Team): an icon, a name and an optional count. */
export function LiteNavRow({ href, icon, label, count, attention, active }: {
  href: string;
  icon: ReactNode;
  label: string;
  count?: number;
  attention?: boolean;
  active: boolean;
}) {
  return (
    <Link href={href} className="lt-row" data-lt-nav="" data-attention={attention ? "" : undefined} aria-current={active ? "page" : undefined}>
      <span className="lt-mark" aria-hidden>{icon}</span>
      <span className="lt-row-title">{label}</span>
      {count ? <span className="lt-count" data-attention={attention ? "" : undefined}>{count}</span> : null}
    </Link>
  );
}
