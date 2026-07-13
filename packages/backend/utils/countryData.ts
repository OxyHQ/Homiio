/**
 * Country reference data.
 *
 * Single source of truth for ISO-2 code ↔ name ↔ default-currency mappings used
 * by the geo-resolution layer (and Address alias normalization). Kept small and
 * focused on the markets Homiio serves; unknown countries fall back to EUR and
 * a best-effort 2-letter code derived from the name.
 */

import type { ListingCurrency } from '@homiio/shared-types';

interface CountryEntry {
  code: string;
  name: string;
  currency: ListingCurrency;
}

const COUNTRIES: readonly CountryEntry[] = [
  { code: 'ES', name: 'Spain', currency: 'EUR' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'IT', name: 'Italy', currency: 'EUR' },
  { code: 'PT', name: 'Portugal', currency: 'EUR' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR' },
  { code: 'IE', name: 'Ireland', currency: 'EUR' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'CA', name: 'Canada', currency: 'CAD' },
  { code: 'MX', name: 'Mexico', currency: 'USD' },
  { code: 'BR', name: 'Brazil', currency: 'USD' },
  { code: 'AR', name: 'Argentina', currency: 'USD' },
  { code: 'CO', name: 'Colombia', currency: 'USD' },
  { code: 'CL', name: 'Chile', currency: 'USD' },
  { code: 'PE', name: 'Peru', currency: 'USD' },
];

const DEFAULT_CURRENCY: ListingCurrency = 'EUR';

/** Common alternative spellings → canonical ISO-2 code. */
const NAME_ALIASES: Readonly<Record<string, string>> = {
  'usa': 'US',
  'u.s.a.': 'US',
  'u.s.': 'US',
  'united states of america': 'US',
  'uk': 'GB',
  'u.k.': 'GB',
  'great britain': 'GB',
  'england': 'GB',
  'españa': 'ES',
  'espana': 'ES',
  'deutschland': 'DE',
  'italia': 'IT',
};

const byCode = new Map<string, CountryEntry>(COUNTRIES.map((c) => [c.code, c]));
const byName = new Map<string, CountryEntry>(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));

/** Resolve an ISO-2 code from a (possibly aliased) country name; undefined if unknown. */
export function countryNameToCode(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  const alias = NAME_ALIASES[key];
  if (alias) return alias;
  const entry = byName.get(key);
  if (entry) return entry.code;
  // Last resort: a bare 2-letter input is treated as a code.
  const upper = name.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : undefined;
}

/** Canonical English name for an ISO-2 code; undefined if unknown. */
export function countryCodeToName(code: string): string | undefined {
  return byCode.get(code.trim().toUpperCase())?.name;
}

/** Default currency for an ISO-2 code (EUR when unknown). */
export function defaultCurrencyForCountry(code: string): ListingCurrency {
  return byCode.get(code.trim().toUpperCase())?.currency ?? DEFAULT_CURRENCY;
}
