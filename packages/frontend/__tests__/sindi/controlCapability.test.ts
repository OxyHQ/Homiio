/**
 * Whether Sindi may drive the app, at every breakpoint (#519 §8.2).
 *
 * The rule is a sentence in the issue and a one-line function in the code, and
 * the gap between them is where it will be broken. Three readings look
 * reasonable and are all wrong:
 *
 *  - "web means desktop" — a narrow browser tab is chat-only;
 *  - "not full width means side by side" — the 500–1023 overlay is narrower
 *    than the viewport and still blocks the page behind a scrim;
 *  - "native means mobile" — a wide native tablet has a real main pane.
 *
 * So the capability is asserted over the LAYOUT the shell actually produces,
 * for every tier, with the platform nowhere in the inputs.
 */

import { controlCapabilityOf } from '@/components/sindi/sindiPanelLayout';

const layout = (visible: boolean, docked: boolean) => ({ visible, docked, width: 380 });

describe('the capability comes from the effective layout', () => {
  it('is side-by-side ONLY when the panel is docked as the shell aside', () => {
    expect(controlCapabilityOf(layout(true, true))).toEqual({
      canControlApp: true,
      presentation: 'side_by_side',
    });
  });

  it('is chat-only for the overlay tier, scrim and all', () => {
    // The panel is visible and narrower than the viewport, which is exactly the
    // shape that reads as "desktop" to a width check. It is not: the page
    // behind it is covered, so navigating it would announce a change nobody
    // can see.
    expect(controlCapabilityOf(layout(true, false))).toEqual({
      canControlApp: false,
      presentation: 'chat_only',
    });
  });

  it('is chat-only when there is no panel at all', () => {
    // Below 500 the sidebar row navigates to `/sindi`, so the chat IS the
    // screen — on a phone and on a large monitor alike.
    expect(controlCapabilityOf(layout(false, false))).toEqual({
      canControlApp: false,
      presentation: 'chat_only',
    });
  });

  it('is chat-only for a closed panel even if the viewport could dock one', () => {
    // `docked` is defined as `visible && wide`, so this combination should not
    // arise — and if a refactor makes it arise, the answer must still be no.
    expect(controlCapabilityOf(layout(false, true)).canControlApp).toBe(false);
  });

  it('never claims side-by-side without claiming control, or the reverse', () => {
    for (const visible of [false, true]) {
      for (const docked of [false, true]) {
        const capability = controlCapabilityOf(layout(visible, docked));
        expect(capability.presentation === 'side_by_side').toBe(capability.canControlApp);
      }
    }
  });
});
