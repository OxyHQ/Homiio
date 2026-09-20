/**
 * Whether Sindi may act, and what acting means, for every HOST at every
 * breakpoint.
 *
 * The rule is a sentence in the issue and a small function in the code, and the
 * gap between them is where it will be broken. Four readings look reasonable
 * and are all wrong:
 *
 *  - "web means desktop" — a narrow browser tab is not a docked panel;
 *  - "not full width means side by side" — the 500–1023 overlay is narrower
 *    than the viewport and still covers the page behind a scrim;
 *  - "native means mobile" — a wide native tablet has a real main pane;
 *  - **"the layout is the whole answer"** — it is not, and that is what this
 *    file gained. `visible` and `docked` describe the PANEL. Two other surfaces
 *    render the same chat: the full-screen `/sindi` route and the in-property
 *    sheet. Deriving their behaviour from the panel's persisted open flag made
 *    the full-screen chat act on a wide window with the panel left open and
 *    refuse on the same window with it closed — the same turn, the same
 *    request, a different surface's state deciding.
 *
 * So the capability is asserted over the HOST and the layout together, for
 * every combination, with the platform nowhere in the inputs.
 */

import { controlCapabilityOf, type SindiChatHost } from '@/components/sindi/sindiHost';

const layout = (visible: boolean, docked: boolean) => ({ visible, docked, width: 380 });

/** The three tiers `useSindiPanelLayout` can produce, by the name they are known by. */
const DOCKED = layout(true, true);
const OVERLAY = layout(true, false);
const NO_PANEL = layout(false, false);

const HOSTS: readonly SindiChatHost[] = ['panel', 'screen', 'sheet'];
const LAYOUTS = [DOCKED, OVERLAY, NO_PANEL];

describe('the panel: the capability comes from the effective layout', () => {
  it('is side-by-side ONLY when the panel is docked as the shell aside', () => {
    expect(controlCapabilityOf('panel', DOCKED)).toEqual({
      canControlApp: true,
      actMode: 'beside',
      presentation: 'side_by_side',
    });
  });

  it('acts in the overlay tier too, and gets out of the way afterwards', () => {
    // The panel is visible and narrower than the viewport, which is exactly the
    // shape that reads as "desktop" to a width check. It is not: the page
    // behind it is covered. That used to make the action `inline` — a button.
    // It now acts and then dismisses the panel, because announcing a change
    // nobody can see and refusing to change anything are both worse than
    // changing it and stepping aside.
    expect(controlCapabilityOf('panel', OVERLAY)).toEqual({
      canControlApp: true,
      actMode: 'reveal',
      presentation: 'chat_only',
    });
  });

  it('offers rather than acts when no panel is rendering at all', () => {
    // Defensive: with `visible` false the panel mounts no chat, so nothing can
    // reach the executor from here. If a refactor makes it reachable, a surface
    // that is not on screen must not move the app.
    expect(controlCapabilityOf('panel', NO_PANEL)).toMatchObject({
      canControlApp: false,
      actMode: 'offer',
    });
  });
});

describe('the full-screen route: acting means leaving the chat', () => {
  it('acts, and answers the same thing at every breakpoint', () => {
    // THE REGRESSION THIS FILE EXISTS FOR. `sindiPanelOpen` is persisted, so a
    // wide-viewport user who left the panel open once reported `docked: true`
    // inside the full-screen chat for ever after, and the same chat behaved
    // differently for two people on the same screen size.
    for (const tier of LAYOUTS) {
      expect(controlCapabilityOf('screen', tier)).toEqual({
        canControlApp: true,
        actMode: 'leave',
        presentation: 'chat_only',
      });
    }
  });

  it('is never side-by-side, however wide the monitor', () => {
    // #519 §8.2 in its own words: "la ruta Sindi fullscreen en un monitor
    // grande sigue siendo chat-only". What changed is that chat-only no longer
    // means "does nothing" — it means the destination takes the screen.
    expect(controlCapabilityOf('screen', DOCKED).presentation).toBe('chat_only');
  });
});

describe('the in-property sheet: the one host that still does not act', () => {
  it('offers at every breakpoint, including a docked-capable one', () => {
    for (const tier of LAYOUTS) {
      expect(controlCapabilityOf('sheet', tier)).toEqual({
        canControlApp: false,
        actMode: 'offer',
        presentation: 'chat_only',
      });
    }
  });
});

describe('the invariants that hold across every host and tier', () => {
  it('never claims side-by-side without being the docked panel', () => {
    for (const host of HOSTS) {
      for (const tier of LAYOUTS) {
        const capability = controlCapabilityOf(host, tier);
        expect(capability.presentation === 'side_by_side').toBe(capability.actMode === 'beside');
      }
    }
  });

  it('claims control exactly when it has a mode that does something', () => {
    for (const host of HOSTS) {
      for (const tier of LAYOUTS) {
        const capability = controlCapabilityOf(host, tier);
        expect(capability.canControlApp).toBe(capability.actMode !== 'offer');
      }
    }
  });

  it('gives every host a mode', () => {
    // A vacuity floor: nine combinations, and a switch that stopped covering
    // one of them would answer `undefined` rather than fail a matcher above.
    const modes = HOSTS.flatMap((host) =>
      LAYOUTS.map((tier) => controlCapabilityOf(host, tier).actMode),
    );
    expect(modes).toHaveLength(9);
    expect(modes.every((mode) => ['beside', 'reveal', 'leave', 'offer'].includes(mode))).toBe(true);
  });
});
