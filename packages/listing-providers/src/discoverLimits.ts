/**
 * Configurable discover pagination caps from env.
 *
 * Per-provider override: `LISTING_<PROVIDER>_MAX_PAGES` (e.g. `LISTING_FOTOCASA_MAX_PAGES`).
 * Market-wide fallback: `LISTING_<MARKET>_MAX_PAGES` (e.g. `LISTING_ES_MAX_PAGES`).
 */

import type { ListingMarket } from './parse/cities';

/** Upper bound for env-configured page caps (raise via env, not code). */
export const MAX_PAGES_CEILING = 500;

const MARKET_MAX_PAGES_ENV: Readonly<Partial<Record<ListingMarket, string>>> = {
  ES: 'LISTING_ES_MAX_PAGES',
  GB: 'LISTING_GB_MAX_PAGES',
  US: 'LISTING_US_MAX_PAGES',
  IT: 'LISTING_IT_MAX_PAGES',
  DE: 'LISTING_DE_MAX_PAGES',
  FR: 'LISTING_FR_MAX_PAGES',
  RO: 'LISTING_RO_MAX_PAGES',
  AR: 'LISTING_AR_MAX_PAGES',
  EC: 'LISTING_EC_MAX_PAGES',
  MX: 'LISTING_MX_MAX_PAGES',
  CO: 'LISTING_CO_MAX_PAGES',
  CL: 'LISTING_CL_MAX_PAGES',
  PE: 'LISTING_PE_MAX_PAGES',
  PT: 'LISTING_PT_MAX_PAGES',
  CA: 'LISTING_CA_MAX_PAGES',
  AU: 'LISTING_AU_MAX_PAGES',
  AE: 'LISTING_AE_MAX_PAGES',
  IE: 'LISTING_IE_MAX_PAGES',
  BE: 'LISTING_BE_MAX_PAGES',
  PL: 'LISTING_PL_MAX_PAGES',
  NL: 'LISTING_NL_MAX_PAGES',
};

/** Parse a positive integer env var, clamped to {@link MAX_PAGES_CEILING}. */
export function maxSearchPagesFromEnv(envKey: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[envKey] ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_PAGES_CEILING);
}

/**
 * Resolve max search pages for a provider discover loop.
 * Checks provider-specific env first, then optional market-wide fallback.
 */
export function providerMaxSearchPages(
  providerId: string,
  fallback: number,
  market?: ListingMarket,
): number {
  const providerKey = `LISTING_${providerId.toUpperCase()}_MAX_PAGES`;
  const providerRaw = process.env[providerKey];
  if (providerRaw !== undefined && providerRaw.trim() !== '') {
    return maxSearchPagesFromEnv(providerKey, fallback);
  }
  if (market !== undefined) {
    const marketKey = MARKET_MAX_PAGES_ENV[market];
    if (marketKey !== undefined) {
      const marketRaw = process.env[marketKey];
      if (marketRaw !== undefined && marketRaw.trim() !== '') {
        return maxSearchPagesFromEnv(marketKey, fallback);
      }
    }
  }
  return fallback;
}
