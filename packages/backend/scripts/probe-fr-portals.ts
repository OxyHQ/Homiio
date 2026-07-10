/**
 * One-shot FR portal probe (Playwright + residential proxy).
 * Never logs proxy password. Delete after use if not needed.
 */
import { chromium } from 'playwright';

const proxyUrl = process.env.LISTING_PROXY_URL;
if (!proxyUrl) {
  console.error('LISTING_PROXY_URL required');
  process.exit(1);
}

const u = new URL(proxyUrl);
const proxy = {
  server: `${u.protocol}//${u.hostname}:${u.port}`,
  username: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
};
console.log('proxy server', proxy.server, 'user len', proxy.username.length);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

async function probe(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n======== ${name} ========`);
  try {
    await fn();
  } catch (error) {
    console.log('ERROR', error instanceof Error ? error.message : error);
  }
}

await probe('BIENICI', async () => {
  const context = await browser.newContext({
    proxy,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    extraHTTPHeaders: { 'Accept-Language': 'fr-FR,fr;q=0.9' },
  });
  const page = await context.newPage();
  const ajax: { url: string; status: number; body: string }[] = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (/realEstateAd|graphql|api/i.test(url) && !/\.(js|css|png|jpg|woff)/i.test(url)) {
      try {
        const body = await res.text();
        ajax.push({ url, status: res.status(), body: body.slice(0, 500) });
      } catch {
        // ignore
      }
    }
  });
  await page.goto('https://www.bienici.com/recherche/location/paris-75000', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForTimeout(8000);
  const html = await page.content();
  console.log('page len', html.length, 'title', await page.title());
  console.log('ajax hits', ajax.length);
  for (const a of ajax.slice(0, 8)) {
    console.log(' ', a.status, a.url.slice(0, 120));
    const m = a.body.match(/"price"\s*:\s*(\d+)/g);
    console.log('   prices', m?.slice(0, 5), 'preview', a.body.slice(0, 150).replace(/\n/g, ' '));
  }
  const r = await page.request.get(
    'https://www.bienici.com/realEstateAds.json?filters=%7B%22propertyType%22%3A%5B%22flat%22%5D%2C%22type%22%3A%5B%22rent%22%5D%7D&page=1&perPage=5&onTheMarket=true&where=%7B%22inseeCodes%22%3A%5B75056%5D%7D',
    {
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: page.url(),
      },
    },
  );
  const body = await r.text();
  console.log('session search status', r.status());
  try {
    const data = JSON.parse(body) as {
      realEstateAds?: Array<{ id: string; price?: number; city?: string }>;
    };
    for (const ad of (data.realEstateAds ?? []).slice(0, 5)) {
      console.log(' ', ad.id, 'price=', ad.price, ad.city);
    }
  } catch {
    console.log('body', body.slice(0, 300));
  }
  const d = await page.request.get('https://www.bienici.com/realEstateAd.json?id=ag750725-49688129', {
    headers: { Accept: 'application/json', Referer: page.url() },
  });
  const dj = (await d.json()) as {
    price?: number;
    contactRelativeData?: { phoneToDisplay?: string; agencyNameToDisplay?: string };
  };
  console.log(
    'detail price',
    dj.price,
    'contact',
    dj.contactRelativeData?.phoneToDisplay,
    dj.contactRelativeData?.agencyNameToDisplay,
  );
  await context.close();
});

await probe('SELOGER', async () => {
  const context = await browser.newContext({
    proxy,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'fr-FR',
  });
  const page = await context.newPage();
  const ajax: string[] = [];
  page.on('response', (res) => {
    const url = res.url();
    if (/api|graphql|ajax|bff|search|classified/i.test(url) && res.status() < 400) {
      ajax.push(`${res.status()} ${url}`);
    }
  });
  await page.goto(
    'https://www.seloger.com/list.htm?projects=2&types=1,2&places=[{%22inseeCodes%22:[750056]}]&enterprise=0&qsVersion=1.0',
    { waitUntil: 'domcontentloaded', timeout: 90_000 },
  );
  await page.waitForTimeout(12000);
  const html = await page.content();
  console.log('len', html.length, 'title', await page.title());
  console.log('challenge', /datadome|captcha-delivery|geo\.captcha/i.test(html));
  console.log('ajax', ajax.slice(0, 15));
  console.log('hasInitial/NEXT', html.includes('initialData') || html.includes('__NEXT_DATA__'));
  await context.close();
});

await probe('LEBONCOIN', async () => {
  const context = await browser.newContext({
    proxy,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'fr-FR',
  });
  const page = await context.newPage();
  const ajax: { url: string; status: number; preview: string }[] = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (/finder|api\.leboncoin|graphql/i.test(url)) {
      try {
        const t = await res.text();
        ajax.push({ url, status: res.status(), preview: t.slice(0, 200) });
      } catch {
        // ignore
      }
    }
  });
  await page.goto('https://www.leboncoin.fr/recherche?category=10&locations=Paris', {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForTimeout(15000);
  const html = await page.content();
  console.log('len', html.length, 'title', await page.title());
  console.log('challenge', /datadome|captcha-delivery|geo\.captcha/i.test(html));
  console.log('has __NEXT_DATA__', html.includes('__NEXT_DATA__'));
  console.log('ajax', ajax.slice(0, 10));
  const r = await page.request.post('https://api.leboncoin.fr/finder/search', {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Referer: page.url(),
    },
    data: {
      filters: {
        category: { id: '10' },
        enums: { ad_type: ['offer'] },
        location: { locations: [{ city: 'Paris' }] },
      },
      limit: 3,
      offset: 0,
    },
  });
  const body = await r.text();
  console.log('finder status', r.status(), body.slice(0, 400));
  await context.close();
});

await browser.close();
