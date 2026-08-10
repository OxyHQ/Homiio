/**
 * Pure-logic unit tests for the currency CATALOGUE and the exchange-rate maths
 * behind the settings picker. No React Native or native-module dependencies, so
 * they run fast and deterministically under jest-expo.
 *
 * The `formatCurrency` / `formatCurrencyWithCode` blocks that used to sit here
 * are gone with the functions: they asserted `€1,200` for `es-ES` readers too,
 * which is precisely the bug issue #357 fixed. Money formatting is covered by
 * `__tests__/format/money.test.ts` against `formatMoney`.
 */
import {
  convertCurrency,
  getExchangeRate,
  getCurrencyByCode,
  isValidCurrencyCode,
  parseCurrencyAmount,
  searchCurrencies,
} from '@/utils/currency';

describe('currency utils', () => {
  describe('getExchangeRate', () => {
    it('returns 1.0 for the USD base currency', () => {
      expect(getExchangeRate('USD')).toBe(1.0);
    });

    it('returns the configured rate for a known currency', () => {
      expect(getExchangeRate('EUR')).toBeCloseTo(0.85, 5);
    });

    it('falls back to 1.0 for an unknown currency code', () => {
      expect(getExchangeRate('ZZZ')).toBe(1.0);
    });
  });

  describe('convertCurrency', () => {
    it('returns the amount unchanged when source and target match', () => {
      expect(convertCurrency(123.45, 'EUR', 'EUR')).toBe(123.45);
    });

    it('converts via the USD base using both rates', () => {
      // 100 USD -> EUR at 0.85 = 85
      expect(convertCurrency(100, 'USD', 'EUR')).toBeCloseTo(85, 5);
      // round-trip back to USD should be lossless for these rates
      const eur = convertCurrency(100, 'USD', 'EUR');
      expect(convertCurrency(eur, 'EUR', 'USD')).toBeCloseTo(100, 5);
    });

    it('converts between two non-USD currencies', () => {
      // 85 EUR -> GBP: 85 / 0.85 * 0.73 = 73
      expect(convertCurrency(85, 'EUR', 'GBP')).toBeCloseTo(73, 5);
    });
  });

  describe('parseCurrencyAmount', () => {
    it('strips symbols and thousands separators', () => {
      expect(parseCurrencyAmount('€1,234.56')).toBeCloseTo(1234.56, 5);
    });

    it('returns 0 for non-numeric input', () => {
      expect(parseCurrencyAmount('not a price')).toBe(0);
    });
  });

  describe('isValidCurrencyCode', () => {
    it('accepts a known code and rejects an unknown one', () => {
      expect(isValidCurrencyCode('USD')).toBe(true);
      expect(isValidCurrencyCode('ZZZ')).toBe(false);
    });
  });

  describe('getCurrencyByCode', () => {
    it('returns the matching currency descriptor', () => {
      expect(getCurrencyByCode('EUR')).toMatchObject({ code: 'EUR', symbol: '€' });
    });

    it('returns undefined for an unknown code', () => {
      expect(getCurrencyByCode('ZZZ')).toBeUndefined();
    });
  });

  describe('searchCurrencies', () => {
    it('matches on name case-insensitively', () => {
      const results = searchCurrencies('euro');
      expect(results.some((c) => c.code === 'EUR')).toBe(true);
    });

    it('matches on code', () => {
      const results = searchCurrencies('gbp');
      expect(results.map((c) => c.code)).toContain('GBP');
    });
  });
});
