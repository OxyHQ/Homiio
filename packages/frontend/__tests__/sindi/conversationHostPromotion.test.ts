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
    // A sheet floating over a listing has no main pane of its own: moving the
    // page beneath it would take away the listing somebody chose to read, to
    // show a result the sheet is sitting on top of. Declaring the host is what
    // says so now — the app context follows from the capability, so there is no
    // second switch to set the other way.
    const sheet = codeOf('components/property/SindiChatBottomSheet.tsx');
    expect(sheet).toContain('host="sheet"');
  });
});

describe('every host declares which surface it is', () => {
  // The capability used to be derived from the panel's layout for all three,
  // which meant the full-screen chat's behaviour was decided by whether an
  // unrelated, PERSISTED flag had left the side panel open. A host that forgets
  // to declare itself is a TypeScript error (`ChatContent`'s `host` prop is
  // required), so what these pin is that each one declares the RIGHT thing —
  // which types cannot check and a mistake in which is silent.
  it.each([
    ['components/sindi/SindiPanel.tsx', 'host="panel"'],
    ['app/(tabs)/sindi/[conversationId].tsx', 'host="screen"'],
    ['components/property/SindiChatBottomSheet.tsx', 'host="sheet"'],
  ])('%s declares %s', (file, declaration) => {
    expect(codeOf(file)).toContain(declaration);
  });

  it('no host smuggles the old boolean back in', () => {
    // `canSendAppContext` meant "I am the bottom sheet" in everything but name.
    // Re-adding it beside the host would give one surface two answers.
    for (const file of [
      'components/sindi/ChatContent.tsx',
      'components/sindi/SindiPanel.tsx',
      'app/(tabs)/sindi/[conversationId].tsx',
      'components/property/SindiChatBottomSheet.tsx',
    ]) {
      expect(codeOf(file)).not.toContain('canSendAppContext');
    }
  });
});

describe('every destination the executor can reach is a real route', () => {
  // A CTA that ends on the wrong screen is one of the things both epics forbid
  // outright ("ni CTAs que terminan en una pantalla incorrecta"), and it is the
  // failure a types-only check cannot see: `router.push('/sved')` compiles.
  //
  // Expo Router derives routes from the filesystem, so the check is that each
  // path the executor can produce has a file behind it.
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  const appDir = join(FRONTEND, 'app');

  const ROUTE_FILES: ReadonlyArray<[string, readonly string[]]> = [
    ['/explore', ['explore/index.tsx']],
    ['/saved', ['(tabs)/saved/index.tsx']],
    ['/saved/[folderId]', ['(tabs)/saved/[folderId]/index.tsx', '(tabs)/saved/[folderId].tsx']],
    ['/', ['(tabs)/index.tsx']],
    ['/my-home', ['my-home.tsx']],
    ['/evictions', ['evictions/index.tsx']],
    ['/properties/[id]', ['properties/[id]/index.tsx', 'properties/[id].tsx']],
  ];

  it.each(ROUTE_FILES)('%s exists', (route, candidates) => {
    const found = candidates.some((candidate) => existsSync(join(appDir, candidate)));
    expect({ route, found }).toEqual({ route, found: true });
  });

  it('the executor names no path outside that table', () => {
    // Every absolute-path STRING LITERAL in the executor, wherever it sits —
    // the destination table, a `pathname:` field or a bare `router.push`. A
    // narrower pattern matched the two inline pushes and missed the five in the
    // lookup table, which is the shape of scan that reports clean while the
    // thing it was written for walks past.
    const executor = codeOf('hooks/useSindiActions.ts');
    const paths = [...executor.matchAll(/'(\/[^']*)'/g)].map((match) => match[1]);
    const known = new Set(ROUTE_FILES.map(([route]) => route));

    expect(paths.filter((path) => !known.has(path))).toEqual([]);
    // A vacuity floor: a regex that stopped matching would pass the line above.
    expect(paths.length).toBeGreaterThanOrEqual(ROUTE_FILES.length - 1);
  });
});
