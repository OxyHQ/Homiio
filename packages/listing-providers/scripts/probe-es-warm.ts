/**
 * One-off probe: residential proxy + Idealista/Habitaclia warm paths.
 * Usage: LISTING_RESIDENTIAL_PROXY_URL='http://...' bun run packages/listing-providers/scripts/probe-es-warm.ts
 */

import { createProxiedFetch, createProxySessionId, parseResidentialProxyUrl, toPlaywrightProxy } from '../src/proxy';
import { loadPlaywright } from '../src/browser';
import { idealistaWarmSearchUrl } from '../src/providers/idealista/georeach';
import { habitacliaWarmSearchUrl } from '../src/providers/habitaclia/listainmuebles';

const PROXY_RAW = process.env.LISTING_RESIDENTIAL_PROXY_URL?.trim();
const STICKY = process.env.LISTING_PROXY_STICKY === 'true';

async function probeHttp(label: string, url: string): Promise<void> {
  const proxy = parseResidentialProxyUrl(PROXY_RAW);
  if (!proxy) {
    console.log(`[${label}] skip — no proxy`);
    return;
  }
  const sessionId = STICKY ? createProxySessionId() : undefined;
  const proxied = await createProxiedFetch(proxy, sessionId);
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

async function probeGoto(
  label: string,
  url: string,
  waitUntil: 'commit' | 'domcontentloaded' | 'load',
): Promise<void> {
  const proxy = parseResidentialProxyUrl(PROXY_RAW);
  const pw = await loadPlaywright();
  if (!proxy || !pw) {
    console.log(`[${label}] skip — proxy or playwright missing`);
    return;
  }
  const sessionId = STICKY ? createProxySessionId() : undefined;
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    proxy: toPlaywrightProxy(proxy, sessionId),
    locale: 'es-ES',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' },
  });
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'stylesheet' || type === 'font' || type === 'media') {
      await route.abort();
      return;
    }
    await route.continue();
  });
  const start = Date.now();
  try {
    await page.goto(url, { timeout: 45_000, waitUntil });
    const html = await page.content();
    console.log(
      `[${label}] goto(${waitUntil}) ok ${html.length}B ${Date.now() - start}ms challenge=${/captcha-delivery|datadome|incapsula/i.test(html)}`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`[${label}] goto(${waitUntil}) FAIL ${Date.now() - start}ms — ${msg}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

const idealistaHome = 'https://www.idealista.com/';
const idealistaSearch = idealistaWarmSearchUrl('madrid', 1);
const habitacliaHome = 'https://www.habitaclia.com/';
const habitacliaSearch = habitacliaWarmSearchUrl('madrid', 1);

console.log('proxy configured:', Boolean(PROXY_RAW), 'sticky:', STICKY);

await probeHttp('idealista-home', idealistaHome);
await probeHttp('idealista-search', idealistaSearch);
await probeHttp('habitaclia-home', habitacliaHome);
await probeHttp('habitaclia-search', habitacliaSearch);

await probeGoto('idealista-home', idealistaHome, 'commit');
await probeGoto('idealista-search', idealistaSearch, 'commit');
await probeGoto('idealista-search-dcl', idealistaSearch, 'domcontentloaded');
await probeGoto('habitaclia-home', habitacliaHome, 'commit');
await probeGoto('habitaclia-search', habitacliaSearch, 'commit');
