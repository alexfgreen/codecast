// The Lite sidebar's small parts: a status mark, a face, a session row, a
// navigation row. Visuals live in app/lite/lite.css under [data-lite].
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { AvatarImg } from "../../lib/avatarCache";
import { liteSessionPath } from "../../lib/inboxRouting";
import type { LiteMark } from "../../lib/lite/sidebarModel";

const MARK_WORDS: Record<NonNullable<LiteMark>, string> = {
  working: "Working",
  needs: "Needs you",
  done: "Done, not read yet",
};

/** One row's status: a still blue ring (working), an amber diamond (needs a
 *  person), an emerald check (done, not read yet), or an empty slot. */
export function LiteStatusMark({ mark }: { mark: LiteMark }) {
  return (
    <span className="lt-mark" data-mark={mark ?? undefined} role={mark ? "img" : undefined} aria-label={mark ? MARK_WORDS[mark] : undefined} aria-hidden={mark ? undefined : true}>
      {mark === "done" ? <Check aria-hidden /> : null}
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
 * One session, one line: its mark, its title, the machine it runs on (the
 * viewer's own sessions, when they have more than one), and its age. On
 * hover the age gives way to "Open in classic" in the same slot. A row that
 * needs the person (or holds an unread result) keeps full contrast; the rest
 * recede.
 */
export function LiteSessionRow({ id, title, mark, machine, age, active, nested }: {
  id: string;
  title: string;
  mark: LiteMark;
  machine?: string | null;
  age: string;
  active: boolean;
  nested?: boolean;
}) {
  const attention = mark === "needs" || mark === "done";
  return (
    <div className="lt-rowwrap">
      <Link
        href={liteSessionPath(id)}
        className="lt-row"
        data-lt-nav=""
        data-nested={nested ? "" : undefined}
        data-attention={attention ? "" : undefined}
        aria-current={active ? "page" : undefined}
        title={title}
      >
        <LiteStatusMark mark={mark} />
        <span className="lt-row-title">{title}</span>
        {machine ? <span className="lt-meta lt-machine" title={`Runs on ${machine}`}>{machine}</span> : null}
        <span className="lt-meta lt-time">{age}</span>
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
