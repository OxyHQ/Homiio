/**
 * WHICH SURFACE is rendering the chat, and what "act on the app" means there.
 *
 * ## Why the host had to become an input
 *
 * The capability used to be a function of the LAYOUT alone:
 * `canControlApp = visible && docked`, where both terms come from
 * {@link useSindiPanelLayout} — the viewport width and `uiStore.sindiPanelOpen`.
 * That is the right answer for the panel and the wrong answer for everybody
 * else, because those two facts describe the PANEL and three different surfaces
 * render `ChatContent`:
 *
 *  - `SindiPanel` — docked as the shell's `aside` from 1024, an overlay from
 *    500 to 1023. Mounted by `app/_layout.tsx` BESIDE `<Slot/>`, so a route
 *    change never unmounts it.
 *  - `app/(tabs)/sindi/[conversationId].tsx` — the full-screen chat. It IS the
 *    routed screen, inside `<Slot/>`.
 *  - `components/property/SindiChatBottomSheet.tsx` — a sheet over a listing
 *    somebody is reading.
 *
 * Measured consequence of deriving the answer from the panel's state: on a
 * ≥1024 viewport with the panel left open — `sindiPanelOpen` is PERSISTED, so
 * it survives reloads — the full-screen chat read `docked === true` and acted;
 * with the panel closed, or the window narrowed, the same chat on the same turn
 * refused and offered a button instead. The surface's behaviour was decided by
 * an unrelated surface's flag. That is the bug behind "muéstrame pisos en
 * hamburg" doing nothing: the person was not in the tier the rule was written
 * for, so the app never moved.
 *
 * ## The rule this file encodes
 *
 * **Acting invisibly is worse than not acting, and refusing to act is worse
 * than both.** So every host acts, in the way that host makes visible:
 *
 * | Host | Layout | Mode | Why |
 * |---|---|---|---|
 * | `panel` | docked (≥1024) | `beside` | the page column is already on screen next to the chat |
 * | `panel` | overlay (500–1023) | `reveal` | the panel covers the page; it gets out of the way once the answer is written |
 * | `panel` | not visible | `offer` | nothing is rendering; defensive only |
 * | `screen` | any | `leave` | the chat is the whole screen, so acting means going to the destination |
 * | `sheet` | any | `offer` | it floats over a listing the person chose to read; it sends no app context either, so no action ever arrives |
 *
 * This SUPERSEDES #519 §8.1's chat-only column for the full-screen host — "no
 * sustituir la pantalla sin intervención". The user overrode it after
 * experiencing it ("debería interactuar como hablamos"): in a full-screen chat,
 * "muéstrame pisos" IS the intervention, and there is no other screen for the
 * answer to appear on. The overlay tier's rule survives in a different shape:
 * #519 §8.2 said an overlay behaves as chat-only because navigating under a
 * scrim announces a change nobody sees — so the panel is now dismissed rather
 * than the action refused.
 *
 * ## `Platform.OS` still appears nowhere
 *
 * The three cases #519 §8.2 lists a platform check would get wrong are all
 * still answered correctly: a narrow web tab is a `panel` host that is not
 * docked (`reveal`) or the `screen` host below 500 (`leave`); a wide native
 * tablet docks and gets `beside`. What changed is that "the Sindi route on a
 * big monitor" is no longer decided by how wide that monitor is.
 */

import type { SindiPresentation } from '@homiio/shared-types';

import { useSindiPanelLayout, type SindiPanelLayout } from '@/components/sindi/sindiPanelLayout';

/**
 * The surface rendering the conversation. Declared BY that surface — never
 * inferred from a pathname, because a route string is a fact about the address
 * bar and two of the three hosts render over whatever route is loaded.
 */
export type SindiChatHost = 'panel' | 'screen' | 'sheet';

/**
 * How an action becomes something the person can see.
 *
 * Each member names what the executor must do BEYOND performing the action, and
 * the difference between them is entirely about which surface the chat occupies
 * and whether performing the action would take that surface away.
 */
