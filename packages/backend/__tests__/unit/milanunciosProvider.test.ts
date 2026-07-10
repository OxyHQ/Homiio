/**
 * milanuncios provider — housing-only classifieds filter tests (pure).
 */

import {
  MilanunciosProvider,
  parseMilanunciosAdvert,
  parseMilanunciosSearchJson,
  NonHousingListingError,
  MILANUNCIOS_FIXTURE_HOUSING_JSON,
  MILANUNCIOS_FIXTURE_CAR_JSON,
  MILANUNCIOS_FIXTURE_SEARCH_JSON,
  milanunciosHousingSearchUrl,
  MILANUNCIOS_HOUSING_CATEGORY_SLUGS,
  isHousingCategoryUrl,
} from '@homiio/listing-providers';
import type { ExternalListingRef } from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';

const provider = new MilanunciosProvider();

describe('MilanunciosProvider housing filter', () => {
  it('accepts a housing advert fixture', () => {
    const payload = parseMilanunciosAdvert(JSON.parse(MILANUNCIOS_FIXTURE_HOUSING_JSON) as unknown);
    const ref: ExternalListingRef = {
      provider: 'milanuncios',
      sourceId: payload.sourceId,
      url: payload.url,
    };
    const listing = provider.normalize({ ref, payload });
    expect(listing.source).toBe('milanuncios');
    expect(listing.sourceId).toBe('5123456789');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1400);
    expect(listing.type).toBe(PropertyType.APARTMENT);
    expect(listing.contact?.phone).toBe('612345678');
  });

  it('rejects a car advert fixture', () => {
    const payload = parseMilanunciosAdvert(JSON.parse(MILANUNCIOS_FIXTURE_CAR_JSON) as unknown);
    const ref: ExternalListingRef = {
      provider: 'milanuncios',
      sourceId: payload.sourceId,
      url: payload.url,
    };
    expect(() => provider.normalize({ ref, payload })).toThrow(NonHousingListingError);
  });

  it('search JSON only yields housing-category refs', () => {
    const mixed = JSON.stringify({
      adverts: [
        JSON.parse(MILANUNCIOS_FIXTURE_HOUSING_JSON),
        JSON.parse(MILANUNCIOS_FIXTURE_CAR_JSON),
      ],
    });
    const refs = parseMilanunciosSearchJson(mixed);
    expect(refs).toHaveLength(1);
    expect(refs[0].sourceId).toBe('5123456789');
  });

  it('parses housing search fixture', () => {
    expect(parseMilanunciosSearchJson(MILANUNCIOS_FIXTURE_SEARCH_JSON)).toHaveLength(1);
  });

  it('discover URLs are scoped to housing category allowlist', () => {
    expect(isHousingCategoryUrl(milanunciosHousingSearchUrl('madrid'), MILANUNCIOS_HOUSING_CATEGORY_SLUGS)).toBe(
      true,
    );
    expect(
      isHousingCategoryUrl('https://www.milanuncios.com/coches-en-madrid/', MILANUNCIOS_HOUSING_CATEGORY_SLUGS),
    ).toBe(false);
  });
});
