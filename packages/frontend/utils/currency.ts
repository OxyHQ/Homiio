/**
 * The currency catalogue and the exchange-rate lookups behind the currency
 * PICKER in settings.
 *
 * It no longer formats anything. `formatCurrency`, `formatCurrencyWithCode`,
 * `formatAmountInCurrency` and `getCurrencyDisplayName` lived here and were all
 * locale-blind: they grouped in `en-US` for every reader and always PREFIXED the
 * symbol, so a Spanish reader saw `€1,234.56` where the language everywhere else
 * on the screen writes `1.234,56 €`. Money formatting is now
 * `formatMoney` from `@homiio/shared-types` — see issue #357.
 *
 * The `symbol` field on {@link Currency} survives for the picker's list rows,
 * which name currencies rather than render amounts. Never build a price from it.
 *
 * Exchange rates are served by `@/utils/exchangeRates`: live data from
 * frankfurter.app cached in-memory + AsyncStorage (12h TTL), with a bundled
 * stale-fallback table as last resort. App bootstrap calls
 * `refreshExchangeRates()` (from `@/utils/exchangeRates`) to keep the
 * synchronous lookups below current.
 */
import { formatMoney } from '@homiio/shared-types';
import { convertAmount } from '@oxy.so/utils/currency';

import type { ExchangeRateTable } from '@/utils/exchangeRates';

export interface Currency {
  code: string;
  symbol: string;
  flag?: string;
  /**
   * Only for a code `Intl` cannot name. Every other row is named in the
   * reader's language by `currencyName` from `@oxy.so/utils/currency`.
   */
  name?: string;
}

