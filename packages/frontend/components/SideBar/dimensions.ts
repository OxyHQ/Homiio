import { useUIStore } from '@/store/uiStore';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';

/**
 * Shared sidebar dimension constants + the derived current-width hook.
 *
 * Lives in its own module (not `index.tsx`) so other docked surfaces — chiefly
 * the Sindi overlay panel, which must anchor immediately to the right of the
 * sidebar on the tablet/small-wide tier — can read the SideBar's exact width
 * without duplicating the math or importing the heavy component.
 *
 * The panel widths are Bloom `Sidebar`'s own (260 expanded, 52 collapsed; it
 * owns them and exports no constant). The SideBar wraps the panel in
 * {@link SIDEBAR_GUTTER} on every side (plus {@link SIDEBAR_MASK_CLEARANCE} on
 * the right) so the floating panel's border and shadow are never clipped.
 */

/** Width (px) of Bloom's expanded `Sidebar` panel. */
export const SIDEBAR_PANEL_EXPANDED_WIDTH = 260;

/** Width (px) of Bloom's collapsed `Sidebar` rail. */
export const SIDEBAR_PANEL_COLLAPSED_WIDTH = 52;

/** Padding (px) around the panel inside the SideBar column. */
export const SIDEBAR_GUTTER = 8;

/**
 * Extra right padding (px). The framed `ContentPanel`'s sticky bleed-mask is
 * clipped at `inset(-12px)`, so it paints 12px past the panel's left edge —
 * over our 8px gutter and into anything closer. This keeps the Sidebar's right
 * border and shadow clear of it.
 */
export const SIDEBAR_MASK_CLEARANCE = 8;

/** Total column width (px) while expanded. */
export const SIDEBAR_EXPANDED_WIDTH =
  SIDEBAR_PANEL_EXPANDED_WIDTH + SIDEBAR_GUTTER * 2 + SIDEBAR_MASK_CLEARANCE;

/** Total column width (px) while collapsed. */
export const SIDEBAR_COLLAPSED_WIDTH =
  SIDEBAR_PANEL_COLLAPSED_WIDTH + SIDEBAR_GUTTER * 2 + SIDEBAR_MASK_CLEARANCE;

/**
 * The sidebar's CURRENT rendered width on the persistent shell (web / wide
 * native): the collapsed column when the user chose to collapse it, otherwise
 * the expanded one.
 *
 * Returns `0` below the persistent-shell breakpoint (the sidebar is an overlay
 * drawer there and occupies no inline width), so callers that anchor against it
 * never apply a phantom offset on mobile.
 */
export function useSidebarWidth(): number {
  const isSidebarVisible = useIsScreenNotMobile();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  if (!isSidebarVisible) return 0;
  return sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;
}
