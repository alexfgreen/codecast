// /lite/needs-you: everything waiting on the person in one list, most urgent
// first, every row answerable where it stands (components/lite/needs). The
// items are the sidebar model's (lib/lite/needsYou), so the number beside
// Needs you and this list can never disagree: the number is the list less
// its finished turns.
import { CircleCheck } from "lucide-react";
import { useCoarseNow } from "@/hooks/useCoarseNow";
import { useLiteSidebarModel } from "@/lib/lite/useLiteSidebar";
import { LiteTopbar } from "@/components/lite/LiteTopbar";
import { LiteNeedsList } from "@/components/lite/needs/LiteNeedsList";

export default function LiteNeedsYouPage() {
  const { needsYou, needsYouCount } = useLiteSidebarModel();
  const now = useCoarseNow(15_000);
  return (
    <>
      <LiteTopbar>
        <span className="text-[14px] font-medium">Needs you</span>
        {needsYouCount > 0 && <span className="lt-count" data-attention="">{needsYouCount}</span>}
      </LiteTopbar>
      <div className="lt-scroll">
        {needsYou.length > 0 ? (
          <div className="lt-content lt-needs-page">
            <LiteNeedsList items={needsYou} now={now} />
          </div>
        ) : (
          <div className="lt-content lt-needs-empty">
            <CircleCheck aria-hidden />
            <h1>Nothing needs you</h1>
          </div>
        )}
      </div>
    </>
  );
}
