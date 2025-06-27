/**
 * Currency utilities for Homiio
 * Provides currency formatting, conversion, and management functions
 */

export interface Currency {
    code: string;
    name: string;
    symbol: string;
    flag?: string;
}

// Exchange rates (base: USD) - these would typically come from an API
// For now, using approximate rates that should be updated regularly
const EXCHANGE_RATES: { [key: string]: number } = {
    // Base currency
    USD: 1.0,
    
    // Major currencies
    EUR: 0.85,
    GBP: 0.73,
    JPY: 110.0,
    CAD: 1.25,
    AUD: 1.35,
    CHF: 0.92,
    CNY: 6.45,
    SEK: 8.65,
    NZD: 1.40,
    MXN: 20.0,
    SGD: 1.35,
    HKD: 7.78,
    NOK: 8.50,
    KRW: 1150.0,
    TRY: 8.50,
    RUB: 75.0,
    INR: 74.0,
    BRL: 5.25,
    ZAR: 14.5,
    PLN: 3.85,
    THB: 32.0,
    IDR: 14250.0,
    MYR: 4.15,
    PHP: 50.0,
    CZK: 21.5,
    HUF: 300.0,
    ILS: 3.25,
    CLP: 750.0,
    COP: 3750.0,
    ARS: 95.0,
    PEN: 3.95,
    UYU: 42.0,
    VND: 23000.0,
    EGP: 15.7,
    NGN: 410.0,
    KES: 108.0,
    GHS: 5.85,
    MAD: 9.0,
    TND: 2.75,
    AED: 3.67,
    SAR: 3.75,
    QAR: 3.64,
    KWD: 0.30,
    BHD: 0.38,
    OMR: 0.38,
    JOD: 0.71,
    LBP: 1500.0,
    IRR: 42000.0,
    PKR: 155.0,
    BDT: 85.0,
    LKR: 200.0,
    NPR: 118.0,
    MMK: 1650.0,
    KHR: 4050.0,
    LAK: 9500.0,
    MNT: 2850.0,
    KZT: 425.0,
    UZS: 10500.0,
    TJS: 11.0,
    TMT: 3.5,
    GEL: 3.1,
    AMD: 520.0,
    AZN: 1.7,
    BYN: 2.5,
    MDL: 17.5,
    UAH: 27.0,
    RSD: 100.0,
    BGN: 1.65,
    HRK: 6.5,
    RON: 4.2,
    ALL: 105.0,
    MKD: 52.0,
    BAM: 1.65,
    MNE: 0.85,
    XCD: 2.7,
    BBD: 2.0,
    BZD: 2.0,
    BMD: 1.0,
    KYD: 0.83,
    JMD: 150.0,
    TTD: 6.75,
    GYD: 208.0,
    SRD: 21.0,
    FJD: 2.1,
    WST: 2.6,
    TOP: 2.3,
    VUV: 110.0,
    SBD: 8.0,
    PGK: 3.5,
    KID: 1.0,
    TVD: 1.0,
    NAD: 14.5,
    BWP: 10.8,
    LSL: 14.5,
    SZL: 14.5,
    MUR: 40.0,
    SCR: 20.0,
    DJF: 177.0,
    ETB: 43.0,
    SOS: 580.0,
    TZS: 2300.0,
    UGX: 3500.0,
    RWF: 1000.0,
    BIF: 1950.0,
    CDF: 2000.0,
    XAF: 550.0,
    XOF: 550.0,
    XPF: 110.0,
    KMF: 440.0,
    MGA: 3800.0,
    MZN: 60.0,
    MWK: 800.0,
    ZMW: 17.0,
    ZWL: 1.0,
    STN: 20.0,
    CVE: 100.0,
    GMD: 50.0,
    GNF: 10000.0,
    SLL: 10000.0,
    LRD: 150.0,
    GIP: 0.73,
    FKP: 0.73,
    SHP: 0.73,
    IMP: 0.73,
    JEP: 0.73,
    GGP: 0.73,
    AOA: 650.0,
    ERN: 15.0,
    SSP: 0.73,
    SDG: 450.0,
    LYD: 4.5,
    DZD: 135.0,
    MRO: 35.0,
    SYP: 2500.0,
    IQD: 1460.0,
    AFN: 80.0,
    BTN: 74.0,
    BND: 1.35,
    PAL: 0.73,
    
    // FAIRCoin - using a fixed rate for now
    FAIR: 1.0, // 1 FAIR = 1 USD equivalent
};

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
    { code: 'UZS', name: 'Uzbekistani Som', symbol: 'so\'m', flag: '🇺🇿' },
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
    return CURRENCIES.find(currency => currency.code === code);
}

/**
 * Get default currency (USD)
 */
export function getDefaultCurrency(): Currency {
    return CURRENCIES.find(currency => currency.code === 'USD') || CURRENCIES[0];
}

/**
 * Get exchange rate for a currency (relative to USD)
 */
export function getExchangeRate(currencyCode: string): number {
    return EXCHANGE_RATES[currencyCode] || 1.0;
}

/**
 * Convert amount from one currency to another
 */
export function convertCurrency(
    amount: number, 
    fromCurrency: string, 
    toCurrency: string
): number {
    if (fromCurrency === toCurrency) {
        return amount;
    }

    // Convert to USD first (base currency)
    const fromRate = getExchangeRate(fromCurrency);
    const toRate = getExchangeRate(toCurrency);
    
    // Convert: amount / fromRate * toRate
    return (amount / fromRate) * toRate;
}

/**
 * Format amount with currency symbol
 */
export function formatCurrency(amount: number, currencyCode: string = 'USD'): string {
    const currency = getCurrencyByCode(currencyCode) || getDefaultCurrency();
    
    // Format the number with appropriate decimal places
    const formattedAmount = amount.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
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
    targetCurrency: string
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
    return CURRENCIES.some(currency => currency.code === code);
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
    return CURRENCIES.filter(currency => 
        currency.name.toLowerCase().includes(lowerQuery) ||
        currency.code.toLowerCase().includes(lowerQuery)
    );
} 