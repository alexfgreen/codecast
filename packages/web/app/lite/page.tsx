// /lite: Lite's home, and where a new session starts. The composer is the
// page's centre (LiteNewSession); under it, the few sessions worth opening:
// the ones waiting on you first, then the most recent.
import { useMemo } from "react";
import { useCoarseNow } from "@/hooks/useCoarseNow";
import { useLiteSidebarModel } from "@/lib/lite/useLiteSidebar";
import { liteAge } from "@/lib/lite/sidebarModel";
import { LiteTopbar } from "@/components/lite/LiteTopbar";
import { LiteSessionRow } from "@/components/lite/LiteSidebarRows";
import { LiteNewSession } from "@/components/lite/thread/LiteNewSession";

const SHOWN = 5;

export default function LiteHomePage() {
  const { projects } = useLiteSidebarModel();
  const now = useCoarseNow(15_000);
  const rows = useMemo(() => {
    const all = projects.flatMap((g) => g.all);
    const needs = all.filter((r) => r.mark === "needs").sort((a, b) => b.sortAt - a.sortAt);
    const rest = all.filter((r) => r.mark !== "needs").sort((a, b) => b.sortAt - a.sortAt);
    return [...needs, ...rest].slice(0, SHOWN);
  }, [projects]);

  return (
    <>
      <LiteTopbar>
        <span className="text-[14px] font-medium">New session</span>
      </LiteTopbar>
      <div className="lt-scroll">
        <div className="lt-content">
          <LiteNewSession />
          {rows.length > 0 && (
            <section className="lt-hero-recent" aria-label="Recent sessions">
              <h2>Recent</h2>
              <div className="lt-list" role="list">
                {rows.map((row) => (
                  <div role="listitem" key={row.id}>
                    <LiteSessionRow id={row.id} title={row.title} mark={row.mark} machine={row.machine} age={liteAge(row.activityAt, now)} active={false} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
