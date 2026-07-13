/**
 * Property currency enum coverage.
 *
 * Regression guard for the prod ingest failures where real listings from
 * expansion markets were fetched but REJECTED at save because the Property
 * currency enum was too narrow:
 *   - `sale.currency: PLN is not a valid enum value`      (otodom, Poland)
 *   - `longTermRent.currency: MXN is not a valid enum value` (mercadolibre_mx)
 *
 * The listing-currency set now lives in `@homiio/shared-types`
 * (`LISTING_CURRENCIES`) and must cover every ingested market, while still
 * rejecting nonsense codes. `validateSync()` runs the schema validators without
 * touching the DB, so we assert only on the relevant currency path.
 */

import { LISTING_CURRENCIES } from '@homiio/shared-types';
// The active Property model is registered by models/schemas/PropertySchema.ts
// and re-exported from models/index.ts.
const { Property } = require('../../models');

/** Validation error (if any) at a nested currency path, else undefined. */
function currencyError(
  block: 'longTermRent' | 'shortTermRent' | 'sale',
  currency: string,
): { message: string } | undefined {
  const priced =
    block === 'longTermRent'
      ? { longTermRent: { monthlyAmount: 1200, currency } }
      : block === 'shortTermRent'
        ? { shortTermRent: { nightlyRate: 90, currency } }
        : { sale: { price: 250000, currency } };
  const offering = block === 'sale' ? 'sale' : block === 'shortTermRent' ? 'short_term_rent' : 'long_term_rent';
  const doc = new Property({ type: 'apartment', offerings: [offering], ...priced });
  const error = doc.validateSync();
  return error?.errors?.[`${block}.currency`];
}

describe('Property currency enum', () => {
  it('accepts every centralized listing currency on every priced block', () => {
    for (const currency of LISTING_CURRENCIES) {
      expect(currencyError('longTermRent', currency)).toBeUndefined();
      expect(currencyError('shortTermRent', currency)).toBeUndefined();
      expect(currencyError('sale', currency)).toBeUndefined();
    }
  });

  it('accepts expansion-market currencies that previously failed ingest', () => {
    // otodom (PL) sale, mercadolibre_mx (MX) rent, zonaprop (AR) rent.
    expect(currencyError('sale', 'PLN')).toBeUndefined();
    expect(currencyError('longTermRent', 'MXN')).toBeUndefined();
    expect(currencyError('longTermRent', 'ARS')).toBeUndefined();
  });

  it('still rejects a non-ISO / unsupported currency code', () => {
    const saleErr = currencyError('sale', 'ZZZ');
    expect(saleErr).toBeDefined();
    expect(saleErr?.message).toContain('ZZZ');

    expect(currencyError('longTermRent', 'XYZ')).toBeDefined();
    expect(currencyError('shortTermRent', 'FOO')).toBeDefined();
  });
});
