// /lite: Lite's home. With no session open it offers the few worth opening:
// the ones waiting on you first, then the most recent. With none at all, the
// way to start one: Lite has no composer until the conversation wave, so a
// first session starts in the classic app.
import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
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
    const needs = all.filter((r) => r.mark === "needs").sort((a, b) => b.sortAt - a.sortAt);
    const rest = all.filter((r) => r.mark !== "needs").sort((a, b) => b.sortAt - a.sortAt);
    return [...needs, ...rest].slice(0, SHOWN);
  }, [projects]);

  return (
    <>
      <LiteTopbar>
        <span className="text-[14px] font-medium">Home</span>
      </LiteTopbar>
      <div className="lt-scroll">
        <div className="lt-content lt-empty">
          {rows.length > 0 ? (
            <>
              <h1>Recent sessions</h1>
              <div className="lt-list" role="list" aria-label="Recent sessions">
                {rows.map((row) => (
                  <div role="listitem" key={row.id}>
                    <LiteSessionRow id={row.id} title={row.title} mark={row.mark} machine={row.machine} age={liteAge(row.activityAt, now)} active={false} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <h1>No sessions yet</h1>
              <div>
                <Link href="/inbox" className="lt-btn">
                  Start one in classic
                  <ArrowUpRight aria-hidden />
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
