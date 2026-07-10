/**
 * Configurable discover pagination caps from env.
 *
 * Per-provider override: `LISTING_<PROVIDER>_MAX_PAGES` (e.g. `LISTING_FOTOCASA_MAX_PAGES`).
 * ES-wide fallback when unset: `LISTING_ES_MAX_PAGES`.
 */

const MAX_PAGES_CEILING = 200;

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
  market?:
    | 'ES'
    | 'GB'
    | 'US'
    | 'IT'
    | 'DE'
    | 'FR'
    | 'RO'
    | 'AR'
    | 'EC'
    | 'MX'
    | 'CA'
    | 'AU'
    | 'AE'
    | 'CO'
    | 'CL'
    | 'PE'
    | 'PT'
    | 'CA'
    | 'AU'
    | 'AE',
): number {
  const providerKey = `LISTING_${providerId.toUpperCase()}_MAX_PAGES`;
  const providerRaw = process.env[providerKey];
  if (providerRaw !== undefined && providerRaw.trim() !== '') {
    return maxSearchPagesFromEnv(providerKey, fallback);
  }
  if (market === 'ES') {
    const esRaw = process.env.LISTING_ES_MAX_PAGES;
    if (esRaw !== undefined && esRaw.trim() !== '') {
      return maxSearchPagesFromEnv('LISTING_ES_MAX_PAGES', fallback);
    }
  }
  return fallback;
}
