/**
 * Kleinanzeigen provider contract test (housing-only classifieds guard).
 */

import {
  KleinanzeigenProvider,
  KLEINANZEIGEN_FIXTURE_DETAIL_HTML,
  KLEINANZEIGEN_FIXTURE_NON_HOUSING_HTML,
  KLEINANZEIGEN_FIXTURE_SEARCH_HTML,
  parseKleinanzeigenDetail,
  parseKleinanzeigenSearch,
  isKleinanzeigenHousingCategory,
  kleinanzeigenSourceIdFromUrl,
} from '@homiio/listing-providers';
import type { RawListing } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new KleinanzeigenProvider();
const DETAIL_URL =
  'https://www.kleinanzeigen.de/s-anzeige/helle-2-zimmer-wohnung-in-mitte/3367000001-203-3331';

describe('KleinanzeigenProvider', () => {
  it('declares the DE market and kleinanzeigen id', () => {
    expect(provider.id).toBe('kleinanzeigen');
    expect(provider.markets).toEqual(['DE']);
  });

  it('parses housing search links and skips non-housing categories', () => {
    const refs = parseKleinanzeigenSearch(KLEINANZEIGEN_FIXTURE_SEARCH_HTML);
    expect(refs).toHaveLength(2);
    expect(refs.every((ref) => isKleinanzeigenHousingCategory(ref.categoryId))).toBe(true);
    expect(refs.map((ref) => ref.sourceId)).toEqual(['3367000001', '3367000002']);
  });

  it('parses a housing detail page with contact', () => {
    const raw = parseKleinanzeigenDetail(KLEINANZEIGEN_FIXTURE_DETAIL_HTML, DETAIL_URL);
    expect(raw.sourceId).toBe('3367000001');
    expect(raw.categoryId).toBe('203');
    expect(raw.price).toBe(1250);
    expect(raw.bedrooms).toBe(2);
    expect(raw.squareMeters).toBe(65);
    expect(raw.address.city).toBe('Berlin');
    expect(raw.contact?.phone).toBe('+493098765432');
    expect(raw.contact?.whatsapp).toBe('493098765432');
  });

  it('rejects non-housing category detail pages', () => {
    expect(() =>
      parseKleinanzeigenDetail(
        KLEINANZEIGEN_FIXTURE_NON_HOUSING_HTML,
        'https://www.kleinanzeigen.de/s-anzeige/bmw-320i/1111222333-216-3331',
      ),
    ).toThrow(/non-housing category/);
  });

  it('normalizes a housing fixture into a published rental', () => {
    const payload = parseKleinanzeigenDetail(KLEINANZEIGEN_FIXTURE_DETAIL_HTML, DETAIL_URL);
    const listing = provider.normalize({
      ref: { provider: 'kleinanzeigen', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('kleinanzeigen');
    expect(listing.status).toBe('published');
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1250);
    expect(listing.address.countryCode).toBe('DE');
    expect(listing.contact?.phone).toBeTruthy();
  });

  it('rejects normalize of non-housing payloads', () => {
    const bad: RawListing = {
      ref: {
        provider: 'kleinanzeigen',
        sourceId: '1111222333',
        url: 'https://www.kleinanzeigen.de/s-anzeige/bmw/1111222333-216-3331',
      },
      payload: {
        sourceId: '1111222333',
        url: 'https://www.kleinanzeigen.de/s-anzeige/bmw/1111222333-216-3331',
        categoryId: '216',
        operation: 'sale',
        price: 12000,
        currency: 'EUR',
        address: { street: 'x', city: 'Berlin' },
        images: [],
      },
    };
    expect(() => provider.normalize(bad)).toThrow(/non-housing/);
  });

  it('extracts source ids from detail URLs', () => {
    expect(kleinanzeigenSourceIdFromUrl(DETAIL_URL)).toBe('3367000001');
  });

  it('reports healthy', async () => {
    const health = await provider.health();
    expect(health.provider).toBe('kleinanzeigen');
    expect(health.status).toBe('healthy');
  });
});
