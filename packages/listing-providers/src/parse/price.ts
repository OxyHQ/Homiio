/**
 * Shared monthly-rent / sale price sanity checks for external listing ingest.
 *
 * Prefer skipping a listing over guessing (e.g. annual÷12 or nightly×30). Providers
 * call these from `normalize()`; {@link validateNormalizedListing} applies them at
 * ingest time as a second gate.
 */

import { OfferingType } from '@homiio/shared-types';

export interface MonthlyRentPriceContext {
  bedrooms?: number;
  /** When true, monthly caps are not applied (sale listings use {@link validateSalePrice}). */
  isSale?: boolean;
}

const MIN_MONTHLY_RENT: Readonly<Record<string, number>> = {
  EUR: 150,
  USD: 200,
  GBP: 150,
};

const DEFAULT_MIN_MONTHLY_RENT = 100;

/** Per-bedroom monthly rent caps (long-term furnished rentals). */
const MAX_MONTHLY_RENT_BY_BEDROOMS: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  EUR: { 0: 10_000, 1: 10_000, 2: 18_000, 3: 30_000 },
  USD: { 0: 12_000, 1: 12_000, 2: 22_000, 3: 40_000 },
  GBP: { 0: 8_500, 1: 8_500, 2: 15_000, 3: 28_000 },
};

const ABSOLUTE_MAX_MONTHLY_RENT: Readonly<Record<string, number>> = {
  EUR: 80_000,
  USD: 100_000,
  GBP: 70_000,
};

const DEFAULT_ABSOLUTE_MAX_MONTHLY_RENT = 150_000;

const MIN_NIGHTLY_RATE = 10;
const MAX_NIGHTLY_RATE = 2_500;

const MIN_SALE_PRICE = 1_000;
const MAX_SALE_PRICE = 500_000_000;

function normalizeCurrency(currency: string | undefined): string | undefined {
  const trimmed = currency?.trim().toUpperCase();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function bedroomCap(currency: string, bedrooms: number | undefined): number | undefined {
  const table = MAX_MONTHLY_RENT_BY_BEDROOMS[currency];
  if (!table) return undefined;
  const beds = bedrooms ?? 1;
  if (beds >= 3) return table[3];
  return table[beds] ?? table[1];
}

/**
 * Validate a long-term monthly rent amount. Returns an error message, or null when sane.
 */
export function validateMonthlyRentAmount(
  amount: unknown,
  currency: unknown,
  context: MonthlyRentPriceContext = {},
): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return 'monthly rent must be a positive number';
  }

  const normalizedCurrency = normalizeCurrency(typeof currency === 'string' ? currency : undefined);
  if (!normalizedCurrency) {
    return 'monthly rent currency is required';
  }

  const minRent = MIN_MONTHLY_RENT[normalizedCurrency] ?? DEFAULT_MIN_MONTHLY_RENT;
  if (amount < minRent) {
    return `monthly rent ${amount} ${normalizedCurrency} is below minimum ${minRent} (likely nightly or invalid)`;
  }

  if (context.isSale) {
    return null;
  }

  const cap = bedroomCap(normalizedCurrency, context.bedrooms)
    ?? ABSOLUTE_MAX_MONTHLY_RENT[normalizedCurrency]
    ?? DEFAULT_ABSOLUTE_MAX_MONTHLY_RENT;

  if (amount > cap) {
    const beds = context.bedrooms ?? 1;
    return `monthly rent ${amount} ${normalizedCurrency} exceeds ${cap} cap for ${beds} bedroom(s)`;
  }

  return null;
}

/** Validate a short-term nightly rate. Returns an error message, or null when sane. */
export function validateNightlyRateAmount(amount: unknown, currency: unknown): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return 'nightly rate must be a positive number';
  }
  if (!normalizeCurrency(typeof currency === 'string' ? currency : undefined)) {
    return 'nightly rate currency is required';
  }
  if (amount < MIN_NIGHTLY_RATE) {
    return `nightly rate ${amount} is below minimum ${MIN_NIGHTLY_RATE}`;
  }
  if (amount > MAX_NIGHTLY_RATE) {
    return `nightly rate ${amount} exceeds maximum ${MAX_NIGHTLY_RATE} (likely monthly mistaken as nightly)`;
  }
  return null;
}

/** Validate a sale price. Returns an error message, or null when sane. */
export function validateSalePriceAmount(amount: unknown, currency: unknown): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return 'sale price must be a positive number';
  }
  if (!normalizeCurrency(typeof currency === 'string' ? currency : undefined)) {
    return 'sale price currency is required';
  }
  if (amount < MIN_SALE_PRICE) {
    return `sale price ${amount} is below minimum ${MIN_SALE_PRICE}`;
  }
  if (amount > MAX_SALE_PRICE) {
    return `sale price ${amount} exceeds maximum ${MAX_SALE_PRICE}`;
  }
  return null;
}

export interface OfferingPriceInput {
  offerings: readonly OfferingType[];
  longTermRent?: { monthlyAmount?: unknown; currency?: unknown } | null;
  shortTermRent?: { nightlyRate?: unknown; currency?: unknown } | null;
  sale?: { price?: unknown; currency?: unknown } | null;
  bedrooms?: number;
}

/**
 * Validate all priced blocks on a listing-shaped object. Returns the first error, or null.
 */
export function validateOfferingPrices(input: OfferingPriceInput): string | null {
  const offerings = new Set(input.offerings);

  if (offerings.has(OfferingType.LONG_TERM_RENT)) {
    const error = validateMonthlyRentAmount(
      input.longTermRent?.monthlyAmount,
      input.longTermRent?.currency,
      { bedrooms: input.bedrooms, isSale: false },
    );
    if (error) return error;
  }

  if (offerings.has(OfferingType.SHORT_TERM_RENT)) {
    const error = validateNightlyRateAmount(
      input.shortTermRent?.nightlyRate,
      input.shortTermRent?.currency,
    );
    if (error) return error;
  }

  if (offerings.has(OfferingType.SALE)) {
    const error = validateSalePriceAmount(input.sale?.price, input.sale?.currency);
    if (error) return error;
  }

  return null;
}
