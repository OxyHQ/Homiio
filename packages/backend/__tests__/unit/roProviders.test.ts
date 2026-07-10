/**
 * Romania listing providers — Storia / Imobiliare.ro / OLX.ro (housing-only).
 * Pure fixture tests; no live network.
 */

import {
  StoriaProvider,
  parseStoriaDetail,
  parseStoriaSearch,
  STORIA_FIXTURE_DETAIL_HTML,
  STORIA_FIXTURE_SEARCH_HTML,
  ImobiliareRoProvider,
  parseImobiliareRoDetail,
  parseImobiliareRoSearch,
  IMOBILIARE_RO_FIXTURE_DETAIL_HTML,
  IMOBILIARE_RO_FIXTURE_SEARCH_HTML,
  OlxRoProvider,
  parseOlxRoDetail,
  parseOlxRoSearch,
  mergeOlxRoPhone,
  isOlxRoHousingCategory,
  isHousingCategoryUrl,
  NonHousingListingError,
  OLX_RO_FIXTURE_DETAIL_HTML,
  OLX_RO_FIXTURE_NON_HOUSING_HTML,
  OLX_RO_FIXTURE_SEARCH_HTML,
  OLX_RO_HOUSING_SLUGS,
  OLX_RO_BASE_URL,
} from '@homiio/listing-providers';
import type { ExternalListingRef } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const storia = new StoriaProvider();
const imobiliare = new ImobiliareRoProvider();
const olx = new OlxRoProvider();

describe('StoriaProvider (RO)', () => {
  it('parses searchAds items from __NEXT_DATA__', () => {
    const refs = parseStoriaSearch(STORIA_FIXTURE_SEARCH_HTML);
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs[0].sourceId).toMatch(/IDTEST1|9001001/);
  });

  it('normalizes detail with contact phones', () => {
    const payload = parseStoriaDetail(
      STORIA_FIXTURE_DETAIL_HTML,
      'https://www.storia.ro/ro/oferta/apartament-2-camere-titan-IDTEST1',
    );
    const listing = storia.normalize({
      ref: { provider: 'storia', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('storia');
    expect(listing.address.countryCode).toBe('RO');
    expect(listing.contact?.phone).toContain('40700000001');
    expect(listing.type).toBe(PropertyType.APARTMENT);
  });
});

describe('ImobiliareRoProvider (RO)', () => {
  it('parses Inertia data-page search listings', () => {
    const refs = parseImobiliareRoSearch(IMOBILIARE_RO_FIXTURE_SEARCH_HTML);
    expect(refs).toHaveLength(2);
    expect(refs[0].sourceId).toBe('201582656');
    expect(refs[0].hints?.agencyName).toBe('BECALI IMOBILIARE');
  });

  it('normalizes JSON-LD detail with agency hint', () => {
    const payload = parseImobiliareRoDetail(
      IMOBILIARE_RO_FIXTURE_DETAIL_HTML,
      'https://www.imobiliare.ro/oferta/apartament-de-vanzare-pipera-3-camere-201582656',
      { agencyName: 'BECALI IMOBILIARE', offerType: 'sale' },
    );
    const listing = imobiliare.normalize({
      ref: { provider: 'imobiliare_ro', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('imobiliare_ro');
    expect(listing.offerings).toEqual([OfferingType.SALE]);
    expect(listing.sale?.price).toBe(228690);
    expect(listing.contact?.agencyName).toBe('BECALI IMOBILIARE');
    expect(listing.bedrooms).toBe(3);
  });
});

describe('OlxRoProvider housing-only (RO)', () => {
  it('search ignores non-housing slug noise', () => {
    const refs = parseOlxRoSearch(OLX_RO_FIXTURE_SEARCH_HTML);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.sourceId)).toEqual(['IDj4PJt', 'IDkGrDt']);
  });

  it('accepts real_estate detail and merges phone AJAX', () => {
    const payload = parseOlxRoDetail(
      OLX_RO_FIXTURE_DETAIL_HTML,
      'https://www.olx.ro/d/oferta/apartament-3-camere-68-mp-bloc-nou-IDj4PJt.html',
    );
    expect(isOlxRoHousingCategory(payload.categoryType)).toBe(true);
    expect(payload.contact?.agencyName).toBe('Ramis Steel Company');
    const withPhone = mergeOlxRoPhone(payload, JSON.stringify({ data: ['+40721111222'] }));
    const ref: ExternalListingRef = {
      provider: 'olx_ro',
      sourceId: withPhone.sourceId,
      url: withPhone.url,
    };
    const listing = olx.normalize({ ref, payload: withPhone });
    expect(listing.source).toBe('olx_ro');
    expect(listing.contact?.phone).toContain('40721111222');
    expect(listing.squareFootage).toBe(68);
  });

  it('rejects non-housing category in normalize', () => {
    const payload = parseOlxRoDetail(
      OLX_RO_FIXTURE_NON_HOUSING_HTML,
      'https://www.olx.ro/d/oferta/masina-IDcar1.html',
    );
    expect(isOlxRoHousingCategory(payload.categoryType)).toBe(false);
    expect(() =>
      olx.normalize({
        ref: { provider: 'olx_ro', sourceId: payload.sourceId, url: payload.url },
        payload,
      }),
    ).toThrow(NonHousingListingError);
  });

  it('discover URLs stay on imobiliare allowlist', () => {
    const housing = `${OLX_RO_BASE_URL}/imobiliare/apartamente-garsoniere-de-inchiriat/bucuresti/`;
    expect(isHousingCategoryUrl(housing, OLX_RO_HOUSING_SLUGS)).toBe(true);
    expect(
      isHousingCategoryUrl(`${OLX_RO_BASE_URL}/electronice/telefoane/`, OLX_RO_HOUSING_SLUGS),
    ).toBe(false);
  });
});
