/**
 * Romania listing providers — Storia / Imobiliare.ro / OLX.ro (housing-only).
 * Pure fixture → parse → normalize tests (no network).
 */

import {
  StoriaProvider,
  parseStoriaDetail,
  parseStoriaSearch,
  STORIA_FIXTURE_DETAIL_HTML,
  STORIA_FIXTURE_RENT_DETAIL_HTML,
  STORIA_FIXTURE_SEARCH_HTML,
  ImobiliareRoProvider,
  parseImobiliareRoDetail,
  parseImobiliareRoSearch,
  IMOBILIARE_RO_FIXTURE_DETAIL_HTML,
  IMOBILIARE_RO_FIXTURE_SEARCH_HTML,
  OlxRoProvider,
  parseOlxRoDetail,
  parseOlxRoSearch,
  isOlxRoHousingCategory,
  OLX_RO_FIXTURE_DETAIL_HTML,
  OLX_RO_FIXTURE_NON_HOUSING_HTML,
  OLX_RO_FIXTURE_SEARCH_HTML,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

describe('StoriaProvider', () => {
  const provider = new StoriaProvider();

  it('declares RO market', () => {
    expect(provider.id).toBe('storia');
    expect(provider.markets).toEqual(['RO']);
  });

  it('parses search __NEXT_DATA__ into refs', () => {
    const refs = parseStoriaSearch(STORIA_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['9001001', '9001002']);
    expect(refs[0]?.url).toContain('/ro/oferta/');
  });

  it('normalizes sale detail with contact phone', () => {
    const payload = parseStoriaDetail(
      STORIA_FIXTURE_DETAIL_HTML,
      'https://www.storia.ro/ro/oferta/apartament-2-camere-titan-IDTEST1',
    );
    const listing = provider.normalize({
      ref: { provider: 'storia', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.offerings).toEqual([OfferingType.SALE]);
    expect(listing.sale?.price).toBe(89000);
    expect(listing.address.countryCode).toBe('RO');
    expect(listing.address.city).toBe('Bucuresti');
    expect(listing.bedrooms).toBe(2);
    expect(listing.contact?.phone).toBe('+40700000001');
    expect(listing.contact?.agencyName).toBe('Agent Test');
    expect(listing.remoteImages.length).toBe(2);
  });

  it('normalizes rent detail into long-term rent', () => {
    const payload = parseStoriaDetail(
      STORIA_FIXTURE_RENT_DETAIL_HTML,
      'https://www.storia.ro/ro/oferta/apartament-3-camere-inchiriere-IDRENT1',
    );
    const listing = provider.normalize({
      ref: { provider: 'storia', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(750);
    expect(listing.type).toBe(PropertyType.APARTMENT);
  });
});

describe('ImobiliareRoProvider', () => {
  const provider = new ImobiliareRoProvider();

  it('declares RO market', () => {
    expect(provider.id).toBe('imobiliare_ro');
    expect(provider.markets).toEqual(['RO']);
  });

  it('parses Inertia data-page search listings', () => {
    const refs = parseImobiliareRoSearch(IMOBILIARE_RO_FIXTURE_SEARCH_HTML);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.sourceId).toBe('201582656');
    expect(refs[0]?.hints?.agencyName).toBe('BECALI IMOBILIARE');
    expect(refs[1]?.hints?.offerType).toBe('rent');
  });

  it('normalizes JSON-LD detail with agency hint', () => {
    const payload = parseImobiliareRoDetail(
      IMOBILIARE_RO_FIXTURE_DETAIL_HTML,
      'https://www.imobiliare.ro/oferta/apartament-de-vanzare-pipera-3-camere-201582656',
      { agencyName: 'BECALI IMOBILIARE', offerType: 'sale' },
    );
    const listing = provider.normalize({
      ref: { provider: 'imobiliare_ro', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.sale?.price).toBe(228690);
    expect(listing.bedrooms).toBe(3);
    expect(listing.bathrooms).toBe(2);
    expect(listing.squareFootage).toBe(91.4);
    expect(listing.address.countryCode).toBe('RO');
    expect(listing.contact?.agencyName).toBe('BECALI IMOBILIARE');
  });
});

describe('OlxRoProvider (housing-only)', () => {
  const provider = new OlxRoProvider();

  it('declares RO market', () => {
    expect(provider.id).toBe('olx_ro');
    expect(provider.markets).toEqual(['RO']);
  });

  it('parses housing search offer links', () => {
    const refs = parseOlxRoSearch(OLX_RO_FIXTURE_SEARCH_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual(['IDj4PJt', 'IDkGrDt']);
  });

  it('normalizes housing detail with contact name/agency', () => {
    const payload = parseOlxRoDetail(
      OLX_RO_FIXTURE_DETAIL_HTML,
      'https://www.olx.ro/d/oferta/apartament-3-camere-68-mp-bloc-nou-IDj4PJt.html',
    );
    expect(isOlxRoHousingCategory(payload.categoryType)).toBe(true);
    const listing = provider.normalize({
      ref: { provider: 'olx_ro', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.sale?.price).toBe(112500);
    expect(listing.squareFootage).toBe(68);
    expect(listing.address.city).toBe('Bucuresti');
    expect(listing.contact?.name).toBe('Agent Test');
    expect(listing.contact?.agencyName).toBe('Ramis Steel Company');
  });

  it('rejects non-housing category fixtures', () => {
    const payload = parseOlxRoDetail(
      OLX_RO_FIXTURE_NON_HOUSING_HTML,
      'https://www.olx.ro/d/oferta/masina-IDcar1.html',
    );
    expect(isOlxRoHousingCategory(payload.categoryType)).toBe(false);
    expect(() =>
      provider.normalize({
        ref: { provider: 'olx_ro', sourceId: payload.sourceId, url: payload.url },
        payload,
      }),
    ).toThrow(/non-housing/);
  });
});
