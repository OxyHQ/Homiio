/**
 * One-off probe: residential proxy + Idealista/Habitaclia warm paths.
 * Usage: LISTING_RESIDENTIAL_PROXY_URL='http://...' bun run packages/listing-providers/scripts/probe-es-warm.ts
 */

import {
  createProxiedFetch,
  createProxySessionId,
  parseResidentialProxyUrl,
  toPlaywrightProxy,
  withStickySessionUsername,
} from '../src/proxy';
import { loadPlaywright } from '../src/browser';
import { warmBrowserPage, setupAssetBlocking } from '../src/session';
import { idealistaWarmSearchUrl } from '../src/providers/idealista/georeach';
import { habitacliaWarmSearchUrl, HABITACLIA_LISTING_CARD_SELECTOR } from '../src/providers/habitaclia/listainmuebles';
import { isIdealistaChallenge } from '../src/providers/idealista/index';
import { isHabitacliaChallenge } from '../src/providers/habitaclia/index';

const PROXY_RAW = process.env.LISTING_RESIDENTIAL_PROXY_URL?.trim();
const STICKY = process.env.LISTING_PROXY_STICKY === 'true';
const GEO = 'es';

async function probeHttp(label: string, url: string): Promise<void> {
  const proxy = parseResidentialProxyUrl(PROXY_RAW);
  if (!proxy) {
    console.log(`[${label}] skip — no proxy`);
    return;
  }
  const sessionId = STICKY ? createProxySessionId() : undefined;
  const proxied = await createProxiedFetch(proxy, sessionId, GEO);
  const start = Date.now();
  try {
    const res = await proxied(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(45_000),
    });
    const body = await res.text();
    console.log(
      `[${label}] HTTP ${res.status} ${body.length}B ${Date.now() - start}ms challenge=${/captcha-delivery|datadome|incapsula|403 ERROR/i.test(body)}`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`[${label}] HTTP FAIL ${Date.now() - start}ms — ${msg}`);
  }
}

async function probeWarm(label: string, url: string, isChallenge: (html: string) => boolean, selector: string, blockAssets: boolean): Promise<void> {
  const proxy = parseResidentialProxyUrl(PROXY_RAW);
  const pw = await loadPlaywright();
  if (!proxy || !pw) {
    console.log(`[${label}] skip — proxy or playwright missing`);
    return;
  }
  const sessionId = STICKY ? createProxySessionId() : undefined;
  const username = sessionId
    ? withStickySessionUsername(proxy.username, sessionId, GEO)
    : proxy.username;
  console.log(`[${label}] sticky user format: ${username.slice(0, 24)}...`);
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    proxy: toPlaywrightProxy(proxy, sessionId, GEO),
    locale: 'es-ES',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' },
  });
  const page = await context.newPage();
  await setupAssetBlocking(page, blockAssets);
  const start = Date.now();
  try {
    await warmBrowserPage(page, {
      warmUrl: url,
      timeoutMs: 90_000,
      challengeWaitMs: 90_000,
      isChallenge,
      contentSelector: selector,
      reloadAfterPolls: 4,
    });
    const html = await page.content();
    console.log(`[${label}] WARM OK ${Date.now() - start}ms ${html.length}B`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`[${label}] WARM FAIL ${Date.now() - start}ms — ${msg}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

console.log('proxy configured:', Boolean(PROXY_RAW), 'sticky:', STICKY, 'geo:', GEO);

await probeHttp('idealista-search', idealistaWarmSearchUrl('madrid', 1));
await probeHttp('habitaclia-search', habitacliaWarmSearchUrl('madrid', 1));

await probeWarm('idealista-search', idealistaWarmSearchUrl('madrid', 1), isIdealistaChallenge, 'article.item, .items-list', false);
await probeWarm('habitaclia-search', habitacliaWarmSearchUrl('madrid', 1), isHabitacliaChallenge, HABITACLIA_LISTING_CARD_SELECTOR, true);
