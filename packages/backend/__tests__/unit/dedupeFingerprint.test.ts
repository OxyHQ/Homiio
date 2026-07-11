/**
 * External-listing dedup fingerprint.
 *
 * The cases mirror the false-positive classes found in the live data:
 *  - real re-lists (near-identical agency copy) MUST match;
 *  - AI-templated flats in the same city but different units (Jaccard ~0.9) must
 *    NOT match — the 0.95 threshold is the safety margin;
 *  - multi-city developments (same brochure, different cityId) must NOT match;
 *  - a portfolio split across property types must NOT match;
 *  - listings missing m²/bedrooms or a substantial description are never candidates.
 */

import { OfferingType, PropertyType } from '@homiio/shared-types';
import {
  MIN_DESCRIPTION_TOKENS,
  areDuplicateListings,
  descriptionJaccard,
  extractPrimaryPricing,
  normalizeDescriptionTokens,
  toDedupComparable,
  type DedupListingInput,
} from '../../services/ingestion/dedupeFingerprint';

/** Build a description from `shared` common words plus per-listing `extra` words. */
function buildDescription(shared: number, extra: string[]): string {
  const words: string[] = [];
  for (let i = 0; i < shared; i += 1) words.push(`comun${String(i).padStart(3, '0')}`);
  return [...words, ...extra].join(' ');
}

const BASE: DedupListingInput = {
  type: PropertyType.APARTMENT,
  cityId: 'city-barcelona',
  bedrooms: 2,
  squareFootage: 63,
  longTermRent: { monthlyAmount: 1750, currency: 'EUR' },
  description: buildDescription(60, ['unoextra', 'dosextra']),
};

function comparableOrThrow(input: DedupListingInput) {
  const comparable = toDedupComparable(input);
  if (!comparable) throw new Error('expected an eligible comparable');
  return comparable;
}

describe('normalizeDescriptionTokens', () => {
  it('lowercases, strips accents, and drops words shorter than 3 chars', () => {
    const tokens = normalizeDescriptionTokens('Ático LUMINOSO en la Sagrada Família, m2');
    expect(tokens.has('atico')).toBe(true);
    expect(tokens.has('luminoso')).toBe(true);
    expect(tokens.has('familia')).toBe(true);
    // "en", "la", "m2" -> length < 3 dropped ("m2" has length 2).
    expect(tokens.has('en')).toBe(false);
    expect(tokens.has('la')).toBe(false);
  });

  it('returns an empty set for empty/nullish input', () => {
    expect(normalizeDescriptionTokens('').size).toBe(0);
    expect(normalizeDescriptionTokens(null).size).toBe(0);
    expect(normalizeDescriptionTokens(undefined).size).toBe(0);
  });
});

describe('descriptionJaccard', () => {
  it('is 1 for identical token sets and 0 when either is empty', () => {
    const a = new Set(['casa', 'luminosa', 'centro']);
    expect(descriptionJaccard(a, new Set(a))).toBe(1);
    expect(descriptionJaccard(a, new Set())).toBe(0);
  });

  it('computes intersection over union', () => {
    const a = new Set(['w1', 'w2', 'w3', 'w4']);
    const b = new Set(['w3', 'w4', 'w5', 'w6']);
    expect(descriptionJaccard(a, b)).toBeCloseTo(2 / 6, 5);
  });
});

describe('extractPrimaryPricing', () => {
  it('prefers long-term rent, then short-term, then sale', () => {
    expect(extractPrimaryPricing({ longTermRent: { monthlyAmount: 900, currency: 'eur' } })).toEqual({
      offering: OfferingType.LONG_TERM_RENT,
      amount: 900,
      currency: 'EUR',
    });
    expect(extractPrimaryPricing({ shortTermRent: { nightlyRate: 120, currency: 'EUR' } })?.offering).toBe(
      OfferingType.SHORT_TERM_RENT,
    );
    expect(extractPrimaryPricing({ sale: { price: 249000, currency: 'EUR' } })?.offering).toBe(
      OfferingType.SALE,
    );
  });

  it('ignores non-positive amounts and returns null when unpriced', () => {
    expect(extractPrimaryPricing({ longTermRent: { monthlyAmount: 0, currency: 'EUR' } })).toBeNull();
    expect(extractPrimaryPricing({})).toBeNull();
  });
});

