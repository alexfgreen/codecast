// Needs you's rows, one per kind of thing waiting on the person, each
// answerable where it stands: a decision by its options, a permission prompt
// by Deny or Allow, a terminal question by opening its session (the composer
// takes focus there), a handoff by acknowledging it, a mention or a finished
// turn by reading it. Every write is the classic one (useDecisionAnswer,
// resolvePermission, useAckAssignment, markNotificationRead, the thread's
// read mark), so an answer here lands everywhere. The row holds the
// keyboard's focus; the list (LiteNeedsList) moves it between rows.
import type { KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { useNavigate } from "react-router";
import { Check, Forward } from "lucide-react";
import { formatToolName } from "@codecast/shared/render";
import { useInboxStore } from "../../../store/inboxStore";
import { useDecisionAnswer } from "../../../hooks/useDecisionAnswer";
import { useAckAssignment } from "../../../hooks/useAckAssignment";
import { keyBelongsElsewhere } from "../../../shortcuts/keyOwnership";
import { liteSessionPath } from "../../../lib/inboxRouting";
import { liteAge } from "../../../lib/lite/sidebarModel";
import {
  liteAnswersInline,
  liteNeedsKey,
  type LiteFinishedItem,
  type LiteHandedItem,
  type LiteMentionItem,
  type LiteNoticeTarget,
  type LiteQuestionItem,
} from "../../../lib/lite/needsYou";
import { handoffNoticeIds, markLiteNoticesRead, markLiteSessionsRead } from "../../../lib/lite/needsYouActions";
import { KeyCap } from "../../KeyboardShortcutsHelp";
import { LiteAvatar, LiteStatusMark } from "../LiteSidebarRows";

type RowProps<T> = {
  item: T;
  /** The row the keyboard's focus rests on (the one Tab reaches). */
  focused: boolean;
  now: number;
  onFocusRow: (key: string) => void;
};

/** What the focused row does on its keys. `answer` reports whether the digit
 *  named an option. */
type RowKeys = {
  open?: () => void;
  answer?: (index: number) => boolean;
  allow?: () => void;
  deny?: () => void;
  clear?: () => void;
};

/** A row's frame: focusable, the keys its kind answers, nothing else. Enter
 *  opens only from the row itself; on a button inside it presses the
 *  button. Moving between rows is the list's. */
function RowShell({ rowKey, focused, onFocusRow, label, keys, children }: {
  rowKey: string;
  focused: boolean;
  onFocusRow: (key: string) => void;
  label: string;
  keys: RowKeys;
  children: ReactNode;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (keyBelongsElsewhere(e.target)) return;
    const key = liteNeedsKey(e);
    if (!key || key.kind === "move") return;
    let handled = false;
    if (key.kind === "open") {
      if (e.target !== e.currentTarget || !keys.open) return;
      keys.open();
      handled = true;
    } else if (key.kind === "answer") {
      handled = !!keys.answer?.(key.index);
    } else {
      const run = keys[key.kind];
      if (run) {
        run();
        handled = true;
      }
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  return (
    <div
      role="listitem"
      className="lt-needs-row"
      data-needs-row=""
      tabIndex={focused ? 0 : -1}
      aria-label={label}
      onFocus={() => onFocusRow(rowKey)}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

/** A key's cap, shown while its row holds the focus. */
function RowKey({ children }: { children: ReactNode }) {
  return <span className="lt-needs-key"><KeyCap size="xs">{children}</KeyCap></span>;
}

/** The row's age, and its clearing press when it has one. */
function RowSide({ at, now, clear, clearLabel }: { at: number; now: number; clear?: () => void; clearLabel?: string }) {
  return (
    <span className="lt-needs-side">
      <span className="lt-meta">{liteAge(at, now)}</span>
      {clear && (
        <>
          <RowKey>e</RowKey>
          <button type="button" className="lt-icon-btn" aria-label={clearLabel} title={clearLabel} onClick={clear}>
            <Check aria-hidden />
          </button>
        </>
      )}
    </span>
  );
}

/** An ask aimed at the person, by where it came from. */
export function LiteNeedsQuestionRow(props: RowProps<LiteQuestionItem>) {
  if (props.item.ask.source === "decide") return <DecideRow {...props} />;
  if (props.item.ask.source === "permission") return <PermissionRow {...props} />;
  return <AskRow {...props} />;
}

/** A `cast decide` ask. A single choice with nothing but option names is
 *  answered here, one press (or its digit) per option; anything richer opens
 *  its session, where the docked card shows it whole. */
function DecideRow({ item, focused, now, onFocusRow }: RowProps<LiteQuestionItem>) {
  const navigate = useNavigate();
  const { question, options, answer } = useDecisionAnswer(item.ask);
  const hasCard = useInboxStore((s) => {
    const id = item.ask.decisionId;
    return !!(id && (s.sessionDecisions[id] as { card?: unknown } | undefined)?.card);
  });
  const inline = liteAnswersInline(item.ask, hasCard);
  const href = liteSessionPath(item.sessionId);
  const open = () => navigate(href);
  const choose = (n: number) => {
    const option = options[n];
    if (!inline || !option) return false;
    void answer(option.index);
    return true;
  };
  const text = question || item.title;
  return (
    <RowShell rowKey={item.key} focused={focused} onFocusRow={onFocusRow} label={text} keys={{ open, answer: choose }}>
      <LiteStatusMark mark="needs" />
      <div className="lt-needs-body">
        <Link href={href} className="lt-needs-title" title={text} tabIndex={-1}>{text}</Link>
        <span className="lt-needs-detail">{item.title}</span>
        <div className="lt-needs-actions">
          {inline ? (
            options.map((o, i) => (
              <button key={o.index} type="button" className="lt-btn" title={o.description || o.label} onClick={() => void answer(o.index)}>
                {i < 9 && <RowKey>{String(i + 1)}</RowKey>}
                <span>{o.label}</span>
              </button>
            ))
          ) : (
            <button type="button" className="lt-btn" onClick={open}>
              <span>Answer</span>
              <RowKey>↵</RowKey>
            </button>
          )}
        </div>
      </div>
      <RowSide at={item.at} now={now} />
    </RowShell>
  );
}

/** A tool permission prompt: what it would run, then Deny or Allow. With
 *  several waiting in one session, the oldest shows and the rest follow. */
function PermissionRow({ item, focused, now, onFocusRow }: RowProps<LiteQuestionItem>) {
  const navigate = useNavigate();
  const { permissions } = useDecisionAnswer(item.ask);
  const resolvePermission = useInboxStore((s) => s.resolvePermission);
  const first = permissions[0] as { _id: string; tool_name: string; arguments_preview?: string } | undefined;
  const href = liteSessionPath(item.sessionId);
  const open = () => navigate(href);
  const allow = first ? () => resolvePermission(first._id, "approved") : undefined;
  const deny = first ? () => resolvePermission(first._id, "denied") : undefined;
  const tool = first ? formatToolName(first.tool_name) : "";
  return (
    <RowShell rowKey={item.key} focused={focused} onFocusRow={onFocusRow} label={`${item.title}: permission`} keys={{ open, allow, deny }}>
      <LiteStatusMark mark="needs" />
      <div className="lt-needs-body">
        <Link href={href} className="lt-needs-title" title={item.title} tabIndex={-1}>{item.title}</Link>
        {first ? (
          <span className="lt-needs-code" title={`${first.tool_name} ${first.arguments_preview ?? ""}`.trim()}>
            <b>{tool}</b>
            {first.arguments_preview ? ` ${first.arguments_preview}` : ""}
          </span>
        ) : (
          <span className="lt-needs-detail">Wants permission</span>
        )}
        <div className="lt-needs-actions">
          {first ? (
            <>
              <button type="button" className="lt-btn" onClick={deny}>
                <span>Deny</span>
                <RowKey>n</RowKey>
              </button>
              <button type="button" className="lt-btn" data-tone="primary" onClick={allow}>
                <span>Allow</span>
                <RowKey>y</RowKey>
              </button>
              {permissions.length > 1 && <span className="lt-meta self-center">+{permissions.length - 1}</span>}
            </>
          ) : (
            <button type="button" className="lt-btn" onClick={open}>
              <span>Answer</span>
              <RowKey>↵</RowKey>
            </button>
          )}
        </div>
      </div>
      <RowSide at={item.at} now={now} />
    </RowShell>
  );
}

/** A terminal question (AskUserQuestion): its text when the session's
 *  messages are at hand, answered in its session, whose composer takes the
 *  focus on arrival. */
function AskRow({ item, focused, now, onFocusRow }: RowProps<LiteQuestionItem>) {
  const navigate = useNavigate();
  const { question } = useDecisionAnswer(item.ask);
  const href = liteSessionPath(item.sessionId);
  const open = () => navigate(href);
  const text = question || "Asked a question";
  return (
    <RowShell rowKey={item.key} focused={focused} onFocusRow={onFocusRow} label={`${item.title}: ${text}`} keys={{ open }}>
      <LiteStatusMark mark="needs" />
      <div className="lt-needs-body">
        <Link href={href} className="lt-needs-title" title={text} tabIndex={-1}>{text}</Link>
        <span className="lt-needs-detail">{item.title}</span>
        <div className="lt-needs-actions">
          <button type="button" className="lt-btn" onClick={open}>
            <span>Answer</span>
            <RowKey>↵</RowKey>
          </button>
        </div>
      </div>
      <RowSide at={item.at} now={now} />
    </RowShell>
  );
}

/** A session a teammate handed the person: who, their note, and Open or
 *  Acknowledge. Acknowledging also reads the notification that announced
 *  it. */
export function LiteNeedsHandedRow({ item, focused, now, onFocusRow }: RowProps<LiteHandedItem>) {
  const navigate = useNavigate();
  const ackAssignment = useAckAssignment();
  const href = liteSessionPath(item.sessionId);
  const open = () => navigate(href);
  const acknowledge = () => {
    ackAssignment(item.sessionId);
    markLiteNoticesRead(handoffNoticeIds(item.sessionId));
  };
  return (
    <RowShell rowKey={item.key} focused={focused} onFocusRow={onFocusRow} label={`${item.title}, from ${item.by}`} keys={{ open, clear: acknowledge }}>
      <span className="lt-needs-glyph" aria-hidden><Forward /></span>
      <div className="lt-needs-body">
        <Link href={href} className="lt-needs-title" title={item.title} tabIndex={-1}>{item.title}</Link>
        <span className="lt-needs-detail">From {item.by}</span>
        {item.note && <span className="lt-needs-note">{`“${item.note}”`}</span>}
        <div className="lt-needs-actions">
          <button type="button" className="lt-btn" onClick={open}>
            <span>Open</span>
            <RowKey>↵</RowKey>
          </button>
          <button type="button" className="lt-btn" onClick={acknowledge}>
            <span>Acknowledge</span>
            <RowKey>e</RowKey>
          </button>
        </div>
      </div>
      <RowSide at={item.at} now={now} />
    </RowShell>
  );
}

/** A notification addressed to the person: who, what and where. Opening it
 *  reads it: a session opens in Lite, a page Lite does not have in the
 *  classic app, a page outside the app in a new tab. */
export function LiteNeedsMentionRow({ item, focused, now, onFocusRow }: RowProps<LiteMentionItem>) {
  const navigate = useNavigate();
  const read = () => markLiteNoticesRead([item.notificationId]);
  const target = item.target;
  const open = target ? () => {
    read();
    if (target.external) window.open(target.href, "_blank", "noopener");
    else navigate(target.href);
  } : undefined;
  const text = item.message || "Mentioned you";
  return (
    <RowShell rowKey={item.key} focused={focused} onFocusRow={onFocusRow} label={text} keys={{ open, clear: read }}>
      <LiteAvatar name={item.actorName ?? "?"} image={item.actorImage} size={18} />
      <div className="lt-needs-body">
        <NoticeTitle target={target} text={text} onOpen={read} />
        {item.where && <span className="lt-needs-detail">{item.where}</span>}
      </div>
      <RowSide at={item.at} now={now} clear={read} clearLabel="Mark read" />
    </RowShell>
  );
}

function NoticeTitle({ target, text, onOpen }: { target: LiteNoticeTarget | null; text: string; onOpen: () => void }) {
  if (!target) return <span className="lt-needs-title" title={text}>{text}</span>;
  if (target.external) {
    return <a href={target.href} target="_blank" rel="noopener noreferrer" className="lt-needs-title" title={text} tabIndex={-1} onClick={onOpen}>{text}</a>;
  }
  return <Link href={target.href} className="lt-needs-title" title={text} tabIndex={-1} onClick={onOpen}>{text}</Link>;
}

/** One of the person's sessions with a finished turn they have not read. */
export function LiteNeedsFinishedRow({ item, focused, now, onFocusRow }: RowProps<LiteFinishedItem>) {
  const navigate = useNavigate();
  const href = liteSessionPath(item.sessionId);
  const open = () => navigate(href);
  const read = () => markLiteSessionsRead([item.sessionId]);
  return (
    <RowShell rowKey={item.key} focused={focused} onFocusRow={onFocusRow} label={item.title} keys={{ open, clear: read }}>
      <LiteStatusMark mark="done" />
      <div className="lt-needs-body">
        <Link href={href} className="lt-needs-title" title={item.title} tabIndex={-1}>{item.title}</Link>
        <span className="lt-needs-detail">{item.project}</span>
      </div>
      <RowSide at={item.at} now={now} clear={read} clearLabel="Mark read" />
    </RowShell>
  );
}
