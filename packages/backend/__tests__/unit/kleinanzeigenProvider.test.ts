/**
 * Kleinanzeigen provider — housing-only classifieds filter tests (pure).
 */

import {
  KleinanzeigenProvider,
  parseKleinanzeigenSearch,
  parseKleinanzeigenDetail,
  kleinanzeigenHousingSearchUrl,
  isKleinanzeigenHousingCategory,
  NonHousingListingError,
  KLEINANZEIGEN_FIXTURE_SEARCH_HTML,
  KLEINANZEIGEN_FIXTURE_DETAIL_HTML,
  KLEINANZEIGEN_FIXTURE_DETAIL_ENRICHED_HTML,
  KLEINANZEIGEN_FIXTURE_NON_HOUSING_HTML,
} from '@homiio/listing-providers';
import type { ExternalListingRef } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new KleinanzeigenProvider();

describe('KleinanzeigenProvider housing filter', () => {
  it('search HTML only yields housing-category refs', () => {
    const refs = parseKleinanzeigenSearch(KLEINANZEIGEN_FIXTURE_SEARCH_HTML);
    expect(refs).toHaveLength(2);
    expect(refs.every((ref) => isKleinanzeigenHousingCategory(ref.categoryId))).toBe(true);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['3367000001', '3367000002']);
  });

  it('normalizes a housing detail fixture with contact', () => {
    const url =
      'https://www.kleinanzeigen.de/s-anzeige/helle-2-zimmer-wohnung-in-mitte/3367000001-203-3331';
    const payload = parseKleinanzeigenDetail(KLEINANZEIGEN_FIXTURE_DETAIL_HTML, url);
    const ref: ExternalListingRef = {
      provider: 'kleinanzeigen',
      sourceId: payload.sourceId,
      url: payload.url,
    };
    const listing = provider.normalize({ ref, payload });
    expect(listing.source).toBe('kleinanzeigen');
    expect(listing.sourceId).toBe('3367000001');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1250);
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.address.countryCode).toBe('DE');
    expect(listing.contact?.phone).toMatch(/493098765432/);
    expect(listing.contact?.whatsapp).toMatch(/493098765432/);
    // Full gallery is captured (not just og:image), deduped by base id,
    // normalized to the largest `$_57.AUTO` variant, og:image primary.
    expect(listing.remoteImages).toHaveLength(3);
    expect(listing.remoteImages[0]?.url).toBe(
      'https://img.kleinanzeigen.de/api/v1/prod-ads/images/aa/example-1?rule=$_57.AUTO',
    );
    expect(listing.remoteImages[0]?.isPrimary).toBe(true);
    expect(listing.remoteImages.every((image) => image.url.endsWith('?rule=$_57.AUTO'))).toBe(true);
  });

  it('extracts amenities + bathrooms + yearBuilt + agency contact from real markup', () => {
    const url =
      'https://www.kleinanzeigen.de/s-anzeige/modernes-apartment/3382686830-203-3436';
    const payload = parseKleinanzeigenDetail(KLEINANZEIGEN_FIXTURE_DETAIL_ENRICHED_HTML, url);
    const ref: ExternalListingRef = {
      provider: 'kleinanzeigen',
      sourceId: payload.sourceId,
      url: payload.url,
    };
    const listing = provider.normalize({ ref, payload });
    // Structured fields the earlier parser dropped (Badezimmer / Baujahr).
    expect(listing.bathrooms).toBe(1);
    expect(listing.floor).toBe(1);
    expect(listing.yearBuilt).toBe(2019);
    // Amenities from the `checktag` Ausstattung tags; non-amenity tags
    // (Einbauküche, Neubau) are dropped by the canonicalizer.
    expect((listing.amenities ?? []).length).toBeGreaterThan(0);
    expect(listing.amenities).toEqual(
      expect.arrayContaining(['balcony', 'disabled_access', 'heating', 'elevator']),
    );
    // Commercial poster: agency name captured from the userprofile-vip span.
    expect(listing.contact?.agencyName).toMatch(/Müller Merkle/);
    expect(listing.contact?.kind).toBe('agency');
  });

  it('rejects non-housing detail HTML', () => {
    const url = 'https://www.kleinanzeigen.de/s-anzeige/bmw-320i/1111222333-216-3331';
    expect(() => parseKleinanzeigenDetail(KLEINANZEIGEN_FIXTURE_NON_HOUSING_HTML, url)).toThrow(
      NonHousingListingError,
    );
  });

  it('discover URLs are scoped to housing categories', () => {
    const url = kleinanzeigenHousingSearchUrl('berlin', 1, '203');
    expect(url).toContain('/c203');
    expect(url).toContain('wohnung-mieten');
    expect(() => kleinanzeigenHousingSearchUrl('berlin', 1, '216')).toThrow(/not a housing category/);
  });

  // Regression for the polynomial-ReDoS pair CodeQL flagged on the amenity and
  // poster-name patterns. Portal HTML is untrusted, so a page that repeats the
  // `checktag` / `userprofile-vip` markers must not blow up parse time. Both
  // patterns were quadratic before; a 20k-repetition page took seconds and now
  // completes in milliseconds. The bound is deliberately loose so this asserts
  // "not quadratic" rather than a wall-clock figure.
  it('parses a hostile repetition-heavy detail page in linear time', () => {
    const url = 'https://www.kleinanzeigen.de/s-anzeige/wohnung/1111222333-203-3331';
    const flood = 'class="checktag"'.repeat(20000) + 'class="userprofile-vip'.repeat(20000);
    const hostile = KLEINANZEIGEN_FIXTURE_DETAIL_ENRICHED_HTML.replace(
      '</body>',
      `<div>${flood}</div></body>`,
    );

    const started = Date.now();
    parseKleinanzeigenDetail(hostile, url);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('paginates with `seite:N` before the category code (keeps the category filter)', () => {
    // Appending `/seite:N` AFTER the `c203l…` code drops the category filter and
    // returns a site-wide page; the page segment must sit before the code.
    expect(kleinanzeigenHousingSearchUrl('berlin', 2, '203')).toBe(
      'https://www.kleinanzeigen.de/s-wohnung-mieten/berlin/seite:2/c203l3331',
    );
    expect(kleinanzeigenHousingSearchUrl('muenchen', 3, '205')).toBe(
      'https://www.kleinanzeigen.de/s-haus-mieten/muenchen/seite:3/c205l6411',
    );
  });
});
