/**
 * Unit tests for warmed Playwright session helpers (`session.ts`).
 * Uses mocked `page.request` — no real browser or portal hits.
 */

import {
  BrowserSessionChallengeError,
  exportStorageState,
  fetchJsonInPage,
  warmBrowserPage,
  type SessionContext,
  type SessionPage,
} from '@homiio/listing-providers/session';

interface MockRequestCall {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

function mockPage(options: {
  initialHtml?: string;
  finalHtml?: string;
  pageUrl?: string;
  requestStatus?: number;
  requestBody?: string;
  contentSequence?: string[];
  goto?: jest.Mock;
  waitForSelector?: jest.Mock;
}): { page: SessionPage; requestCalls: MockRequestCall[] } {
  const requestCalls: MockRequestCall[] = [];
  let contentIndex = 0;
  const contents = options.contentSequence ?? [
    options.initialHtml ?? '<html><article class="item">ok</article></html>',
  ];

  const page: SessionPage = {
    url: () => options.pageUrl ?? 'https://portal.example/search/',
    goto: options.goto ?? jest.fn(async () => undefined),
    content: jest.fn(async () => contents[Math.min(contentIndex++, contents.length - 1)] ?? contents[0]),
    waitForSelector: options.waitForSelector ?? jest.fn(async () => undefined),
    waitForTimeout: jest.fn(async () => undefined),
    route: jest.fn(async () => undefined),
    request: {
      get: jest.fn(async (url: string, opts?: { headers?: Record<string, string>; timeout?: number }) => {
        requestCalls.push({ url, headers: opts?.headers, timeout: opts?.timeout });
        return {
          status: () => options.requestStatus ?? 200,
          text: async () => options.requestBody ?? '{"items":[]}',
        };
      }),
    },
  };

  return { page, requestCalls };
}

function mockContext(storage?: { cookies: Array<{ name: string; value: string; domain: string; path: string }> }): {
  context: SessionContext;
  requestCalls: MockRequestCall[];
} {
  const requestCalls: MockRequestCall[] = [];
  const context: SessionContext = {
    storageState: jest.fn(async () => storage ?? { cookies: [{ name: 'dd', value: '1', domain: '.portal.example', path: '/' }] }),
    request: {
      get: jest.fn(async (url: string, opts?: { headers?: Record<string, string>; timeout?: number }) => {
        requestCalls.push({ url, headers: opts?.headers, timeout: opts?.timeout });
        return {
          status: () => 200,
          text: async () => '{"ok":true}',
        };
      }),
    },
  };
  return { context, requestCalls };
}

describe('warmBrowserPage', () => {
  it('resolves when content selector appears after goto', async () => {
    const { page } = mockPage({});
    await expect(
      warmBrowserPage(page, { warmUrl: 'https://portal.example/search/' }),
    ).resolves.toBeUndefined();
    expect(page.goto).toHaveBeenCalledWith('https://portal.example/search/', {
      timeout: 60_000,
      waitUntil: 'domcontentloaded',
    });
    expect(page.waitForSelector).toHaveBeenCalled();
  });

  it('polls through DataDome HTML then resolves', async () => {
    const challenge = '<html><script src="https://geo.captcha-delivery.com/x"></script></html>';
    const ok = `<html><body>${'x'.repeat(5000)}<article class="item">listing</article></body></html>`;
    const { page } = mockPage({ contentSequence: [challenge, ok] });
    await expect(
      warmBrowserPage(page, {
        warmUrl: 'https://portal.example/',
        challengeWaitMs: 10_000,
      }),
    ).resolves.toBeUndefined();
    expect(page.waitForTimeout).toHaveBeenCalled();
  });

  it('throws BrowserSessionChallengeError when challenge never clears', async () => {
    const challenge = '<html>geo.captcha-delivery.com</html>';
    const { page } = mockPage({
      contentSequence: [challenge, challenge, challenge],
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
    const ok = `<html><body>${'x'.repeat(5000)}<article class="item">listing</article></body></html>`;
    const goto = jest.fn(async () => undefined);
    const { page } = mockPage({
      contentSequence: [challenge, challenge, challenge, ok],
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
    const { page, requestCalls } = mockPage({
      pageUrl: 'https://portal.example/alquiler/madrid/',
      requestBody: '{"ads":[]}',
    });

    const result = await fetchJsonInPage(page, 'https://portal.example/es/ajax/listing/georeach/madrid-madrid');

    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ads":[]}');
    expect(requestCalls).toHaveLength(1);
    expect(requestCalls[0].url).toBe('https://portal.example/es/ajax/listing/georeach/madrid-madrid');
    expect(requestCalls[0].headers?.Referer).toBe('https://portal.example/alquiler/madrid/');
    expect(requestCalls[0].headers?.['X-Requested-With']).toBe('XMLHttpRequest');
    expect(requestCalls[0].headers?.Accept).toContain('application/json');
  });

  it('works with a browser context request (no page url)', async () => {
    const { context, requestCalls } = mockContext();

    const result = await fetchJsonInPage(context, 'https://portal.example/api/search', {
      referer: 'https://portal.example/',
      headers: { 'X-Custom': '1' },
    });

    expect(result.body).toBe('{"ok":true}');
    expect(requestCalls[0].headers?.Referer).toBe('https://portal.example/');
    expect(requestCalls[0].headers?.['X-Custom']).toBe('1');
  });

  it('forwards custom timeout to page.request', async () => {
    const { page, requestCalls } = mockPage({});
    await fetchJsonInPage(page, 'https://portal.example/api', { timeoutMs: 12_000 });
    expect(requestCalls[0].timeout).toBe(12_000);
  });

  it('returns non-200 status without throwing', async () => {
    const { page } = mockPage({ requestStatus: 403, requestBody: 'Forbidden' });
    const result = await fetchJsonInPage(page, 'https://portal.example/api/blocked');
    expect(result.status).toBe(403);
    expect(result.body).toBe('Forbidden');
  });

  it('uses explicit referer override when provided', async () => {
    const { page, requestCalls } = mockPage({ pageUrl: 'https://portal.example/search/' });
    await fetchJsonInPage(page, 'https://portal.example/api', {
      referer: 'https://portal.example/custom-referer/',
    });
    expect(requestCalls[0].headers?.Referer).toBe('https://portal.example/custom-referer/');
  });
});

describe('exportStorageState', () => {
  it('delegates to context.storageState()', async () => {
    const cookies = [{ name: 'datadome', value: 'abc', domain: '.idealista.com', path: '/' }];
    const { context } = mockContext({ cookies });
    await expect(exportStorageState(context)).resolves.toEqual({ cookies });
    expect(context.storageState).toHaveBeenCalledTimes(1);
  });
});
