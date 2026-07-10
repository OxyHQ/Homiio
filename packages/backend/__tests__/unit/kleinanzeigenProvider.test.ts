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
});
