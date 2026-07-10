/**
 * Discover city lists from `LISTING_<MARKET>_CITIES` env vars (comma-separated).
 */

export type ListingMarket = 'ES' | 'GB' | 'US' | 'IT' | 'DE' | 'FR' | 'RO' | 'AR' | 'EC' | 'MX';

const ENV_KEYS: Readonly<Record<ListingMarket, string>> = {
  ES: 'LISTING_ES_CITIES',
  GB: 'LISTING_GB_CITIES',
  US: 'LISTING_US_CITIES',
  IT: 'LISTING_IT_CITIES',
  DE: 'LISTING_DE_CITIES',
  FR: 'LISTING_FR_CITIES',
  RO: 'LISTING_RO_CITIES',
  AR: 'LISTING_AR_CITIES',
  EC: 'LISTING_EC_CITIES',
  MX: 'LISTING_MX_CITIES',
};
/** Parse a comma-separated city list for a market. Empty when unset. */
export function citiesFromEnv(market: ListingMarket): string[] {
  return (process.env[ENV_KEYS[market]] ?? '')
    .split(',')
    .map((city) => city.trim())
    .filter(Boolean);
}

/** Provider options object when env cities are set; `{}` otherwise. */
export function citiesOptionsFromEnv(
  market: ListingMarket,
): { cities: string[] } | Record<string, never> {
  const cities = citiesFromEnv(market);
  return cities.length > 0 ? { cities } : {};
}
