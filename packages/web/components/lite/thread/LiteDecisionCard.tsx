// A `cast decide` ask, docked above Lite's composer: the question, one button
// per option (its digit beside it), and a typed answer. Built on the same
// answer model as the classic card (hooks/useDecisionAnswer), so an answer
// from here lands as the same write. An ask that needs more than one choice
// (a multi, a rank, a form, a change card) is the classic card itself, which
// carries those controls.
import { useState, type KeyboardEvent } from "react";
import { CornerDownLeft, X } from "lucide-react";
import { useInboxStore } from "../../../store/inboxStore";
import { useDecisionAnswer } from "../../../hooks/useDecisionAnswer";
import type { QueueItem } from "../../../lib/decisionQueue";
import { KeyCap } from "../../KeyboardShortcutsHelp";
import { SessionDecisionCard } from "../../SessionDecisionCard";

export function LiteDecisionCard({ item, more }: { item: QueueItem; more: number }) {
  const decisionRow = useInboxStore((s) => (item.decisionId ? s.sessionDecisions[item.decisionId] : undefined));
  const rich = !!decisionRow && ((item.kind ?? "single") !== "single" || !!decisionRow.card);
  if (rich) return <SessionDecisionCard item={item} stepper={null} more={more} />;
  return <CompactDecision item={item} more={more} />;
}

function CompactDecision({ item, more }: { item: QueueItem; more: number }) {
  const { question, options, answer, answerFreeText, dismiss } = useDecisionAnswer(item);
  const [text, setText] = useState("");
  const shown = options.slice(0, 9);

  // The digits answer while the card holds focus (never from the composer,
  // where a digit is a digit).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > shown.length) return;
    e.preventDefault();
    void answer(shown[n - 1].index);
  };
  const submitText = () => {
    if (!text.trim()) return;
    answerFreeText(text);
    setText("");
  };

  return (
    <div className="lt-decide" role="group" aria-label="Decision" onKeyDown={onKey}>
      <div className="lt-decide-head">
        <span className="lt-decide-q">{question}</span>
        {more > 0 && <span className="lt-meta">+{more}</span>}
        <button type="button" className="lt-icon-btn !w-6 !h-6" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
          <X aria-hidden />
        </button>
      </div>
      <div className="lt-decide-opts">
        {shown.map((o, i) => (
          <button key={o.index} type="button" className="lt-decide-opt" title={o.description || o.label} onClick={() => void answer(o.index)}>
            <KeyCap>{String(i + 1)}</KeyCap>
            <span>{o.label}</span>
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
