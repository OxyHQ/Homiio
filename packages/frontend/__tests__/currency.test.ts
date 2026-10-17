/**
 * Pure-logic unit tests for the currency CATALOGUE and the exchange-rate line
 * behind the settings picker. Conversion and money formatting themselves are
 * `@oxy.so/utils/currency`'s, covered there; `__tests__/format/money.test.ts`
 * pins Homiio's precision on top of them.
 */
import { CURRENCIES, getCurrencyByCode, getExchangeRateDisplay } from '@/utils/currency';
import { FALLBACK_RATES } from '@/utils/exchangeRates';

describe('currency utils', () => {
  describe('FALLBACK_RATES', () => {
    it('is USD-based', () => {
      expect(FALLBACK_RATES.USD).toBe(1.0);
      expect(FALLBACK_RATES.EUR).toBeCloseTo(0.85, 5);
    });
  });

  describe('CURRENCIES', () => {
    it('lists every code once', () => {
      const codes = CURRENCIES.map((currency) => currency.code);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  describe('getCurrencyByCode', () => {
    it('finds a catalogued currency', () => {
      expect(getCurrencyByCode('EUR')).toMatchObject({ code: 'EUR', symbol: '€' });
    });

    it('answers undefined for an unknown code', () => {
      expect(getCurrencyByCode('ZZZ')).toBeUndefined();
    });
  });

  describe('getExchangeRateDisplay', () => {
    it('says 1:1 for the same currency', () => {
      expect(getExchangeRateDisplay('EUR', 'EUR', 'en-US', FALLBACK_RATES)).toBe('1:1');
    });

    it('converts through the USD-based table and formats for the reader', () => {
      // 1 USD = 0.85 EUR in the fallback table.
      expect(getExchangeRateDisplay('USD', 'EUR', 'en-US', FALLBACK_RATES)).toBe('1 USD = €0.85');
    });

    it('shows nothing for a code the table cannot convert', () => {
      expect(getExchangeRateDisplay('ZZZ', 'USD', 'en-US', FALLBACK_RATES)).toBe('');
    });
  });
});
