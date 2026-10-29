// Codecast Lite's answer to the router compat layer (src/compat/next-navigation).
//
// Outside a tab pane the compat usePathname answers with the CLASSIC active
// tab's path, on every route, because the classic tabs hydrate in every
// window. Inside Lite that is a lie: a reused component would read /inbox
// while the window shows /lite/<id>, and a reused component's router.push
// to /conversation/<id> would leave Lite for the classic page. Wrapping the
// shell in this provider gives every compat hook below it the real route,
// and gives its pushes Lite's addresses (lib/inboxRouting liteNavigationTarget).
//
// Its limits are the compat layer's own: a compat <Link> and a raw
// history.pushState (routerNavigate) do not go through useRouter, so they
// never reach the adapter.
import { useCallback, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { TabParamsCtx } from "./tabParams";
import { liteNavigationTarget, liteSessionIdFromPath } from "./inboxRouting";
import { interceptSettingsNav } from "../src/compat/tabRouting";

/** The pane id compat consumers see. No classic tab carries it, so a write
 *  keyed by it (useStageWide) touches no tab. */
const LITE_TAB_ID = "lite";

export function LiteRouteParams({ children }: { children: ReactNode }) {
  const location = useLocation();
  const routerParams = useParams();
  const routerNavigate = useNavigate();
  // The compat useRouter hands a push here after its Cmd-click diversion and
  // instead of its own settings and tab handling, so the settings modal is
  // opened here (Lite must mount SettingsModal for it to show).
  const navigate = useCallback((path: string, mode: "push" | "replace") => {
    const settings = interceptSettingsNav(path);
    if (settings) {
      if (settings.carryUrl) routerNavigate(settings.carryUrl, { replace: true });
      return;
    }
    routerNavigate(liteNavigationTarget(path), { replace: mode === "replace" });
  }, [routerNavigate]);
  const value = useMemo(() => {
    const params: Record<string, string> = {};
    for (const [key, v] of Object.entries(routerParams)) if (v !== undefined) params[key] = v;
    // Read from the path itself too, so the provider answers the same wherever
    // in the route tree the shell mounts it.
    const sessionId = liteSessionIdFromPath(location.pathname);
    if (sessionId) params.sessionId = sessionId;
    return {
      tabId: LITE_TAB_ID,
      pathname: location.pathname,
      params,
      searchParams: new URLSearchParams(location.search),
      hash: location.hash || undefined,
      isActive: true,
      navigate,
    };
  }, [location.pathname, location.search, location.hash, routerParams, navigate]);
  return <TabParamsCtx.Provider value={value}>{children}</TabParamsCtx.Provider>;
}
