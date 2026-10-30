// A `cast decide` ask, docked above Lite's composer: the question, one button
// per option (its digit beside it), and a typed answer. Built on the same
// answer model as the classic card (hooks/useDecisionAnswer), so an answer
// from here lands as the same write. An ask that needs more than one choice
// (a multi, a rank, a form, a change card), or that carries more than its
// options' names (the agent's context, a document, an option's body, cost,
// risk or evidence, a trial run), is the classic card itself, which carries
// those controls and shows that context whole.
import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { CornerDownLeft, X } from "lucide-react";
import { useInboxStore } from "../../../store/inboxStore";
import { useDecisionAnswer } from "../../../hooks/useDecisionAnswer";
import { useMountEffect } from "../../../hooks/useMountEffect";
import type { QueueItem } from "../../../lib/decisionQueue";
import { KeyCap } from "../../KeyboardShortcutsHelp";
import { SessionDecisionCard } from "../../SessionDecisionCard";

/** The ask says more than a question and option names. */
function carriesContext(item: QueueItem): boolean {
  return !!(item.contextMd?.trim() || item.docId || item.reportSlug || item.trial)
    || item.options.some((o) => !!(o.body_md?.trim() || o.cost || o.risk || o.evidence?.length || o.page_slug));
}

export function LiteDecisionCard({ item, more }: { item: QueueItem; more: number }) {
  const decisionRow = useInboxStore((s) => (item.decisionId ? s.sessionDecisions[item.decisionId] : undefined));
  const rich = (!!decisionRow && ((item.kind ?? "single") !== "single" || !!decisionRow.card)) || carriesContext(item);
  if (rich) return <SessionDecisionCard item={item} stepper={null} more={more} />;
  return <CompactDecision item={item} more={more} />;
}

const isTextField = (el: EventTarget | null) => {
  const tag = (el as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
};

function CompactDecision({ item, more }: { item: QueueItem; more: number }) {
  const { question, options, answer, answerFreeText, dismiss } = useDecisionAnswer(item);
  const [text, setText] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  // The digits answer while the card holds focus outside its text box, and
  // only then are they shown: from the composer (or the box here) a digit is
  // a digit.
  const [keysLive, setKeysLive] = useState(false);

  // A blocking ask takes focus when it docks, unless the person is typing.
  useMountEffect(() => {
    if (!item.blocking) return;
    const active = document.activeElement as HTMLElement | null;
    const typing = isTextField(active) && !!(active as HTMLInputElement | HTMLTextAreaElement).value;
    if (!typing) rootRef.current?.focus();
  });

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTextField(e.target)) return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > Math.min(9, options.length)) return;
    e.preventDefault();
    void answer(options[n - 1].index);
  };
  const onFocus = (e: FocusEvent<HTMLDivElement>) => setKeysLive(!isTextField(e.target));
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeysLive(false);
  };
  const submitText = () => {
    if (!text.trim()) return;
    answerFreeText(text);
    setText("");
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="lt-decide"
      role="group"
      aria-label="Decision"
      data-keys={keysLive ? "" : undefined}
      onKeyDown={onKey}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="lt-decide-head">
        <span className="lt-decide-q">{question}</span>
        {more > 0 && <span className="lt-meta">+{more}</span>}
        <button type="button" className="lt-icon-btn !w-6 !h-6" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
          <X aria-hidden />
        </button>
      </div>
      <div className="lt-decide-opts">
        {options.map((o, i) => (
          <button key={o.index} type="button" className="lt-decide-opt" onClick={() => void answer(o.index)}>
            {i < 9 && <span className="lt-decide-key"><KeyCap>{String(i + 1)}</KeyCap></span>}
            <span className="lt-decide-label">
              <span>{o.label}</span>
              {o.description && <span className="lt-decide-desc">{o.description}</span>}
            </span>
          </button>
        ))}
      </div>
      <form className="lt-decide-other" onSubmit={(e) => { e.preventDefault(); submitText(); }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Answer in your own words"
          aria-label="Answer in your own words"
        />
        <button type="submit" className="lt-btn" disabled={!text.trim()} aria-label="Send answer">
          <CornerDownLeft aria-hidden />
        </button>
      </form>
    </div>
  );
}
