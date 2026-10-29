// /lite/needs-you: everything waiting on the person, in one list: each ask
// (its question), then each session waiting for them. The rows are the ones
// the sidebar's count counts, so the number and the list agree, and each one
// opens its session. Answering in place lands with its own wave.
import { useCoarseNow } from "@/hooks/useCoarseNow";
import { useLiteSidebarModel } from "@/lib/lite/useLiteSidebar";
import { liteAge } from "@/lib/lite/sidebarModel";
import { LiteTopbar } from "@/components/lite/LiteTopbar";
import { LiteSessionRow } from "@/components/lite/LiteSidebarRows";

export default function LiteNeedsYouPage() {
  const { needsYou, activeId } = useLiteSidebarModel();
  const now = useCoarseNow(15_000);
  return (
    <>
      <LiteTopbar>
        <span className="text-[14px] font-medium">Needs you</span>
        {needsYou.length > 0 && <span className="lt-count" data-attention="">{needsYou.length}</span>}
      </LiteTopbar>
      <div className="lt-scroll">
        <div className="lt-content lt-empty">
          <h1>{needsYou.length > 0 ? "Needs you" : "Nothing needs you"}</h1>
          {needsYou.length > 0 && (
            <div className="lt-list" role="list" aria-label="Waiting on you">
              {needsYou.map((item) => (
                <div role="listitem" key={item.key}>
                  <LiteSessionRow
                    id={item.sessionId}
                    title={item.title}
                    mark="needs"
                    // An ask names its session; a waiting session is its own title.
                    detail={item.question ? item.sessionTitle : null}
                    age={liteAge(item.activityAt, now)}
                    active={item.sessionId === activeId}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
