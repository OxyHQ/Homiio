/**
 * The right rail.
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
 */
import React, { useMemo } from 'react';
import { View, Platform, type ViewStyle } from 'react-native';
import { usePathname } from 'expo-router';
import { WidgetManager } from './widgets';
import { railForPathname } from './widgets/routeRail';
import {
  useIsRightBarVisible,
  useIsLargeDesktop,
} from '@/hooks/useOptimizedMediaQuery';
import { useUIStore } from '@/store/uiStore';

export const RightBar = React.memo(function RightBar() {
  const isRightBarVisible = useIsRightBarVisible();
  const isLargeDesktop = useIsLargeDesktop();
  const sindiPanelOpen = useUIStore((s) => s.sindiPanelOpen);
  const pathname = usePathname() || '/';

  // One lookup: the rail AND the params it needs, both read off the pattern
  // that matched. Only the city identifier is ever available from a route —
  // state and neighborhood are deliberately absent so downstream widgets fall
  // back to their own data sources rather than rendering placeholders.
  const rail = useMemo(() => railForPathname(pathname), [pathname]);

  if (!isRightBarVisible) return null;
  // No rail for this route. A route reaches this either because its entry in
  // `ROUTE_RAIL` says so, or because the pathname is not a route at all — and
  // for both, rendering somebody else's widgets is the thing #423 removed.
  if (rail.screenId === null) return null;
  // Drop the 4th column while the Sindi panel is docked, unless the screen is
  // large-desktop (>= 1440) where all four columns fit.
  if (sindiPanelOpen && !isLargeDesktop) return null;

  // Web sticky pin — RN style system has no sticky utility that survives
  // react-native-web cleanly for this rail; keep the numeric sticky object.
  const stickyStyle =
    Platform.OS === 'web'
      ? ({
          position: 'sticky',
          // Keep the column at its content height so sticky pins while the
          // center feed scrolls (default flex stretch would stretch to the row).
          alignSelf: 'flex-start',
          top: 0,
        } as unknown as ViewStyle)
      : undefined;

  return (
    <View className="w-[350px] flex-col px-4 pt-4 gap-4" style={stickyStyle}>
      <WidgetManager
        screenId={rail.screenId}
        propertyId={rail.propertyId}
        city={rail.city}
      />
    </View>
  );
});
