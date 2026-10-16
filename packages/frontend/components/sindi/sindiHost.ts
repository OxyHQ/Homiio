/**
 * WHICH SURFACE is rendering the chat, and what "act on the app" means there.
 *
 * ## Why the host is an input
 *
 * Three surfaces hold a conversation with Sindi (or Alia), and they sit in
 * different places relative to the app:
 *
 *  - `SindiPanel` — docked as the shell's `aside` from 1024, an overlay from
 *    500 to 1023. Mounted by `app/_layout.tsx` BESIDE `<Slot/>`, so a route
 *    change never unmounts it.
 *  - `app/(tabs)/sindi/[conversationId].tsx` — the full-screen chat. It IS the
 *    routed screen, inside `<Slot/>`.
 *  - the SDK's one sheet (`AliaAskProvider`: "Ask Alia", "Ask Sindi about this
 *    home") — over whatever page the person was reading.
 *
 * The capability used to be derived from the PANEL's layout alone, so the
 * full-screen chat acted or refused depending on whether the persisted panel
 * flag happened to be open — "muéstrame pisos en hamburg" did nothing. Each
 * surface now declares its host and the answer follows from it.
 *
 * ## The rule this file encodes
 *
 * **Acting invisibly is worse than not acting, and refusing to act is worse
 * than both.** So every host that can show a result acts, in the way that host
 * makes visible:
 *
 * | Host | Layout | Mode | Why |
 * |---|---|---|---|
 * | `panel` | docked (≥1024) | `beside` | the page column is already on screen next to the chat |
 * | `panel` | overlay (500–1023) | `reveal` | the panel covers the page; it gets out of the way once the answer is written |
 * | `panel` | not visible | `offer` | nothing is rendering; defensive only |
 * | `screen` | any | `leave` | the chat is the whole screen, so acting means going to the destination |
 * | `sheet` | any | `offer` | it floats over a page the person chose to read; moving that page would take it away to show a result nobody can see |
 *
 * `offer` performs nothing and answers `inline`: the model is told the app was
 * not moved, and answers in the conversation, where catalogue results are drawn
 * as cards (`components/sindi/sindiToolRenderers.tsx`).
 *
 * ## `Platform.OS` appears nowhere
 *
 * A narrow web tab is a `panel` host that is not docked (`reveal`) or the
 * `screen` host below 500 (`leave`); a wide native tablet docks and gets
 * `beside`. Each is answered by its host and its tier, never by its platform.
 */

import type { SindiPresentation } from '@homiio/shared-types';

import { type SindiPanelLayout, useSindiPanelLayout } from '@/components/sindi/sindiPanelLayout';

/**
 * The surface rendering the conversation. Declared BY that surface — never
 * inferred from a pathname, because two of the three hosts render over
 * whatever route is loaded.
 */
export type SindiChatHost = 'panel' | 'screen' | 'sheet';

/** How an action becomes something the person can see. */
export type SindiActMode =
  /** Act in the main pane. The chat is beside it and stays put. */
  | 'beside'
  /** Act, then close the panel covering the page — once the turn has finished streaming. */
  | 'reveal'
  /** Act by leaving the chat: the destination takes the screen, once the turn has finished. */
  | 'leave'
  /** Do not act; the answer stays in the conversation. */
  | 'offer';

/**
 * Whether Sindi may act, how, and what the model is told.
 *
 * `reveal` and `leave` wait for the turn's end because a host-tool call arrives
 * mid-stream, before the model has finished the sentence describing it; see
 * `hooks/useSindiActions.ts`. The capability is re-read at EXECUTION time,
 * because the window can be resized mid-stream (#519 §8.2).
 */
export interface SindiControlCapability {
  /** Whether Sindi may act at all on this turn. */
  readonly canControlApp: boolean;
  /** What acting means here. See {@link SindiActMode}. */
  readonly actMode: SindiActMode;
  /**
   * `side_by_side` only for the docked panel: the field answers "is there a
   * main pane beside the chat right now?", which is what the model needs to
   * write "I've opened it beside you".
   */
  readonly presentation: SindiPresentation;
}

export function useSindiControlCapability(host: SindiChatHost): SindiControlCapability {
  const layout = useSindiPanelLayout();
  return controlCapabilityOf(host, layout);
}

/** The same decision, as a pure function of the host and the layout. */
export function controlCapabilityOf(
  host: SindiChatHost,
  layout: SindiPanelLayout,
): SindiControlCapability {
  const actMode = actModeOf(host, layout);
  return {
    canControlApp: actMode !== 'offer',
    actMode,
    presentation: actMode === 'beside' ? 'side_by_side' : 'chat_only',
  };
}

function actModeOf(host: SindiChatHost, layout: SindiPanelLayout): SindiActMode {
  switch (host) {
    case 'panel':
      // `docked` already implies `visible` (see `useSindiPanelLayout`).
      if (layout.docked) return 'beside';
      return layout.visible ? 'reveal' : 'offer';
    case 'screen':
      // Deliberately independent of the layout: the full-screen chat is the
      // routed screen whatever the viewport or the panel's persisted flag says.
      return 'leave';
    case 'sheet':
      return 'offer';
    default: {
      const exhaustive: never = host;
      void exhaustive;
      return 'offer';
    }
  }
}
