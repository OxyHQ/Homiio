import { useWindowDimensions } from 'react-native';

import {
  SHELL_ASIDE_INSET,
  SIDEBAR_IN_FLOW_FROM,
  useSidebarWidth,
} from '@/components/SideBar/dimensions';
import { useUIStore } from '@/store/uiStore';

/**
 * Where the Sindi panel goes, decided in ONE place for the three readers that
 * must agree: the layout (which hands it to `AppShell` as the `aside`), the
 * right rail (which steps aside for it) and the panel itself.
 *
 * - Below 500 there is no panel: the sidebar row navigates to `/sindi`.
 * - 500 to 1023: an overlay over the page, because the sidebar is a drawer and
 *   there is no aside column to give it.
 * - From Bloom's `lg` (1024, the layout's `asideFrom`): DOCKED as `AppShell`'s
 *   `aside`, replacing the right rail while open. The shell has one aside, so
 *   the rail and the panel never share the screen.
 */

/** Below this the panel does not exist (phones navigate to `/sindi`). */
export const SINDI_PANEL_FROM = 500;

/** Ideal docked width. */
const PANEL_IDEAL_WIDTH = 380;
/** Docked width on large desktops (>= 1440). */
const PANEL_LARGE_WIDTH = 420;
const LARGE_DESKTOP_FROM = 1440;
/** Never narrower than this, whatever the viewport. */
const PANEL_MIN_WIDTH = 280;
/** The docked panel is clamped so the page column never drops below this. */
const MIN_MAIN_CONTENT_WIDTH = 380;
/** Viewport left uncovered beside the overlay panel, so the scrim shows. */
export const PANEL_OVERLAY_EDGE_GAP = 56;

export interface SindiPanelLayout {
  /** Open, on a screen wide enough to have a panel. */
  visible: boolean;
  /** Visible AND docked as the shell's aside (from 1024). */
  docked: boolean;
  /** The panel's width for the current tier. */
  width: number;
}

export function useSindiPanelLayout(): SindiPanelLayout {
  const { width: viewport } = useWindowDimensions();
  const open = useUIStore((s) => s.sindiPanelOpen);
  const sidebarWidth = useSidebarWidth();

  const visible = open && viewport >= SINDI_PANEL_FROM;
  const docked = visible && viewport >= SIDEBAR_IN_FLOW_FROM;

  let width: number;
  if (viewport >= SIDEBAR_IN_FLOW_FROM) {
    const ideal = viewport >= LARGE_DESKTOP_FROM ? PANEL_LARGE_WIDTH : PANEL_IDEAL_WIDTH;
    const maxDockable = viewport - sidebarWidth - SHELL_ASIDE_INSET - MIN_MAIN_CONTENT_WIDTH;
    width = Math.max(PANEL_MIN_WIDTH, Math.min(ideal, maxDockable));
  } else {
    width = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_IDEAL_WIDTH, viewport - PANEL_OVERLAY_EDGE_GAP));
  }

  return { visible, docked, width };
}

/**
 * Whether Sindi may act on the app is NOT decided here any more.
 *
 * It was — `canControlApp = visible && docked`, straight off this layout — and
 * that made the panel's viewport tier the answer for three different surfaces,
 * only one of which is this panel. The decision now takes the HOST as well and
 * lives in `components/sindi/sindiHost.ts`, which imports this module. There is
 * deliberately no re-export: two doors onto one rule is how the copy people
 * read stops being the copy that runs.
 */
