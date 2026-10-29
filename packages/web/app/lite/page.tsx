// /lite: Lite's home. With no session open it offers the few worth opening:
// the ones waiting on you first, then the most recently active.
import { useMemo } from "react";
import { useCoarseNow } from "@/hooks/useCoarseNow";
import { useLiteSidebarModel } from "@/lib/lite/useLiteSidebar";
import { liteAge } from "@/lib/lite/sidebarModel";
import { LiteTopbar } from "@/components/lite/LiteTopbar";
import { LiteSessionRow } from "@/components/lite/LiteSidebarRows";

const SHOWN = 5;

export default function LiteHomePage() {
  const { projects } = useLiteSidebarModel();
  const now = useCoarseNow(15_000);
  const rows = useMemo(() => {
    const all = projects.flatMap((g) => g.all);
    const needs = all.filter((r) => r.mark === "needs").sort((a, b) => b.activityAt - a.activityAt);
    const rest = all.filter((r) => r.mark !== "needs").sort((a, b) => b.activityAt - a.activityAt);
    return [...needs, ...rest].slice(0, SHOWN);
  }, [projects]);

  return (
    <>
      <LiteTopbar>
        <span className="text-[14px] font-medium">Home</span>
      </LiteTopbar>
      <div className="lt-scroll">
        <div className="lt-content lt-empty">
          <h1>Pick a session</h1>
          {rows.length > 0 && (
            <div className="lt-list" role="list" aria-label="Sessions">
              {rows.map((row) => (
                <div role="listitem" key={row.id}>
                  <LiteSessionRow id={row.id} title={row.title} mark={row.mark} machine={row.machine} age={liteAge(row.activityAt, now)} active={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
