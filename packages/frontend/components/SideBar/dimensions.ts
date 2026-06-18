import { useWindowDimensions } from 'react-native';
import { useUIStore } from '@/store/uiStore';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';

/**
 * Shared sidebar dimension constants + the derived current-width hook.
 *
 * Lives in its own module (not `index.tsx`) so other docked surfaces — chiefly
 * the Sindi overlay panel, which must anchor immediately to the right of the
 * sidebar on the tablet/small-wide tier — can read the SideBar's exact width
 * without duplicating the breakpoint math or importing the heavy component.
 */

/** Width breakpoint (px) above which the user may collapse the sidebar. */
export const LARGE_SCREEN_MIN_WIDTH = 768;

/** Width (px) of the collapsed icon-only rail. */
export const SIDEBAR_COLLAPSED_WIDTH = 48;

/** Width (px) of the expanded sidebar. */
export const SIDEBAR_EXPANDED_WIDTH = 240;

/**
 * The sidebar's CURRENT rendered width on the persistent shell (web / wide
 * native), derived from the same inputs the SideBar itself uses:
 *   - collapsed only when the screen is large enough to expand again
 *     (`>= LARGE_SCREEN_MIN_WIDTH`) AND the user chose to collapse it,
 *   - otherwise the full expanded width.
 *
 * Returns `0` below the persistent-shell breakpoint (the sidebar is an overlay
 * drawer there and occupies no inline width), so callers that anchor against it
 * never apply a phantom offset on mobile.
 *
 * Pure render-time derivation (no effect) — recomputes on width / collapse
 * changes via the underlying hooks.
 */
export function useSidebarWidth(): number {
  const { width } = useWindowDimensions();
  const isSidebarVisible = useIsScreenNotMobile();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  if (!isSidebarVisible) return 0;
  const isLargeScreen = width >= LARGE_SCREEN_MIN_WIDTH;
  const isCollapsed = isLargeScreen && sidebarCollapsed;
  return isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;
}
