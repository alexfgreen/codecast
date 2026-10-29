// /lite/needs-you: everything waiting on the person, in one list. Wave 1
// holds the place and the count; the list lands in its own wave.
import { useLiteSidebarModel } from "@/lib/lite/useLiteSidebar";
import { LiteTopbar } from "@/components/lite/LiteTopbar";

export default function LiteNeedsYouPage() {
  const { needsYouCount } = useLiteSidebarModel();
  return (
    <>
      <LiteTopbar>
        <span className="text-[14px] font-medium">Needs you</span>
        {needsYouCount > 0 && <span className="lt-count" data-attention="">{needsYouCount}</span>}
      </LiteTopbar>
      <div className="lt-scroll">
        <div className="lt-content lt-empty">
          <h1>Needs you</h1>
          <div data-lite-placeholder="">The Needs you list lands in wave 4</div>
        </div>
      </div>
    </>
  );
}
