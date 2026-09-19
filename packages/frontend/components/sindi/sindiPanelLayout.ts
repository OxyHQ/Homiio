import { useWindowDimensions } from 'react-native';

import type { SindiPresentation } from '@homiio/shared-types';

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
 * Whether Sindi may act on the app, and how it should present a result.
 *
 * ## The capability is the LAYOUT's, not the platform's
 *
 * #519 §8.2 is explicit about this, and about the three cases a platform check
 * would get wrong: "Una pestaña web estrecha o la ruta Sindi fullscreen en un
 * monitor grande siguen siendo chat-only. Una tablet nativa suficientemente
 * ancha puede permitir control lateral." So the answer is derived from
 * {@link useSindiPanelLayout} — the same hook the shell uses to decide where
 * the panel goes — and there is deliberately no `Platform.OS` in it.
 *
 * ## An overlay is NOT side-by-side, and that is the load-bearing line
 *
 * Between 500 and 1023 the panel floats over the page behind a scrim. It is
 * narrower than the viewport, so it LOOKS like a side panel, and the tempting
 * reading is that anything not full-width is desktop. #519 answers it directly:
 * "Un overlay modal con scrim no se considera automáticamente escritorio
 * interactivo solo por no ocupar todo el ancho. Mientras bloquee la página, se
 * comporta como chat-only."
 *
 * Navigating the page underneath a scrim the user cannot see through is worse
 * than not navigating: the chat says "I've applied those filters" and the user
 * is looking at a dimmed rectangle. So `docked` — which is true only from 1024,
 * where the panel is the shell's `aside` and the main column keeps its own
 * width — is the whole condition.
 *
 * ## It is re-read at EXECUTION time
 *
 * The executor calls this again just before it applies anything, because the
 * window can be resized mid-stream: "Si el usuario redimensiona o cambia de
 * presentación durante el streaming, mostrar el resultado en el chat en vez de
 * navegar una pantalla que ya no está disponible."
 */
export interface SindiControlCapability {
  /**
   * The main pane is visible, interactive and beside the chat.
   *
   * `visible && docked`. There is no third term to add: `docked` already
   * implies `visible` (see {@link useSindiPanelLayout}) and implies the shell
   * is rendering the panel as an aside rather than over the page — which is
   * exactly "mainPaneInteractive" expressed as the fact that produces it.
   */
  readonly canControlApp: boolean;
  /** Where a result belongs: the main pane, or the conversation. */
  readonly presentation: SindiPresentation;
}

export function useSindiControlCapability(): SindiControlCapability {
  const layout = useSindiPanelLayout();
  return controlCapabilityOf(layout);
}

/**
 * The same decision, as a pure function of the layout.
 *
 * Exported so the rule can be asserted at every breakpoint without rendering a
 * shell, and so the executor can re-derive it from a layout it already holds
 * rather than calling a hook in a callback.
 */
export function controlCapabilityOf(layout: SindiPanelLayout): SindiControlCapability {
  const canControlApp = layout.visible && layout.docked;
  return { canControlApp, presentation: canControlApp ? 'side_by_side' : 'chat_only' };
}