// Common currencies with their symbols and flags
export const CURRENCIES: Currency[] = [
  { code: 'FAIR', symbol: '⊜', flag: '🌍' },
  { code: 'USD', symbol: '$', flag: '🇺🇸' },
  { code: 'EUR', symbol: '€', flag: '🇪🇺' },
  { code: 'GBP', symbol: '£', flag: '🇬🇧' },
  { code: 'JPY', symbol: '¥', flag: '🇯🇵' },
  { code: 'CAD', symbol: 'C$', flag: '🇨🇦' },
  { code: 'AUD', symbol: 'A$', flag: '🇦🇺' },
  { code: 'CHF', symbol: 'CHF', flag: '🇨🇭' },
  { code: 'CNY', symbol: '¥', flag: '🇨🇳' },
  { code: 'SEK', symbol: 'kr', flag: '🇸🇪' },
  { code: 'NZD', symbol: 'NZ$', flag: '🇳🇿' },
  { code: 'MXN', symbol: '$', flag: '🇲🇽' },
  { code: 'SGD', symbol: 'S$', flag: '🇸🇬' },
  { code: 'HKD', symbol: 'HK$', flag: '🇭🇰' },
  { code: 'NOK', symbol: 'kr', flag: '🇳🇴' },
  { code: 'KRW', symbol: '₩', flag: '🇰🇷' },
  { code: 'TRY', symbol: '₺', flag: '🇹🇷' },
  { code: 'RUB', symbol: '₽', flag: '🇷🇺' },
  { code: 'INR', symbol: '₹', flag: '🇮🇳' },
  { code: 'BRL', symbol: 'R$', flag: '🇧🇷' },
  { code: 'ZAR', symbol: 'R', flag: '🇿🇦' },
  { code: 'PLN', symbol: 'zł', flag: '🇵🇱' },
  { code: 'THB', symbol: '฿', flag: '🇹🇭' },
  { code: 'IDR', symbol: 'Rp', flag: '🇮🇩' },
  { code: 'MYR', symbol: 'RM', flag: '🇲🇾' },
  { code: 'PHP', symbol: '₱', flag: '🇵🇭' },
  { code: 'CZK', symbol: 'Kč', flag: '🇨🇿' },
  { code: 'HUF', symbol: 'Ft', flag: '🇭🇺' },
  { code: 'ILS', symbol: '₪', flag: '🇮🇱' },
  { code: 'CLP', symbol: '$', flag: '🇨🇱' },
  { code: 'COP', symbol: '$', flag: '🇨🇴' },
  { code: 'ARS', symbol: '$', flag: '🇦🇷' },
  { code: 'PEN', symbol: 'S/', flag: '🇵🇪' },
  { code: 'UYU', symbol: '$', flag: '🇺🇾' },
  { code: 'VND', symbol: '₫', flag: '🇻🇳' },
  { code: 'EGP', symbol: '£', flag: '🇪🇬' },
  { code: 'NGN', symbol: '₦', flag: '🇳🇬' },
  { code: 'KES', symbol: 'KSh', flag: '🇰🇪' },
  { code: 'GHS', symbol: '₵', flag: '🇬🇭' },
  { code: 'MAD', symbol: 'د.م.', flag: '🇲🇦' },
  { code: 'TND', symbol: 'د.ت', flag: '🇹🇳' },
  { code: 'AED', symbol: 'د.إ', flag: '🇦🇪' },
  { code: 'SAR', symbol: 'ر.س', flag: '🇸🇦' },
  { code: 'QAR', symbol: 'ر.ق', flag: '🇶🇦' },
  { code: 'KWD', symbol: 'د.ك', flag: '🇰🇼' },
  { code: 'BHD', symbol: '.د.ب', flag: '🇧🇭' },
  { code: 'OMR', symbol: 'ر.ع.', flag: '🇴🇲' },
  { code: 'JOD', symbol: 'د.ا', flag: '🇯🇴' },
  { code: 'LBP', symbol: 'ل.ل', flag: '🇱🇧' },
  { code: 'IRR', symbol: '﷼', flag: '🇮🇷' },
  { code: 'PKR', symbol: '₨', flag: '🇵🇰' },
  { code: 'BDT', symbol: '৳', flag: '🇧🇩' },
  { code: 'LKR', symbol: 'Rs', flag: '🇱🇰' },
  { code: 'NPR', symbol: '₨', flag: '🇳🇵' },
  { code: 'MMK', symbol: 'K', flag: '🇲🇲' },
  { code: 'KHR', symbol: '៛', flag: '🇰🇭' },
  { code: 'LAK', symbol: '₭', flag: '🇱🇦' },
  { code: 'MNT', symbol: '₮', flag: '🇲🇳' },
  { code: 'KZT', symbol: '₸', flag: '🇰🇿' },
  { code: 'UZS', symbol: "so'm", flag: '🇺🇿' },
  { code: 'TJS', symbol: 'ЅМ', flag: '🇹🇯' },
  { code: 'TMT', symbol: 'T', flag: '🇹🇲' },
  { code: 'GEL', symbol: '₾', flag: '🇬🇪' },
  { code: 'AMD', symbol: '֏', flag: '🇦🇲' },
  { code: 'AZN', symbol: '₼', flag: '🇦🇿' },
  { code: 'BYN', symbol: 'Br', flag: '🇧🇾' },
  { code: 'MDL', symbol: 'L', flag: '🇲🇩' },
  { code: 'UAH', symbol: '₴', flag: '🇺🇦' },
  { code: 'RSD', symbol: 'дин.', flag: '🇷🇸' },
  { code: 'BGN', symbol: 'лв', flag: '🇧🇬' },
  { code: 'HRK', symbol: 'kn', flag: '🇭🇷' },
  { code: 'RON', symbol: 'lei', flag: '🇷🇴' },
  { code: 'ALL', symbol: 'L', flag: '🇦🇱' },
  { code: 'MKD', symbol: 'ден', flag: '🇲🇰' },
  { code: 'BAM', symbol: 'KM', flag: '🇧🇦' },
  { code: 'MNE', symbol: '€', flag: '🇲🇪' },
  { code: 'XCD', symbol: 'EC$', flag: '🇦🇬' },
  { code: 'BBD', symbol: 'Bds$', flag: '🇧🇧' },
  { code: 'BZD', symbol: 'BZ$', flag: '🇧🇿' },
  { code: 'BMD', symbol: 'BD$', flag: '🇧🇲' },
  { code: 'KYD', symbol: 'CI$', flag: '🇰🇾' },
  { code: 'JMD', symbol: 'J$', flag: '🇯🇲' },
  { code: 'TTD', symbol: 'TT$', flag: '🇹🇹' },
  { code: 'GYD', symbol: 'G$', flag: '🇬🇾' },
  { code: 'SRD', symbol: 'SR$', flag: '🇸🇷' },
  { code: 'FJD', symbol: 'FJ$', flag: '🇫🇯' },
  { code: 'WST', symbol: 'T', flag: '🇼🇸' },
  { code: 'TOP', symbol: 'T$', flag: '🇹🇴' },
  { code: 'VUV', symbol: 'VT', flag: '🇻🇺' },
  { code: 'SBD', symbol: 'SI$', flag: '🇸🇧' },
  { code: 'PGK', symbol: 'K', flag: '🇵🇬' },
  { code: 'KID', symbol: '$', flag: '🇰🇮' },
  { code: 'TVD', symbol: '$', flag: '🇹🇻' },
  { code: 'NAD', symbol: 'N$', flag: '🇳🇦' },
  { code: 'BWP', symbol: 'P', flag: '🇧🇼' },
  { code: 'LSL', symbol: 'L', flag: '🇱🇸' },
  { code: 'SZL', symbol: 'L', flag: '🇸🇿' },
  { code: 'MUR', symbol: '₨', flag: '🇲🇺' },
  { code: 'SCR', symbol: '₨', flag: '🇸🇨' },
  { code: 'DJF', symbol: 'Fdj', flag: '🇩🇯' },
  { code: 'ETB', symbol: 'Br', flag: '🇪🇹' },
  { code: 'SOS', symbol: 'Sh.So.', flag: '🇸🇴' },
  { code: 'TZS', symbol: 'TSh', flag: '🇹🇿' },
  { code: 'UGX', symbol: 'USh', flag: '🇺🇬' },
  { code: 'RWF', symbol: 'FRw', flag: '🇷🇼' },
  { code: 'BIF', symbol: 'FBu', flag: '🇧🇮' },
  { code: 'CDF', symbol: 'FC', flag: '🇨🇩' },
  { code: 'XAF', symbol: 'FCFA', flag: '🇨🇲' },
  { code: 'XOF', symbol: 'CFA', flag: '🇧🇯' },
  { code: 'XPF', symbol: '₣', flag: '🇵🇫' },
  { code: 'KMF', symbol: 'CF', flag: '🇰🇲' },
  { code: 'MGA', symbol: 'Ar', flag: '🇲🇬' },
  { code: 'MZN', symbol: 'MT', flag: '🇲🇿' },
  { code: 'MWK', symbol: 'MK', flag: '🇲🇼' },
  { code: 'ZMW', symbol: 'ZK', flag: '🇿🇲' },
  { code: 'ZWL', symbol: '$', flag: '🇿🇼' },
  { code: 'STN', symbol: 'Db', flag: '🇸🇹' },
  { code: 'CVE', symbol: '$', flag: '🇨🇻' },
  { code: 'GMD', symbol: 'D', flag: '🇬🇲' },
  { code: 'GNF', symbol: 'FG', flag: '🇬🇳' },
  { code: 'SLL', symbol: 'Le', flag: '🇸🇱' },
  { code: 'LRD', symbol: 'L$', flag: '🇱🇷' },
  { code: 'GIP', symbol: '£', flag: '🇬🇮' },
  { code: 'FKP', symbol: '£', flag: '🇫🇰' },
  { code: 'SHP', symbol: '£', flag: '🇸🇭' },
  { code: 'IMP', symbol: '£', flag: '🇮🇲' },
  { code: 'JEP', symbol: '£', flag: '🇯🇪' },
  { code: 'GGP', symbol: '£', flag: '🇬🇬' },
  { code: 'AOA', symbol: 'Kz', flag: '🇦🇴' },
  { code: 'ERN', symbol: 'Nfk', flag: '🇪🇷' },
  { code: 'SSP', symbol: '£', flag: '🇸🇸' },
  { code: 'SDG', symbol: 'ج.س.', flag: '🇸🇩' },
  { code: 'LYD', symbol: 'ل.د', flag: '🇱🇾' },
  { code: 'DZD', symbol: 'د.ج', flag: '🇩🇿' },
  { code: 'MRO', symbol: 'UM', flag: '🇲🇷' },
  { code: 'SYP', symbol: '£', flag: '🇸🇾' },
  { code: 'IQD', symbol: 'ع.د', flag: '🇮🇶' },
  { code: 'AFN', symbol: '؋', flag: '🇦🇫' },
  { code: 'BTN', symbol: 'Nu.', flag: '🇧🇹' },
  { code: 'BND', symbol: 'B$', flag: '🇧🇳' },
  { code: 'PAL', name: 'Palestinian Pound', symbol: '£', flag: '🇵🇸' },
];

/**
 * Get currency by code
 */
export function getCurrencyByCode(code: string): Currency | undefined {
  return CURRENCIES.find((currency) => currency.code === code);
}

/**
 * "1 EUR = 1,08 US$" for the currency picker in settings.
 *
 * The ONLY place an exchange rate reaches the UI, and it says so out loud: the
 * screen is about rates. Listing prices are never converted — see
 * `components/MoneyText.tsx` for why that changed.
 */
export function getExchangeRateDisplay(
  fromCurrency: string,
  toCurrency: string,
  locale: string,
  rates: ExchangeRateTable,
): string {
  if (fromCurrency === toCurrency) {
    return '1:1';
  }

  const rate = convertAmount(1, fromCurrency, toCurrency, { base: 'USD', rates });
  if (rate === null) return '';
  return `1 ${fromCurrency} = ${formatMoney(rate, toCurrency, locale, { maximumFractionDigits: 4 })}`;
}
