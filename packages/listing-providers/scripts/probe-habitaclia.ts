/**
 * One-off Habitaclia endpoint probe (run locally with LISTING_RESIDENTIAL_PROXY_URL).
 * Not part of CI — delete or ignore after endpoint discovery.
 */

import { residentialProxyFromEnv, createProxiedFetch } from '../src/proxy';
import { parseHabitacliaSearch } from '../src/providers/habitaclia/parse';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const searchUrl = 'https://www.habitaclia.com/alquiler-barcelona.htm';

async function main(): Promise<void> {
  const proxy = residentialProxyFromEnv();
  if (!proxy) {
    console.error('LISTING_RESIDENTIAL_PROXY_URL not set');
    process.exit(1);
  }
  const proxiedFetch = await createProxiedFetch(proxy);
  const html = await (
    await proxiedFetch(searchUrl, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' },
    })
  ).text();
  console.log('search len', html.length, 'data-hrefs', (html.match(/data-href=/gi) ?? []).length);
  console.log('parse refs (href only)', parseHabitacliaSearch(html).length);

  const bundlePath = html.match(/\/dotnet\/scripts\/dist\/desktop\/listados-desktop-index-bundle\.js\?\d+/)?.[0];
  if (bundlePath) {
    const js = await (
      await proxiedFetch(`https://www.habitaclia.com${bundlePath}`, {
        headers: { 'User-Agent': UA, Referer: searchUrl },
      })
    ).text();
    const endpoints = [...new Set([...js.matchAll(/\/dotnet\/[a-zA-Z]+\/[a-zA-Z0-9]+/g)].map((m) => m[0]))].sort();
    console.log('listados bundle endpoints', endpoints);
  }

  const detailMatch = html.match(
    /data-href="(https:\/\/www\.habitaclia\.com\/alquiler[^"]+-i\d+\.htm)/,
  );
  const detailUrl = detailMatch?.[1]?.replace(/&amp;/g, '&');
  console.log('detail url', detailUrl?.slice(0, 100));
  if (detailUrl) {
    const dhtml = await (
      await proxiedFetch(detailUrl, {
        headers: { 'User-Agent': UA, Referer: searchUrl, 'Accept-Language': 'es-ES' },
      })
    ).text();
    console.log(
      'detail len',
      dhtml.length,
      'jsonld blocks',
      (dhtml.match(/application\/ld\+json/gi) ?? []).length,
    );
    const dotnetDetail = [
      ...new Set([...dhtml.matchAll(/\/dotnet\/[a-zA-Z]+\/[a-zA-Z0-9]+/g)].map((m) => m[0])),
    ].sort();
    console.log('detail dotnet', dotnetDetail);

    const fichaBundle = dhtml.match(/\/dotnet\/scripts\/dist\/desktop\/ficha[^"]+\.js\?\d+/)?.[0];
    if (fichaBundle) {
      const js = await (
        await proxiedFetch(`https://www.habitaclia.com${fichaBundle}`, {
          headers: { 'User-Agent': UA, Referer: detailUrl },
        })
      ).text();
      const endpoints = [
        ...new Set([...js.matchAll(/\/dotnet\/[a-zA-Z]+\/[a-zA-Z0-9]+/g)].map((m) => m[0])),
      ].sort();
      console.log('ficha bundle endpoints', endpoints);
      for (const needle of ['GetImagesInmueble', 'application/json', 'JSON.parse', 'ld+json']) {
        const i = js.indexOf(needle);
        if (i >= 0) console.log(needle, js.slice(Math.max(0, i - 60), i + 120).replace(/\s+/g, ' '));
      }
    }
  }

  const formData = new URLSearchParams();
  for (const m of html.matchAll(/<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi)) {
    if (m[1].startsWith('Filtros.') || m[1] === 'pagina') formData.set(m[1], m[2]);
  }
  formData.set('pagina', '2');
  const page2 = await proxiedFetch('https://www.habitaclia.com/dotnet/listados/listainmuebles', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: searchUrl,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,*/*',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: formData.toString(),
  });
  const page2Html = await page2.text();
  console.log(
    'page2 POST',
    page2.status,
    page2Html.length,
    'data-hrefs',
    (page2Html.match(/data-href=/gi) ?? []).length,
  );
}

void main();
