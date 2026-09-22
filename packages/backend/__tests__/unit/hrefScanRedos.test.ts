/**
 * Nine providers copied one quadratic regex for reading search results.
 *
 *     /href=["']([^"']*\/inmueble\/(\d+)\/[^"']*)["']/gi
 *
 * Two unbounded `[^"']*` sit either side of the literal. On a long run of
 * non-quote characters that never contains `/inmueble/`, the engine retries
 * from every start position and rescans the run each time — O(n²). CodeQL:
 * `js/polynomial-redos`, four alerts from this shape alone (idealista,
 * idealista.it, idealista.pt, casa.it).
 *
 * The input is a remote portal's HTML, which is the definition of
 * attacker-influenced: a page that grows one long unquoted attribute is enough,
 * and it need not be deliberate — a base64 data URI does it.
 *
 * ## Two things have to hold, and one of them is the easy one to skip
 *
 * Replacing a search parser is only safe if it finds the same listings, so the
 * first half checks the new scan against the ORIGINAL regex as an oracle, on
 * shapes real pages produce. A parser that quietly stops finding homes looks
 * exactly like a portal that has gone quiet.
 *
 * The second half is the timing gate, sized so it FAILS against the old
 * pattern. An earlier batch in this series shipped a gate set at 16k decoys
 * where the old regex took 384ms against a 1s budget — a gate that could not
 * fail. The decoy count below is chosen from a measurement, not from taste.
 */

import { detailIds, hrefValues } from '@homiio/listing-providers/parse/hrefs';

/** The shape all four providers had copied, kept as the oracle. */
function legacyDetailIds(html: string, segment: string): string[] {
  const pattern = new RegExp(`href=["']([^"']*\\/${segment}\\/(\\d+)\\/[^"']*)["']`, 'gi');
  return [...html.matchAll(pattern)].map((match) => match[2]);
}

const SEARCH_PAGE = `
  <div class="results">
    <article><a href="/inmueble/12345678/">Piso en Gràcia</a></article>
    <article><a href='/inmueble/87654321/?utm_source=x'>Ático en Sants</a></article>
    <article><a href="https://www.idealista.com/inmueble/11112222/detalle">Con host</a></article>
    <article><a href="/inmueble/12345678/">El mismo, otra vez</a></article>
    <a href="/alquiler-viviendas/barcelona/">Not a listing</a>
    <a href="/inmueble/sin-numero/">No numeric id</a>
    <img src="/x.png" alt="no href here">
  </div>
`;

describe('detailIds matches the regex it replaced', () => {
  it('finds the same ids, in the same order, on a realistic page', () => {
    expect([...detailIds(SEARCH_PAGE, 'inmueble')]).toEqual(
      legacyDetailIds(SEARCH_PAGE, 'inmueble'),
    );
  });

  it('finds them at all', () => {
    // An oracle comparison passes when BOTH return nothing, which is precisely
    // the regression worth fearing here.
    expect([...detailIds(SEARCH_PAGE, 'inmueble')]).toEqual([
      '12345678', '87654321', '11112222', '12345678',
    ]);
  });

  it('keeps requiring the trailing slash, as the old regex did', () => {
    // `/inmueble/123` with no trailing slash was NOT matched before. Widening
    // it here would change four providers at once, silently.
    const html = '<a href="/inmueble/999">no trailing slash</a>';
    expect([...detailIds(html, 'inmueble')]).toEqual(legacyDetailIds(html, 'inmueble'));
    expect([...detailIds(html, 'inmueble')]).toEqual([]);
  });

  it('agrees with the oracle for every segment the four providers use', () => {
    for (const segment of ['inmueble', 'immobile', 'imovel', 'immobili']) {
      const html = `<a href="/x/${segment}/4242/y">z</a><a href="/${segment}/7/">w</a>`;
      expect([...detailIds(html, segment)]).toEqual(legacyDetailIds(html, segment));
    }
  });

  it('does not let a segment argument act as a pattern', () => {
    // `segment` is always a literal today. The escape exists so that stays true
    // of the FUNCTION and not merely of its current callers.
    const html = '<a href="/inmuebleX/5/">dot should not be any-char</a>';
    expect([...detailIds(html, 'inmueble.')]).toEqual([]);
  });

  it('yields raw attribute values without collapsing duplicates', () => {
    // Callers dedupe on the id, not the URL: two different URLs can carry one
    // listing, and collapsing here would hide that from them.
    expect([...hrefValues('<a href="/a"></a><a href="/a"></a>')]).toEqual(['/a', '/a']);
  });
});

describe('the scan is linear where the old pattern was quadratic', () => {
  it('finishes an unterminated attribute the old pattern grinds on', () => {
    // THE INPUT MATTERS AND MOST GUESSES AT IT ARE WRONG.
    //
    // A page of many ordinary hrefs does NOT trigger this: each value is short
    // and closed by its quote, so the run the engine backtracks over is tens of
    // characters. The first draft of this gate used 40,000 such links and the
    // OLD pattern finished in 4ms — a gate that could not fail, which is the
    // same mistake an earlier batch in this series shipped.
    //
    // What is quadratic is ONE UNTERMINATED attribute whose content near-misses
    // the literal. `[^"']*` has no closing quote to stop at, so it runs to the
    // end of the document, and every one of its backtrack positions lands on a
    // `/inmueble/` that then fails at `(\d+)\/`. Measured here:
    //
    //     n=8000   96KB   legacy  228ms
    //     n=16000 188KB   legacy  905ms
    //     n=24000 281KB   legacy 2071ms    <- this case
    //     n=32000 375KB   legacy 3722ms
    //
    // Four times the work for twice the input, which is the definition. The
    // split scan takes 1ms on the same string. The budget sits between them:
    // four times under the old pattern, two thousand times over the new one.
    const html = `<a href="` + '/inmueble/12'.repeat(24_000);

    const started = Date.now();
    const ids = [...detailIds(html, 'inmueble')];
    const elapsed = Date.now() - started;

    // No closing quote, so there is no attribute value and nothing to find —
    // which is also what the old pattern concluded, after two seconds.
    expect(ids).toEqual([]);
    expect(elapsed).toBeLessThan(500);
  });

  it('still finishes fast when the page is large AND well-formed', () => {
    const html = '<a href="/alquiler-viviendas/barcelona/pagina-2.htm">x</a>'.repeat(40_000)
      + '<a href="/inmueble/424242/">real</a>';

    const started = Date.now();
    const ids = [...detailIds(html, 'inmueble')];

    expect(ids).toEqual(['424242']);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
