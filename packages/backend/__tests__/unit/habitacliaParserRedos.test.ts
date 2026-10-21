/**
 * Backtracking removed from Habitaclia's detail parser (batch 2 of 4).
 *
 * Four `js/polynomial-redos` alerts in this file. **Two of them are severe and
 * two could not be triggered at all**, so only two get a timing test. Measured
 * on the old patterns:
 *
 *              n = 8,000   n = 24,000   n = 48,000
 *   JSON-LD      147 ms      1,274 ms     5,252 ms
 *   itemprop     278 ms      2,541 ms    10,026 ms
 *   data-href      0 ms          0 ms         1 ms
 *   fallback       0 ms          1 ms         0 ms
 *
 * The `itemprop` one reaching ten seconds is the worst in the repository so
 * far, and it runs on every detail page this provider ingests — currently the
 * top-ingesting provider of any market.
 *
 * The two href patterns were rewritten anyway, because capturing an attribute
 * once and reading the id out of it is simpler than an ambiguous capture. They
 * get behaviour tests only; a timing assertion that cannot fail would say
 * nothing.
 */

import { parseHabitacliaDetail, parseHabitacliaSearch, scriptBlocks } from '@homiio/listing-providers';

describe('Habitaclia parser, pathological input', () => {
  it('scans JSON-LD blocks linearly', () => {
    // Old: 5,252 ms at this size and quadratic. New: under 1 ms. A one-second
    // budget fails the old implementation five times over.
    const pathological = '<script '.repeat(48_000);

    const started = Date.now();
    expect([...scriptBlocks(pathological, 'ld+json')]).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reads a price out of a page stuffed with itemprop="price"', () => {
    // Old: 10,026 ms — ten seconds, on a detail page. The fix bounds the
    // attribute run the pattern may skip.
    // The URL must carry `-i<digits>.htm`: the parser derives the source id
    // from it and throws first otherwise, which would make this test measure
    // the throw rather than the price scan.
    const pathological = `<html><body>${'itemprop="price"'.repeat(48_000)}</body></html>`;
    const url = 'https://www.habitaclia.com/alquiler-piso-gracia-barcelona-i123456789.htm';

    const started = Date.now();
    expect(() => parseHabitacliaDetail(pathological, url)).toThrow(); // no price -> validation
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('parseHabitacliaSearch (legacy markup path)', () => {
  it('still reads ids from data-href and href cards', () => {
    // The live portal serves JSON now, but this path still runs for pages whose
    // payload cannot be read, and for anything queued before that shipped.
    const html = [
      '<li data-href="https://www.habitaclia.com/alquiler-piso-gracia-barcelona-i98765432100000.htm">a</li>',
      '<a href="/alquiler-atico-sants-barcelona-i12345678900000.htm">b</a>',
    ].join('');

    const refs = parseHabitacliaSearch(html);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual([
      '12345678900000',
      '98765432100000',
    ]);
    expect(refs.every((ref) => ref.url.startsWith('https://www.habitaclia.com/'))).toBe(true);
  });

  it('strips the query before reading the id and before storing the URL', () => {
    // `data-href` carries `?from=list`. The id matcher is anchored at the end,
    // so the query has to come off first — and `sourceUrl` is a link people
    // click, so it comes off there too.
    const refs = parseHabitacliaSearch(
      '<li data-href="/alquiler-piso-x-i55551000001220.htm?from=list&amp;x=1">a</li>',
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].sourceId).toBe('55551000001220');
    expect(refs[0].url).not.toContain('?');
  });

  it('falls back to the no-prefix shape only for rental paths', () => {
    // The old pattern encoded `/alquiler-` inside the capture; dropping that
    // would start importing every six-digit link on the page.
    const rental = parseHabitacliaSearch('<a href="/alquiler-piso-barcelona-123456.htm">a</a>');
    expect(rental.map((ref) => ref.sourceId)).toEqual(['123456']);

    expect(parseHabitacliaSearch('<a href="/venta-piso-barcelona-123456.htm">a</a>')).toEqual([]);
    expect(parseHabitacliaSearch('<a href="/noticias/mercado-123456.htm">a</a>')).toEqual([]);
  });

  it('does not use the fallback when the primary shape already matched', () => {
    // `if (refs.length === 0)` — the fallback is a last resort, not an addition.
    const refs = parseHabitacliaSearch(
      '<a href="/alquiler-piso-x-i98765432100000.htm">a</a><a href="/alquiler-otro-654321.htm">b</a>',
    );
    expect(refs.map((ref) => ref.sourceId)).toEqual(['98765432100000']);
  });

  it('deduplicates a listing that appears as both data-href and href', () => {
    const refs = parseHabitacliaSearch(
      '<li data-href="/alquiler-x-i111111111.htm">a</li><a href="/alquiler-x-i111111111.htm">b</a>',
    );
    expect(refs).toHaveLength(1);
  });
});
