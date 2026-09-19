/**
 * The side panel does not navigate the page it sits beside (#519 §8.7).
 *
 * ## The bug this gates
 *
 * `useSindiConversation` promoted a freshly-created conversation's id with an
 * unconditional `router.replace('/sindi/' + id)`. That is correct for the
 * full-screen route, which owns `/sindi/:id`. From the DOCKED PANEL it is a
 * disaster: the user is reading a listing, types into the panel, the chat is
 * persisted a second later — and the listing is replaced by the full-screen
 * chat. The panel navigated the page out from under itself.
 *
 * ## Why this is a source gate
 *
 * The failure needs a persisted conversation, a debounce, a router and a shell
 * to reproduce, and a test assembling all four would be asserting on its own
 * mocks. What it actually has to pin is a STRUCTURAL fact: the hook no longer
 * knows about the router at all, and each host decides for itself. That is one
 * grep, and it fails for exactly the change that would bring the bug back.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments } from '@homiio/shared-types/testing/stripComments';

const FRONTEND = join(__dirname, '..', '..');

const codeOf = (relativePath: string): string =>
  stripComments(readFileSync(join(FRONTEND, relativePath), 'utf8'));

describe('conversation-id promotion belongs to the host', () => {
  it('the shared hook does not navigate at all', () => {
    const hook = codeOf('hooks/useSindiConversation.ts');
    // Not "does not replace to /sindi": the hook must not hold a router,
    // because any navigation it performs is a navigation the panel cannot veto.
    expect(hook).not.toContain('useRouter');
    expect(hook).not.toContain('router.replace');
    expect(hook).not.toContain('router.push');
  });

  it('the hook offers the host a callback instead', () => {
    expect(codeOf('hooks/useSindiConversation.ts')).toContain('onConversationPersisted');
  });

  it('the full-screen route replaces its OWN address', () => {
    // Legitimate: that route IS `/sindi/:id`, so promoting the id corrects the
    // address the user is already looking at.
    const route = codeOf('app/(tabs)/sindi/[conversationId].tsx');
    expect(route).toContain('onConversationPersisted');
    expect(route).toContain('router.replace');
  });

  it('the side panel updates its selection and touches no route', () => {
    const panel = codeOf('components/sindi/SindiPanel.tsx');
    expect(panel).toContain('onConversationPersisted={setActiveConversationId}');
    expect(panel).not.toContain("router.replace(`/sindi/");
  });

  it('the in-property sheet drives nothing, and sends no app context', () => {
    // A sheet floating over a listing has no main pane of its own: navigating
    // the page beneath it is the same failure as navigating behind a scrim.
    const sheet = codeOf('components/property/SindiChatBottomSheet.tsx');
    expect(sheet).toContain('canSendAppContext={false}');
  });
});
