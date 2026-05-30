/**
 * Pure-logic unit tests for the currency utilities. These exercise the real
 * conversion/formatting/parsing math with no React Native or native-module
 * dependencies, so they run fast and deterministically under jest-expo.
 */
import {
  convertCurrency,
  formatCurrency,
  formatCurrencyWithCode,
  getExchangeRate,
  getCurrencyByCode,
  getDefaultCurrency,
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

  describe('formatCurrency', () => {
    it('prefixes the amount with the currency symbol', () => {
      expect(formatCurrency(1200, 'EUR')).toBe('€1,200');
    });

    it('defaults to USD when no code is provided', () => {
      expect(formatCurrency(1000)).toBe('$1,000');
    });

    it('falls back to the default currency for an unknown code', () => {
      expect(formatCurrency(50, 'ZZZ')).toBe(`${getDefaultCurrency().symbol}50`);
    });

    it('keeps up to two fractional digits', () => {
      expect(formatCurrency(1234.5, 'USD')).toBe('$1,234.5');
    });
  });

  describe('formatCurrencyWithCode', () => {
    it('suffixes the amount with the ISO code', () => {
      expect(formatCurrencyWithCode(1500, 'GBP')).toBe('1,500 GBP');
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
