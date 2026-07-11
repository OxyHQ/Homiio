import {
  validateMonthlyRentAmount,
  validateNightlyRateAmount,
  validateSalePriceAmount,
  validateOfferingPrices,
  validateNormalizedListing,
  ListingValidationError,
  DEFAULT_MAX_REMOTE_IMAGES,
} from '@homiio/listing-providers';
import { OfferingType, PropertyType } from '@homiio/shared-types';
import type { NormalizedListing } from '@homiio/shared-types';

describe('price validation', () => {
  it('rejects absurd monthly rent for a 1-bedroom EUR listing', () => {
    const error = validateMonthlyRentAmount(11_628, 'EUR', { bedrooms: 1 });
    expect(error).toMatch(/exceeds.*10000/);
  });

  it('accepts a typical Madrid monthly rent', () => {
    expect(validateMonthlyRentAmount(1_450, 'EUR', { bedrooms: 1 })).toBeNull();
  });

  it('rejects likely nightly mistaken as monthly', () => {
    const error = validateMonthlyRentAmount(45, 'EUR', { bedrooms: 1 });
    expect(error).toMatch(/below minimum/);
  });

  it('rejects missing currency', () => {
    expect(validateMonthlyRentAmount(1200, '', { bedrooms: 1 })).toMatch(/currency is required/);
  });

  it('validates nightly and sale blocks', () => {
    expect(validateNightlyRateAmount(3_000, 'EUR')).toMatch(/exceeds maximum/);
    expect(validateSalePriceAmount(250_000, 'EUR')).toBeNull();
  });

  it('validateOfferingPrices returns first rent violation', () => {
    const error = validateOfferingPrices({
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 20_000, currency: 'EUR' },
      bedrooms: 1,
    });
    expect(error).toMatch(/exceeds/);
  });
});

describe('validateNormalizedListing', () => {
  const baseListing: NormalizedListing = {
    source: 'fixture',
    sourceId: 'fixture-test-1',
    sourceUrl: 'https://fixtures.homiio.com/test',
    address: { street: 'Carrer de Test', city: 'Barcelona' },
    type: PropertyType.APARTMENT,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 1450, currency: 'EUR' },
    remoteImages: [{ url: 'https://example.com/a.jpg', isPrimary: true }],
    status: 'published',
  };

  it('accepts a coherent listing', () => {
    expect(() => validateNormalizedListing(baseListing)).not.toThrow();
  });

  it('rejects missing sourceUrl', () => {
    expect(() => validateNormalizedListing({ ...baseListing, sourceUrl: '' })).toThrow(
      ListingValidationError,
    );
  });

  it('rejects absurd monthly rent at ingest gate', () => {
    expect(() =>
      validateNormalizedListing({
        ...baseListing,
        source: 'blueground',
        sourceId: 'bcn-1549599p',
        longTermRent: { monthlyAmount: 11_628, currency: 'EUR' },
        bedrooms: 1,
      }),
    ).toThrow(ListingValidationError);
  });

  it('truncates remoteImages to the cap instead of rejecting', () => {
    const images = Array.from({ length: DEFAULT_MAX_REMOTE_IMAGES + 1 }, (_, index) => ({
      url: `https://example.com/${index}.jpg`,
    }));
    const listing = { ...baseListing, remoteImages: images };
    expect(() => validateNormalizedListing(listing)).not.toThrow();
    expect(listing.remoteImages).toHaveLength(DEFAULT_MAX_REMOTE_IMAGES);
    expect(listing.remoteImages[0]?.url).toBe('https://example.com/0.jpg');
    expect(listing.remoteImages[DEFAULT_MAX_REMOTE_IMAGES - 1]?.url).toBe(
      `https://example.com/${DEFAULT_MAX_REMOTE_IMAGES - 1}.jpg`,
    );
  });
});
