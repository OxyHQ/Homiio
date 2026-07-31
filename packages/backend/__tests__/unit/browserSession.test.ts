/**
 * Unit tests for warmed Playwright session helpers (`session.ts`).
 * Uses mocked `page.request` — no real browser or portal hits.
 *
 * Fixture HTML must exceed 512 bytes — {@link isDataDomeHtmlChallenge} treats
 * shorter bodies as unresolved challenges and warmBrowserPage would poll until
 * timeout.
 */

import {
  BrowserSessionChallengeError,
  BrowserSessionNavigationError,
  exportStorageState,
  fetchJsonInPage,
  warmBrowserPage,
  type SessionContext,
  type SessionPage,
} from '../../../listing-providers/dist/session';

const PAD = 'x'.repeat(520);

function listingHtml(markup: string): string {
  return `<html><body>${PAD}${markup}</body></html>`;
}

/**
 * The jest handles the assertions below reach for. Intersected with the real
 * `SessionPage` rather than replacing it, so a mock that stops matching the
 * contract — a method added to the interface, a signature changed — fails to
 * compile here instead of passing against a shape the production code would
 * never receive.
 */
type MockPage = SessionPage & {
  goto: jest.Mock;
  content: jest.Mock;
  waitForSelector: jest.Mock;
  waitForTimeout: jest.Mock;
  route: jest.Mock;
  request: { get: jest.Mock; post: jest.Mock };
};

/**
 * Every path exercised here goes through `page.request`, never `page.evaluate`
 * — whose real implementation runs `fetch` inside the browser. Throwing keeps
 * that true: a test that starts routing through it fails loudly instead of
 * silently receiving a canned 200 (or reaching the network for real).
 */
const unstubbedEvaluate: SessionPage['evaluate'] = async () => {
  throw new Error('page.evaluate is not stubbed in this suite');
};

function buildPage(overrides: Partial<MockPage> & { contents?: string[] } = {}): MockPage {
  let index = 0;
  const contents = overrides.contents ?? [listingHtml('<article class="item">ok</article>')];
  return {
    url: overrides.url ?? (() => 'https://portal.example/search/'),
    goto: overrides.goto ?? jest.fn(async () => undefined),
    content:
      overrides.content ??
      jest.fn(async () => contents[Math.min(index++, contents.length - 1)] ?? contents[0]),
    waitForSelector: overrides.waitForSelector ?? jest.fn(async () => undefined),
    waitForTimeout: overrides.waitForTimeout ?? jest.fn(async () => undefined),
    route: overrides.route ?? jest.fn(async () => undefined),
    evaluate: overrides.evaluate ?? unstubbedEvaluate,
    request: overrides.request ?? buildRequestContext(),
  };
}

/** A `PwAPIRequestContext` stand-in; `post` is unused here but part of the contract. */
function buildRequestContext(
  get: jest.Mock = jest.fn(async () => ({ status: () => 200, text: async () => '{"items":[]}' })),
): { get: jest.Mock; post: jest.Mock } {
  return { get, post: jest.fn(async () => ({ status: () => 200, text: async () => '' })) };
}

describe('warmBrowserPage', () => {
  it('resolves when content selector appears after goto', async () => {
    const page = buildPage();
    await expect(
      warmBrowserPage(page, { warmUrl: 'https://portal.example/search/' }),
    ).resolves.toBeUndefined();
    expect(page.goto).toHaveBeenCalledWith('https://portal.example/search/', {
      timeout: 60_000,
      waitUntil: 'commit',
    });
    expect(page.waitForSelector).toHaveBeenCalled();
  });

  it('polls through DataDome HTML then resolves', async () => {
    const challenge = '<html><script src="https://geo.captcha-delivery.com/x"></script></html>';
    const page = buildPage({
      contents: [challenge, listingHtml('<article class="item">listing</article>')],
    });
    await expect(
      warmBrowserPage(page, {
        warmUrl: 'https://portal.example/',
        challengeWaitMs: 10_000,
      }),
    ).resolves.toBeUndefined();
    expect(page.waitForTimeout).toHaveBeenCalled();
  });

  it('throws BrowserSessionNavigationError when goto times out', async () => {
    const page = buildPage({
      goto: jest.fn(async () => {
        throw new Error('goto: Timeout 60000ms exceeded. Call log: waiting until "commit"');
      }),
    });
    await expect(
      warmBrowserPage(page, {
        warmUrl: 'https://portal.example/',
        timeoutMs: 100,
        challengeWaitMs: 100,
      }),
    ).rejects.toBeInstanceOf(BrowserSessionNavigationError);
  });

  it('throws BrowserSessionChallengeError when challenge never clears', async () => {
    const challenge = '<html>geo.captcha-delivery.com</html>';
    const page = buildPage({
      contents: [challenge, challenge, challenge],
      waitForSelector: jest.fn(async () => {
        throw new Error('timeout');
      }),
    });
    await expect(
      warmBrowserPage(page, {
        warmUrl: 'https://portal.example/',
        challengeWaitMs: 100,
        postChallengeSettleMs: 0,
      }),
    ).rejects.toBeInstanceOf(BrowserSessionChallengeError);
  });

  it('reloads warmUrl after stalled challenge polls', async () => {
    const challenge = '<html><script src="https://geo.captcha-delivery.com/x"></script></html>';
    const goto = jest.fn(async () => undefined);
    const page = buildPage({
      contents: [challenge, challenge, challenge, listingHtml('<article class="item">listing</article>')],
      goto,
    });

    await warmBrowserPage(page, {
      warmUrl: 'https://portal.example/search/',
      challengeWaitMs: 5_000,
      reloadAfterPolls: 2,
      postChallengeSettleMs: 0,
    });

    expect(goto.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('fetchJsonInPage', () => {
  it('uses page.request with XHR headers and page URL as Referer', async () => {
    const get = jest.fn(async (_url: string, opts?: { headers?: Record<string, string> }) => ({
      status: () => 200,
      text: async () => '{"ads":[]}',
      headers: opts?.headers,
    }));
    const page = buildPage({
      url: () => 'https://portal.example/alquiler/madrid/',
      request: buildRequestContext(get),
    });

    const result = await fetchJsonInPage(page, 'https://portal.example/es/ajax/listing/georeach/madrid-madrid');

    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ads":[]}');
    expect(get).toHaveBeenCalledWith(
      'https://portal.example/es/ajax/listing/georeach/madrid-madrid',
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: 'https://portal.example/alquiler/madrid/',
          'X-Requested-With': 'XMLHttpRequest',
        }),
      }),
    );
  });

  it('returns non-200 status without throwing', async () => {
    const page = buildPage({
      request: buildRequestContext(
        jest.fn(async () => ({ status: () => 403, text: async () => 'Forbidden' })),
      ),
    });
    const result = await fetchJsonInPage(page, 'https://portal.example/api/blocked');
    expect(result.status).toBe(403);
    expect(result.body).toBe('Forbidden');
  });
});

describe('exportStorageState', () => {
  it('delegates to context.storageState()', async () => {
    const cookies = [{ name: 'datadome', value: 'abc', domain: '.idealista.com', path: '/' }];
    const context: SessionContext & { storageState: jest.Mock } = {
      storageState: jest.fn(async () => ({ cookies })),
      request: buildRequestContext(),
    };
    await expect(exportStorageState(context)).resolves.toEqual({ cookies });
    expect(context.storageState).toHaveBeenCalledTimes(1);
  });
});