export type SindiActMode =
  /** Act in the main pane. The chat is beside it and stays put. */
  | 'beside'
  /**
   * Act, then close the panel covering the page — once the turn has finished
   * streaming, never before. See {@link SindiControlCapability} for the reason
   * the timing is part of the rule rather than an implementation detail.
   */
  | 'reveal'
  /**
   * Act by leaving the chat: the destination takes the screen. Deferred to the
   * end of the turn for the same reason as `reveal`.
   */
  | 'leave'
  /** Do not act. Offer the action inside the conversation instead. */
  | 'offer';

/**
 * Whether Sindi may act, how, and what the server is told.
 *
 * ## The timing is part of the rule, and it is measured
 *
 * The action frame is written to the data channel **before the first text
 * delta** — `pipeStreamingTextDataStream` in `backend/routes/ai.ts` awaits the
 * envelope and writes it ahead of the stream, on purpose, so the client applies
 * the action while the sentence describing it arrives. So at the moment the
 * executor runs, Sindi has said nothing yet.
 *
 * That is harmless for `beside`: the panel is mounted beside `<Slot/>`, so
 * navigating the page underneath it does not touch the chat. It is destructive
 * for the other two, because both of them make the chat's own surface go away:
 * closing the overlay panel unmounts `SindiPanel`, and navigating away from
 * `/sindi/:id` unmounts the routed screen. Either one, run on the frame that
 * arrives before the text, replaces a streaming answer with an empty screen —
 * the person asked a question, the app moved, and the reply they were owed
 * exists only on the server.
 *
 * Hence `reveal` and `leave` are deferred to the turn's end by
 * `useSindiActions.settleTurn`. The action is still APPLIED immediately where
 * applying is invisible-but-harmless (the search store, the results view); only
 * the part that removes the chat from the screen waits.
 *
 * ## It is re-read at EXECUTION time
 *
 * The executor re-derives this just before it applies anything, because the
 * window can be resized mid-stream: "Si el usuario redimensiona o cambia de
 * presentación durante el streaming, mostrar el resultado en el chat en vez de
 * navegar una pantalla que ya no está disponible." (#519 §8.2)
 */
export interface SindiControlCapability {
  /** Whether Sindi may act at all on this turn, without being pressed. */
  readonly canControlApp: boolean;
  /** What acting means here. See {@link SindiActMode}. */
  readonly actMode: SindiActMode;
  /**
   * Where a result belongs, as the wire contract states it.
   *
   * `side_by_side` is reserved for the ONE case that literally is side by side:
   * the docked panel. `reveal` and `leave` both act, and both still report
   * `chat_only`, because the field answers "is there a main pane beside the
   * chat right now?" — which is what the model would have to know to write
   * "I've opened this beside you". Widening it to mean "can act" would make
   * `SindiAppContext.presentation` describe two different things.
   */
  readonly presentation: SindiPresentation;
}

export function useSindiControlCapability(host: SindiChatHost): SindiControlCapability {
  const layout = useSindiPanelLayout();
  return controlCapabilityOf(host, layout);
}

/**
 * The same decision, as a pure function of the host and the layout.
 *
 * Exported so the rule can be asserted for every host at every breakpoint
 * without rendering a shell, and so the executor can re-derive it from a layout
 * it already holds rather than calling a hook in a callback.
 */
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
      // `docked` already implies `visible` (see `useSindiPanelLayout`), and it
      // is what tells the two panel placements apart: docked means the shell is
      // sizing a column for the panel, so the page keeps its own.
      if (layout.docked) return 'beside';
      // An invisible panel renders no `ChatContent`, so this is unreachable
      // today. It answers `offer` rather than acting because a panel that is
      // not on screen cannot show anybody what it did.
      return layout.visible ? 'reveal' : 'offer';
    case 'screen':
      // Deliberately independent of the layout. The full-screen chat is the
      // routed screen whatever the viewport does and whatever the panel's
      // persisted open flag says — which is exactly the coupling that made this
      // surface act or refuse at random.
      return 'leave';
    case 'sheet':
      return 'offer';
    default: {
      // The host set is closed, so a fourth surface is a COMPILE error here
      // rather than a chat that silently inherits somebody else's rule.
      const exhaustive: never = host;
      void exhaustive;
      return 'offer';
    }
  }
}
