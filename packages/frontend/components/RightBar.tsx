/**
 * The right rail — `AppShell`'s `aside`.
 *
 * It decides NOTHING about which widgets a route gets — `routeRail.ts` owns
 * that, as a total map from every route in `app/` to a widget set or to `null`.
 * This component asks it and renders the answer.
 *
 * The ladder that used to live here (`pathname ===` / `startsWith`, ending in
 * `return 'home'`) sent 49 of 69 routes to Home's rail by fall-through, and
 * re-derived a property id by counting slashes — guarded by a hand-maintained
 * list of path segments that are not ids, which is exactly the kind of list
 * that goes stale. Read `routeRail.ts`'s header for the full measurement.
 *
 * The frame is not this file's: `AppShell` gives the column its width, pins it
 * (sticky, scrolling its own overflow) and drops it below its breakpoint. What
 * stays here is whether there is a column at all — see {@link useHasRightBar}.
 */
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { usePathname } from 'expo-router';
import { WidgetManager } from './widgets';
import { railForPathname } from './widgets/routeRail';
import { useSindiPanelLayout } from './sindi/sindiPanelLayout';

/** The column's width, handed to `AppShell` as `asideWidth`. */
export const RIGHT_BAR_WIDTH = 350;

/**
 * Whether the layout should give `AppShell` an `aside` at all.
 *
 * `AppShell` sizes a column for any non-null `aside`, so an empty rail must be
 * decided BEFORE the element is created — a `RightBar` that renders `null`
 * would still leave a 350px hole.
 *
 * - No rail for this route (its `ROUTE_RAIL` entry says so, or the pathname is
 *   not a route at all) → no column.
 * - The docked Sindi panel is the aside while it is open: the shell has one.
 */
export function useHasRightBar(): boolean {
  const pathname = usePathname() || '/';
  const sindiDocked = useSindiPanelLayout().docked;
  const hasRail = useMemo(() => railForPathname(pathname).screenId !== null, [pathname]);
  return hasRail && !sindiDocked;
}

export const RightBar = React.memo(function RightBar() {
  const pathname = usePathname() || '/';

  // One lookup: the rail AND the params it needs, both read off the pattern
  // that matched. Only the city identifier is ever available from a route —
  // state and neighborhood are deliberately absent so downstream widgets fall
  // back to their own data sources rather than rendering placeholders.
  const rail = useMemo(() => railForPathname(pathname), [pathname]);

  // No rail for this route. A route reaches this either because its entry in
  // `ROUTE_RAIL` says so, or because the pathname is not a route at all — and
  // for both, rendering somebody else's widgets is the thing #423 removed.
  if (rail.screenId === null) return null;

  return (
    <View className="flex-col gap-4 px-2 pt-2 pb-4">
      <WidgetManager
        screenId={rail.screenId}
        propertyId={rail.propertyId}
        city={rail.city}
      />
    </View>
  );
});
