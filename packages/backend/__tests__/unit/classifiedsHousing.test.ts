/**
 * Shared classifieds housing guards (`parse/classifieds.ts`).
 * Pure unit tests — no DB, no live portal hits.
 */

import {
  NonHousingListingError,
  assertHousingListing,
  isHousingCategory,
  isHousingCategoryUrl,
} from '@homiio/listing-providers';

const HOUSING_SLUGS = new Set(['inmuebles', 'alquiler', 'wohnung-mieten']);

describe('isHousingCategory', () => {
  it('accepts housing-related category tokens', () => {
    expect(isHousingCategory('alquiler')).toBe(true);
    expect(isHousingCategory('wohnung_mieten')).toBe(true);
    expect(isHousingCategory('inmobiliaria')).toBe(true);
    expect(isHousingCategory('apartamentos en alquiler')).toBe(true);
  });

  it('rejects automotive and job categories', () => {
    expect(isHousingCategory('coches')).toBe(false);
    expect(isHousingCategory('empleo')).toBe(false);
    expect(isHousingCategory('motor')).toBe(false);
    expect(isHousingCategory('')).toBe(false);
    expect(isHousingCategory(undefined)).toBe(false);
  });
});

describe('isHousingCategoryUrl', () => {
  it('matches allowlisted housing slugs in the path', () => {
    expect(
      isHousingCategoryUrl('https://www.milanuncios.com/inmuebles-en-madrid/', HOUSING_SLUGS),
    ).toBe(true);
    expect(
      isHousingCategoryUrl('https://www.kleinanzeigen.de/s-wohnung-mieten/berlin/', HOUSING_SLUGS),
    ).toBe(true);
  });

  it('rejects non-housing category URLs', () => {
    expect(
      isHousingCategoryUrl('https://www.milanuncios.com/coches-en-madrid/', HOUSING_SLUGS),
    ).toBe(false);
  });
});

describe('assertHousingListing', () => {
  const baseSignals = {
    category: 'alquiler',
    hasAddressLike: true,
    hasPrice: true,
    squareMeters: 65,
    bedrooms: 2,
  };

  it('accepts a housing listing with category and property signals', () => {
    expect(() => assertHousingListing('milanuncios', '123', baseSignals)).not.toThrow();
  });

  it('rejects listings missing price', () => {
    expect(() =>
      assertHousingListing('kleinanzeigen', '999', { ...baseSignals, hasPrice: false }),
    ).toThrow(NonHousingListingError);
    try {
      assertHousingListing('kleinanzeigen', '999', { ...baseSignals, hasPrice: false });
    } catch (error) {
      expect(error).toBeInstanceOf(NonHousingListingError);
      if (error instanceof NonHousingListingError) {
        expect(error.reason).toMatch(/missing price/);
      }
    }
  });

  it('rejects explicit non-housing categories', () => {
    expect(() =>
      assertHousingListing('milanuncios', 'car-1', {
        ...baseSignals,
        category: 'coches',
      }),
    ).toThrow(NonHousingListingError);
  });

  it('rejects listings with no housing category and no property signals', () => {
    expect(() =>
      assertHousingListing('olx', 'gadget-1', {
        category: 'electronics',
        hasAddressLike: true,
        hasPrice: true,
      }),
    ).toThrow(NonHousingListingError);
  });
});
