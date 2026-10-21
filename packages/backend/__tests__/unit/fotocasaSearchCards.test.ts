/**
 * Fotocasa's search page carries thirty listings; its markup parser found one.
 *
 * `parseFotocasaSearch` reads anchors out of the rendered page. On the live
 * site that yields ONE ref for a page whose SSR payload holds thirty — measured
 * on a Barcelona rental search through the production proxy. Discover was
 * paginating correctly and collecting a thirtieth of every page, which is why
 * this provider produced tens of refs where a market-wide provider produces
 * 1,500.
 *
 * The suite could not see it: the existing SSR fixture carries
 * `window.__STATE__={"realEstates":[{propertyId, detailUrl}]}`, a shape the site
 * stopped serving. A fixture that has drifted from reality cannot fail for the
 * right reason, so `*_LIVE` was captured from the real page and both are kept.
 */

import {
  extractFotocasaSearchCards,
  fotocasaRefsFromSearchCards,
  FOTOCASA_FIXTURE_SSR_SEARCH_HTML,
  FOTOCASA_FIXTURE_SSR_SEARCH_HTML_LIVE,
} from '@homiio/listing-providers';

describe('fotocasaRefsFromSearchCards', () => {
  it('builds a ref for every card the live page carries', () => {
    const cards = extractFotocasaSearchCards(FOTOCASA_FIXTURE_SSR_SEARCH_HTML_LIVE);
    const refs = fotocasaRefsFromSearchCards(cards);

    expect(cards.size).toBe(3);
    expect(refs).toHaveLength(cards.size);
  });

  it('reads the legacy gateway card shape too', () => {
    // The gateway API returned a flat `detailUrl`; the live SSR payload uses a
    // `detail` locale map. Both reach this function — jobs queued before the
    // change, and the fallback paths — so both must resolve.
    const cards = extractFotocasaSearchCards(FOTOCASA_FIXTURE_SSR_SEARCH_HTML);
    const refs = fotocasaRefsFromSearchCards(cards);

    expect(cards.size).toBe(2);
    expect(refs).toHaveLength(2);
  });

  it('keeps the tracking query out of the stored source URL', () => {
    // `detailWithParams` carries `?from=list`. `sourceUrl` is a link real
    // people click and the query is not part of the listing's identity.
    for (const html of [FOTOCASA_FIXTURE_SSR_SEARCH_HTML, FOTOCASA_FIXTURE_SSR_SEARCH_HTML_LIVE]) {
      for (const ref of fotocasaRefsFromSearchCards(extractFotocasaSearchCards(html))) {
        expect(ref.url).not.toContain('?');
        expect(ref.url.startsWith('https://www.fotocasa.es/')).toBe(true);
      }
    }
  });

  it('keys every ref by the id the card map is keyed by', () => {
    // `yieldRefs` looks the card up again by `sourceId` to attach it as a hint.
    // If these disagreed, every ref would arrive with no listing and fall back
    // to a detail fetch — silently, and thirty times per page.
    const cards = extractFotocasaSearchCards(FOTOCASA_FIXTURE_SSR_SEARCH_HTML_LIVE);
    for (const ref of fotocasaRefsFromSearchCards(cards)) {
      expect(cards.has(ref.sourceId)).toBe(true);
      expect(ref.url).toContain(ref.sourceId);
    }
  });

  it('skips a card with no usable path rather than inventing one', () => {
    const cards = new Map<string, Record<string, unknown>>([
      ['1', {}],
      ['2', { detail: {} }],
      ['3', { detail: 'not-absolute' }],
      ['4', { detail: 'https://evil.example/es/x/4/d' }],
      ['5', { detail: { 'es-ES': '/es/alquiler/vivienda/x/5/d' } }],
    ]);

    // Only the site-relative path survives: an absolute URL from a card would
    // let a portal payload point `sourceUrl` anywhere it liked.
    expect(fotocasaRefsFromSearchCards(cards)).toEqual([
      { sourceId: '5', url: 'https://www.fotocasa.es/es/alquiler/vivienda/x/5/d' },
    ]);
  });

  it('returns nothing for an empty map', () => {
    expect(fotocasaRefsFromSearchCards(new Map())).toEqual([]);
  });
});
