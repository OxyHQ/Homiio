/**
 * One-off Italian portal probe — captures URL patterns + AJAX during warm-up.
 * Never logs proxy password.
 */
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

function proxyFromSsm(): { server: string; username: string; password: string } | undefined {
  try {
    const raw = execSync(
      'aws ssm get-parameter --name "/oxy/homiio/LISTING_RESIDENTIAL_PROXY_URL" --with-decryption --profile oxy --region us-west-2 --query Parameter.Value --output text',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    const u = new URL(raw);
    if (!u.username || !u.password) return undefined;
    return {
      server: `${u.protocol}//${u.hostname}:${u.port || '823'}`,
      username: u.username,
      password: u.password,
    };
  } catch {
    return undefined;
  }
}

const PORTALS: ReadonlyArray<{ name: string; searchUrl: string; locale: string }> = [
  {
    name: 'idealista.it',
    searchUrl: 'https://www.idealista.it/affitto-case/roma-roma/',
    locale: 'it-IT',
  },
  {
    name: 'immobiliare.it',
    searchUrl: 'https://www.immobiliare.it/affitto-case/roma/',
    locale: 'it-IT',
  },
  {
    name: 'casa.it',
    searchUrl: 'https://www.casa.it/affitto/roma/',
    locale: 'it-IT',
  },
  {
    name: 'subito.it',
    searchUrl: 'https://www.subito.it/annunci-lazio/affitto/appartamenti/roma/',
    locale: 'it-IT',
  },
];

async function probePortal(
  proxy: { server: string; username: string; password: string } | undefined,
  portal: { name: string; searchUrl: string; locale: string },
): Promise<void> {
  const captured: Array<{ url: string; status: number; ct: string; len: number }> = [];

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    proxy,
  });

  const context = await browser.newContext({
    locale: portal.locale,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  page.on('response', async (response) => {
    const url = response.url();
    if (!/idealista|immobiliare|casa\.it|subito/i.test(url)) return;
    const ct = response.headers()['content-type'] ?? '';
    if (!/json|javascript|text\/html/i.test(ct) && !/\/api\/|\/ajax\//i.test(url)) return;
    let len = 0;
    try {
      const body = await response.text();
      len = body.length;
    } catch {
      /* aborted */
    }
    captured.push({ url, status: response.status(), ct, len });
  });

  console.log(`\n========== ${portal.name} ==========`);
  console.log('proxy:', proxy ? 'yes' : 'no');
  try {
    await page.goto(portal.searchUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForTimeout(8_000);
  } catch (e) {
    console.log('goto error:', e instanceof Error ? e.message : String(e));
  }

  const html = await page.content();
  console.log('HTML length:', html.length);
  console.log('Challenge:', /datadome|captcha|acceso denegado|verifica/i.test(html));

  const ldJsonCount = (html.match(/application\/ld\+json/gi) ?? []).length;
  console.log('JSON-LD blocks:', ldJsonCount);

  const nextData = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    return el?.textContent?.length ?? 0;
  });
  console.log('__NEXT_DATA__ length:', nextData);

  const detailPatterns = [
    /\/immobile\/(\d+)/gi,
    /\/inmueble\/(\d+)/gi,
    /\/annunci\/(\d+)/gi,
    /\/annunci\/[^"']+-(\d{6,})/gi,
    /href=["']([^"']*\/\d{6,}[^"']*)["']/gi,
  ];
  for (const re of detailPatterns) {
    const matches = [...html.matchAll(re)].slice(0, 5);
    if (matches.length > 0) {
      console.log(`Pattern ${re.source}:`, matches.map((m) => m[0]).join(' | '));
    }
  }

  const ajaxCandidates: string[] = [];
  if (portal.name === 'idealista.it') {
    ajaxCandidates.push(
      'https://www.idealista.it/it/ajax/listing/georeach/roma-roma',
      'https://www.idealista.it/ajax/listing/georeach/roma-roma',
    );
  }

  for (const url of ajaxCandidates) {
    try {
      const result = await page.evaluate(async (ajaxUrl) => {
        const res = await fetch(ajaxUrl, {
          headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
          credentials: 'include',
        });
        const body = await res.text();
        return { status: res.status, len: body.length, preview: body.slice(0, 200) };
      }, url);
      console.log(`AJAX ${url}: status=${result.status} len=${result.len}`);
      console.log('  preview:', result.preview.replace(/\s+/g, ' '));
    } catch (e) {
      console.log(`AJAX ${url}: ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log('Top captured responses:');
  for (const entry of captured.sort((a, b) => b.len - a.len).slice(0, 15)) {
    console.log(`  ${entry.status} len=${entry.len} ${entry.ct.slice(0, 40)} ${entry.url.slice(0, 120)}`);
  }

  await browser.close();
}

async function main(): Promise<void> {
  const proxy = proxyFromSsm();
  console.log('Proxy configured:', proxy ? 'yes (password redacted)' : 'no');
  for (const portal of PORTALS) {
    await probePortal(proxy, portal);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