describe('toDedupComparable eligibility', () => {
  it('accepts a fully-populated listing', () => {
    expect(toDedupComparable(BASE)).not.toBeNull();
  });

  it('rejects zero/negative square footage', () => {
    expect(toDedupComparable({ ...BASE, squareFootage: 0 })).toBeNull();
  });

  it('rejects zero bedrooms', () => {
    expect(toDedupComparable({ ...BASE, bedrooms: 0 })).toBeNull();
  });

  it('rejects a missing city or type', () => {
    expect(toDedupComparable({ ...BASE, cityId: '' })).toBeNull();
    expect(toDedupComparable({ ...BASE, type: undefined })).toBeNull();
  });

  it('rejects an unpriced listing', () => {
    expect(toDedupComparable({ ...BASE, longTermRent: undefined })).toBeNull();
  });

  it('rejects a description below the token floor', () => {
    const thin = buildDescription(MIN_DESCRIPTION_TOKENS - 5, []);
    expect(toDedupComparable({ ...BASE, description: thin })).toBeNull();
  });
});

describe('areDuplicateListings — true positives', () => {
  it('matches a re-list with near-identical agency copy (same unit, new sourceId)', () => {
    // 60 shared + 1 unique word each -> Jaccard 61/62 ≈ 0.984, above the 0.95 floor.
    const a = comparableOrThrow({ ...BASE, description: buildDescription(60, ['loftunicoa']) });
    const b = comparableOrThrow({ ...BASE, description: buildDescription(60, ['loftunicob']) });
    expect(areDuplicateListings(a, b)).toBe(true);
  });

  it('matches a byte-identical re-post', () => {
    const a = comparableOrThrow(BASE);
    const b = comparableOrThrow(BASE);
    expect(areDuplicateListings(a, b)).toBe(true);
  });
});

describe('areDuplicateListings — false positives it must reject', () => {
  it('rejects AI-templated different flats in the same city (Jaccard ~0.9 < 0.95)', () => {
    // 60 shared + 4 unique each -> Jaccard 60/68 ≈ 0.88: templated, but different units.
    const a = comparableOrThrow({
      ...BASE,
      description: buildDescription(60, ['balcona', 'exteriora', 'reformadoa', 'luminosoa']),
    });
    const b = comparableOrThrow({
      ...BASE,
      description: buildDescription(60, ['terrazab', 'interiorb', 'nuevob', 'amuebladob']),
    });
    expect(descriptionJaccard(a.descriptionTokens, b.descriptionTokens)).toBeLessThan(0.95);
    expect(areDuplicateListings(a, b)).toBe(false);
  });

  it('rejects a multi-city development sharing one brochure (different cityId)', () => {
    const a = comparableOrThrow(BASE);
    const b = comparableOrThrow({ ...BASE, cityId: 'city-eghezee' });
    expect(areDuplicateListings(a, b)).toBe(false);
  });

  it('rejects a portfolio split across property types', () => {
    const a = comparableOrThrow(BASE);
    const b = comparableOrThrow({ ...BASE, type: PropertyType.HOUSE });
    expect(areDuplicateListings(a, b)).toBe(false);
  });

  it('rejects listings with the same copy but a different price', () => {
    const a = comparableOrThrow(BASE);
    const b = comparableOrThrow({ ...BASE, longTermRent: { monthlyAmount: 1800, currency: 'EUR' } });
    expect(areDuplicateListings(a, b)).toBe(false);
  });

  it('rejects listings differing in bedrooms or square footage', () => {
    const a = comparableOrThrow(BASE);
    expect(areDuplicateListings(a, comparableOrThrow({ ...BASE, bedrooms: 3 }))).toBe(false);
    expect(areDuplicateListings(a, comparableOrThrow({ ...BASE, squareFootage: 70 }))).toBe(false);
  });

  it('rejects listings with the same attributes but unrelated descriptions', () => {
    const a = comparableOrThrow(BASE);
    const b = comparableOrThrow({
      ...BASE,
      description: buildDescription(0, Array.from({ length: 62 }, (_, i) => `distinto${i}`)),
    });
    expect(areDuplicateListings(a, b)).toBe(false);
  });
});
