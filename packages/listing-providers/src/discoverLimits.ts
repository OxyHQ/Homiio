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

/**
 * Images kept per external listing (`LISTING_MAX_IMAGES_PER_LISTING`).
 *
 * **THE SINGLE MOST EXPENSIVE NUMBER IN THE INGEST, AND IT HAD NO KNOB.** Every
 * image is re-hosted, not hotlinked: downloaded through the network, resized by
 * Sharp, and written to S3 where it is stored and served forever. So this one
 * integer multiplies bandwidth, worker CPU and storage together, once per
 * listing, on every market.
 *
 * The scale is not hypothetical. Four Spanish cities alone advertise ~14,000
 * rentals (Madrid 8,121, Barcelona 3,269, Valencia 2,605, Zaragoza 130);
 * at 30 images each that is 420,000 downloads for four cities out of 68.
 *
 * The default is 30 — unchanged, because lowering it is a product decision
 * about how a gallery looks, not a refactor. What changes is that it can now be
 * lowered from the task definition without a deploy, and that the providers
 * which carry images through the queue honour the same number instead of
 * guessing their own.
 */
export const DEFAULT_MAX_IMAGES_PER_LISTING = 30;

/** Hard ceiling, so a typo in the task definition cannot uncap the ingest. */
export const MAX_IMAGES_CEILING = 60;

/** Read `LISTING_MAX_IMAGES_PER_LISTING`, clamped to {@link MAX_IMAGES_CEILING}. */
export function maxImagesPerListingFromEnv(): number {
  const raw = process.env.LISTING_MAX_IMAGES_PER_LISTING?.trim();
  if (!raw) return DEFAULT_MAX_IMAGES_PER_LISTING;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_MAX_IMAGES_PER_LISTING;
  return Math.min(parsed, MAX_IMAGES_CEILING);
}

/**
 * Images re-hosted concurrently per listing (`LISTING_IMAGE_INGEST_CONCURRENCY`).
 *
 * Pairs with {@link maxImagesPerListingFromEnv}: that one decides how much work
 * a listing creates, this one how fast it is worked through. Serial ingest
 * measured 4.6 listings/minute in production with a 9.5 s median gap; six at a
 * time is the difference between thirty hours for Madrid and about five.
 *
 * Kept modest on purpose. Each image fans out into four Sharp pipelines and
 * four S3 PUTs, and several fetch workers run at once, so the real concurrency
 * is this number times four times the worker count. Raising it far trades a
 * throughput win for socket exhaustion and libvips thread thrash.
 */
export function imageIngestConcurrencyFromEnv(): number {
  const raw = process.env.LISTING_IMAGE_INGEST_CONCURRENCY?.trim();
  if (!raw) return 6;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 6;
  return Math.min(parsed, 24);
}
