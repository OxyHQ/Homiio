import { useWindowDimensions } from 'react-native';

import { useUIStore } from '@/store/uiStore';

/**
 * The inline width the navigation rail takes inside Bloom's `AppShell`, for the
 * surfaces that anchor beside it (the Sindi panel).
 *
 * These are Bloom's numbers, not Homiio's — `AppShell` and `Sidebar` own them
 * and export no constants. If a Bloom upgrade moves the rail, this is the one
 * place to follow it:
 *
 * - the rail sits in flow from Bloom's `lg` breakpoint (1024); below it the
 *   sidebar is a drawer and takes no inline width;
 * - the panel is 260 wide expanded, 52 collapsed;
 * - the `overlay` frame pads 12 and puts 16 between the rail and the content.
 */

/** Bloom `BREAKPOINTS.lg`: the width the rail sits in flow from. */
export const SIDEBAR_IN_FLOW_FROM = 1024;

/** Width (px) of Bloom's expanded `Sidebar` panel. */
export const SIDEBAR_PANEL_EXPANDED_WIDTH = 260;

/** Width (px) of Bloom's collapsed `Sidebar` rail. */
export const SIDEBAR_PANEL_COLLAPSED_WIDTH = 52;

/** `AppShell`'s frame padding left of the rail plus the gap right of it. */
const SHELL_INSET = 12 + 16;

/**
 * Where the content column starts: the frame inset plus the rail's CURRENT
 * width (collapsed or not). `0` while the sidebar is a drawer, so callers that
 * anchor against it never apply a phantom offset on narrow screens.
 */
export function useSidebarWidth(): number {
  const { width } = useWindowDimensions();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  if (width < SIDEBAR_IN_FLOW_FROM) return 0;
  return SHELL_INSET + (sidebarCollapsed ? SIDEBAR_PANEL_COLLAPSED_WIDTH : SIDEBAR_PANEL_EXPANDED_WIDTH);
}
