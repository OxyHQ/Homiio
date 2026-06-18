/**
 * Currency utilities for Homiio
 * Provides currency formatting, conversion, and management functions.
 *
 * Exchange rates are served by `@/utils/exchangeRates`: live data from
 * frankfurter.app cached in-memory + AsyncStorage (12h TTL), with a bundled
 * stale-fallback table as last resort. App bootstrap calls
 * `refreshExchangeRates()` (from `@/utils/exchangeRates`) to keep the
 * synchronous lookups below current.
 */
import { getRate } from '@/utils/exchangeRates';

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  flag?: string;
}

// Common currencies with their symbols and flags
export const CURRENCIES: Currency[] = [
  { code: 'FAIR', name: 'FAIRCoin', symbol: '⊜', flag: '🌍' },
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', flag: '🇨🇦' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', flag: '🇨🇭' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', flag: '🇨🇳' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', flag: '🇸🇪' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', flag: '🇳🇿' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', flag: '🇲🇽' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', flag: '🇸🇬' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', flag: '🇭🇰' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', flag: '🇳🇴' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', flag: '🇰🇷' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', flag: '🇹🇷' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', flag: '🇷🇺' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', flag: '🇧🇷' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', flag: '🇿🇦' },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł', flag: '🇵🇱' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', flag: '🇹🇭' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', flag: '🇮🇩' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', flag: '🇲🇾' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', flag: '🇵🇭' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', flag: '🇨🇿' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', flag: '🇭🇺' },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪', flag: '🇮🇱' },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', flag: '🇨🇱' },
  { code: 'COP', name: 'Colombian Peso', symbol: '$', flag: '🇨🇴' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', flag: '🇦🇷' },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', flag: '🇵🇪' },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$', flag: '🇺🇾' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', flag: '🇻🇳' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: '£', flag: '🇪🇬' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', flag: '🇳🇬' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', flag: '🇬🇭' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.', flag: '🇲🇦' },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'د.ت', flag: '🇹🇳' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', flag: '🇦🇪' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س', flag: '🇸🇦' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق', flag: '🇶🇦' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', flag: '🇰🇼' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب', flag: '🇧🇭' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.', flag: '🇴🇲' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا', flag: '🇯🇴' },
  { code: 'LBP', name: 'Lebanese Pound', symbol: 'ل.ل', flag: '🇱🇧' },
  { code: 'IRR', name: 'Iranian Rial', symbol: '﷼', flag: '🇮🇷' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', flag: '🇵🇰' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', flag: '🇧🇩' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', flag: '🇱🇰' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: '₨', flag: '🇳🇵' },
  { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K', flag: '🇲🇲' },
  { code: 'KHR', name: 'Cambodian Riel', symbol: '៛', flag: '🇰🇭' },
  { code: 'LAK', name: 'Lao Kip', symbol: '₭', flag: '🇱🇦' },
  { code: 'MNT', name: 'Mongolian Tugrik', symbol: '₮', flag: '🇲🇳' },
  { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸', flag: '🇰🇿' },
  { code: 'UZS', name: 'Uzbekistani Som', symbol: "so'm", flag: '🇺🇿' },
  { code: 'TJS', name: 'Tajikistani Somoni', symbol: 'ЅМ', flag: '🇹🇯' },
  { code: 'TMT', name: 'Turkmenistani Manat', symbol: 'T', flag: '🇹🇲' },
  { code: 'GEL', name: 'Georgian Lari', symbol: '₾', flag: '🇬🇪' },
  { code: 'AMD', name: 'Armenian Dram', symbol: '֏', flag: '🇦🇲' },
  { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼', flag: '🇦🇿' },
  { code: 'BYN', name: 'Belarusian Ruble', symbol: 'Br', flag: '🇧🇾' },
  { code: 'MDL', name: 'Moldovan Leu', symbol: 'L', flag: '🇲🇩' },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', flag: '🇺🇦' },
  { code: 'RSD', name: 'Serbian Dinar', symbol: 'дин.', flag: '🇷🇸' },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв', flag: '🇧🇬' },
  { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn', flag: '🇭🇷' },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', flag: '🇷🇴' },
  { code: 'ALL', name: 'Albanian Lek', symbol: 'L', flag: '🇦🇱' },
  { code: 'MKD', name: 'Macedonian Denar', symbol: 'ден', flag: '🇲🇰' },
  { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark', symbol: 'KM', flag: '🇧🇦' },
  { code: 'MNE', name: 'Montenegrin Euro', symbol: '€', flag: '🇲🇪' },
  { code: 'XCD', name: 'East Caribbean Dollar', symbol: 'EC$', flag: '🇦🇬' },
  { code: 'BBD', name: 'Barbadian Dollar', symbol: 'Bds$', flag: '🇧🇧' },
  { code: 'BZD', name: 'Belize Dollar', symbol: 'BZ$', flag: '🇧🇿' },
  { code: 'BMD', name: 'Bermudian Dollar', symbol: 'BD$', flag: '🇧🇲' },
  { code: 'KYD', name: 'Cayman Islands Dollar', symbol: 'CI$', flag: '🇰🇾' },
  { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$', flag: '🇯🇲' },
  { code: 'TTD', name: 'Trinidad and Tobago Dollar', symbol: 'TT$', flag: '🇹🇹' },
  { code: 'GYD', name: 'Guyanese Dollar', symbol: 'G$', flag: '🇬🇾' },
  { code: 'SRD', name: 'Surinamese Dollar', symbol: 'SR$', flag: '🇸🇷' },
  { code: 'FJD', name: 'Fijian Dollar', symbol: 'FJ$', flag: '🇫🇯' },
  { code: 'WST', name: 'Samoan Tala', symbol: 'T', flag: '🇼🇸' },
  { code: 'TOP', name: 'Tongan Paʻanga', symbol: 'T$', flag: '🇹🇴' },
  { code: 'VUV', name: 'Vanuatu Vatu', symbol: 'VT', flag: '🇻🇺' },
  { code: 'SBD', name: 'Solomon Islands Dollar', symbol: 'SI$', flag: '🇸🇧' },
  { code: 'PGK', name: 'Papua New Guinean Kina', symbol: 'K', flag: '🇵🇬' },
  { code: 'KID', name: 'Kiribati Dollar', symbol: '$', flag: '🇰🇮' },
  { code: 'TVD', name: 'Tuvaluan Dollar', symbol: '$', flag: '🇹🇻' },
  { code: 'NAD', name: 'Namibian Dollar', symbol: 'N$', flag: '🇳🇦' },
  { code: 'BWP', name: 'Botswana Pula', symbol: 'P', flag: '🇧🇼' },
  { code: 'LSL', name: 'Lesotho Loti', symbol: 'L', flag: '🇱🇸' },
  { code: 'SZL', name: 'Eswatini Lilangeni', symbol: 'L', flag: '🇸🇿' },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨', flag: '🇲🇺' },
  { code: 'SCR', name: 'Seychellois Rupee', symbol: '₨', flag: '🇸🇨' },
  { code: 'DJF', name: 'Djiboutian Franc', symbol: 'Fdj', flag: '🇩🇯' },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', flag: '🇪🇹' },
  { code: 'SOS', name: 'Somali Shilling', symbol: 'Sh.So.', flag: '🇸🇴' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', flag: '🇹🇿' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', flag: '🇺🇬' },
  { code: 'FAIR', name: 'FAIRCoin', symbol: '⊜', flag: '🌍' },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', flag: '🇷🇼' },
  { code: 'BIF', name: 'Burundian Franc', symbol: 'FBu', flag: '🇧🇮' },
  { code: 'CDF', name: 'Congolese Franc', symbol: 'FC', flag: '🇨🇩' },
  { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', flag: '🇨🇲' },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA', flag: '🇧🇯' },
  { code: 'XPF', name: 'CFP Franc', symbol: '₣', flag: '🇵🇫' },
  { code: 'KMF', name: 'Comorian Franc', symbol: 'CF', flag: '🇰🇲' },
  { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar', flag: '🇲🇬' },
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', flag: '🇲🇿' },
  { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK', flag: '🇲🇼' },
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK', flag: '🇿🇲' },
  { code: 'ZWL', name: 'Zimbabwean Dollar', symbol: '$', flag: '🇿🇼' },
  { code: 'STN', name: 'São Tomé and Príncipe Dobra', symbol: 'Db', flag: '🇸🇹' },
  { code: 'CVE', name: 'Cape Verdean Escudo', symbol: '$', flag: '🇨🇻' },
  { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D', flag: '🇬🇲' },
  { code: 'GNF', name: 'Guinean Franc', symbol: 'FG', flag: '🇬🇳' },
  { code: 'SLL', name: 'Sierra Leonean Leone', symbol: 'Le', flag: '🇸🇱' },
  { code: 'LRD', name: 'Liberian Dollar', symbol: 'L$', flag: '🇱🇷' },
  { code: 'GIP', name: 'Gibraltar Pound', symbol: '£', flag: '🇬🇮' },
  { code: 'FKP', name: 'Falkland Islands Pound', symbol: '£', flag: '🇫🇰' },
  { code: 'SHP', name: 'Saint Helena Pound', symbol: '£', flag: '🇸🇭' },
  { code: 'IMP', name: 'Manx Pound', symbol: '£', flag: '🇮🇲' },
  { code: 'JEP', name: 'Jersey Pound', symbol: '£', flag: '🇯🇪' },
  { code: 'GGP', name: 'Guernsey Pound', symbol: '£', flag: '🇬🇬' },
  { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz', flag: '🇦🇴' },
  { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk', flag: '🇪🇷' },
  { code: 'SSP', name: 'South Sudanese Pound', symbol: '£', flag: '🇸🇸' },
  { code: 'SDG', name: 'Sudanese Pound', symbol: 'ج.س.', flag: '🇸🇩' },
  { code: 'LYD', name: 'Libyan Dinar', symbol: 'ل.د', flag: '🇱🇾' },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'د.ج', flag: '🇩🇿' },
  { code: 'MRO', name: 'Mauritanian Ouguiya', symbol: 'UM', flag: '🇲🇷' },
  { code: 'SYP', name: 'Syrian Pound', symbol: '£', flag: '🇸🇾' },
  { code: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د', flag: '🇮🇶' },
  { code: 'AFN', name: 'Afghan Afghani', symbol: '؋', flag: '🇦🇫' },
  { code: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'Nu.', flag: '🇧🇹' },
  { code: 'BND', name: 'Brunei Dollar', symbol: 'B$', flag: '🇧🇳' },
  { code: 'PAL', name: 'Palestinian Pound', symbol: '£', flag: '🇵🇸' },
];

/**
 * Get currency by code
 */
export function getCurrencyByCode(code: string): Currency | undefined {
  return CURRENCIES.find((currency) => currency.code === code);
}

/**
 * Get default currency (USD)
 */
export function getDefaultCurrency(): Currency {
  return CURRENCIES.find((currency) => currency.code === 'USD') || CURRENCIES[0];
}

/**
 * Get exchange rate for a currency (relative to USD).
 * Reads the in-memory cache maintained by `@/utils/exchangeRates`.
 */
export function getExchangeRate(currencyCode: string): number {
  return getRate(currencyCode);
}

/**
 * Convert amount from one currency to another
 */
export function convertCurrency(amount: number, fromCurrency: string, toCurrency: string): number {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  // Convert to USD first (base currency)
  const fromRate = getExchangeRate(fromCurrency);
  const toRate = getExchangeRate(toCurrency);

  // Convert: amount / fromRate * toRate
  return (amount / fromRate) * toRate;
}

/** Fraction-digit overrides for {@link formatCurrency}. */
export interface FormatCurrencyOptions {
  /** Minimum fraction digits (defaults to 0 — whole amounts show no decimals). */
  minimumFractionDigits?: number;
  /** Maximum fraction digits (defaults to 2). */
  maximumFractionDigits?: number;
}

/**
 * Format amount with currency symbol.
 *
 * Defaults to `0–2` fraction digits (whole amounts render without decimals).
 * Pass `options` to force a fixed precision — e.g. a price breakdown that
 * always shows cents passes `{ minimumFractionDigits: 2, maximumFractionDigits: 2 }`.
 */
export function formatCurrency(
  amount: number,
  currencyCode: string = 'USD',
  options: FormatCurrencyOptions = {},
): string {
  const currency = getCurrencyByCode(currencyCode) || getDefaultCurrency();
  const safeAmount = Number.isFinite(amount) ? amount : 0;

  const formattedAmount = safeAmount.toLocaleString('en-US', {
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  });

  return `${currency.symbol}${formattedAmount}`;
}

/**
 * Format amount with currency code
 */
export function formatCurrencyWithCode(amount: number, currencyCode: string = 'USD'): string {
  const currency = getCurrencyByCode(currencyCode) || getDefaultCurrency();

  const formattedAmount = amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return `${formattedAmount} ${currency.code}`;
}

/**
 * Get currency display name with flag
 */
export function getCurrencyDisplayName(currencyCode: string): string {
  const currency = getCurrencyByCode(currencyCode) || getDefaultCurrency();
  return `${currency.flag} ${currency.name} (${currency.code})`;
}

/**
 * Format amount in current currency with conversion
 */
export function formatAmountInCurrency(
  amount: number,
  originalCurrency: string,
  targetCurrency: string,
): string {
  const convertedAmount = convertCurrency(amount, originalCurrency, targetCurrency);
  return formatCurrency(convertedAmount, targetCurrency);
}

/**
 * Get exchange rate display string
 */
export function getExchangeRateDisplay(fromCurrency: string, toCurrency: string): string {
  if (fromCurrency === toCurrency) {
    return '1:1';
  }

  const rate = convertCurrency(1, fromCurrency, toCurrency);
  return `1 ${fromCurrency} = ${formatCurrency(rate, toCurrency)}`;
}

/**
 * Parse currency amount from string
 */
export function parseCurrencyAmount(amountString: string): number {
  // Remove currency symbols and commas, then parse
  const cleaned = amountString.replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Validate currency code
 */
export function isValidCurrencyCode(code: string): boolean {
  return CURRENCIES.some((currency) => currency.code === code);
}

/**
 * Get popular currencies (first 20)
 */
export function getPopularCurrencies(): Currency[] {
  return CURRENCIES.slice(0, 20);
}

/**
 * Search currencies by name or code
 */
export function searchCurrencies(query: string): Currency[] {
  const lowerQuery = query.toLowerCase();
  return CURRENCIES.filter(
    (currency) =>
      currency.name.toLowerCase().includes(lowerQuery) ||
      currency.code.toLowerCase().includes(lowerQuery),
  );
}
