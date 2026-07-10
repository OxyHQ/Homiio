/**
 * Discover city lists from `LISTING_<MARKET>_CITIES` env vars (comma-separated).
 * Falls back to {@link DEFAULT_MARKET_CITIES} when env is unset or empty.
 */

import { DEFAULT_MARKET_CITIES } from './defaultMarketCities';

export type ListingMarket =
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
  | 'CO'
  | 'CL'
  | 'PE'
  | 'PT'
  | 'CA'
  | 'AU'
  | 'AE'
  | 'IE'
  | 'BE'
  | 'PL'
  | 'NL';

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
  CO: 'LISTING_CO_CITIES',
  CL: 'LISTING_CL_CITIES',
  PE: 'LISTING_PE_CITIES',
  PT: 'LISTING_PT_CITIES',
  CA: 'LISTING_CA_CITIES',
  AU: 'LISTING_AU_CITIES',
  AE: 'LISTING_AE_CITIES',
  IE: 'LISTING_IE_CITIES',
  BE: 'LISTING_BE_CITIES',
  PL: 'LISTING_PL_CITIES',
  NL: 'LISTING_NL_CITIES',
};

function parseCityList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((city) => city.trim())
    .filter(Boolean);
}

/** US cities use `City, ST` — split on state suffix, not bare commas. */
function parseUsCityList(raw: string | undefined): string[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];
  if (trimmed.includes('|')) {
    return trimmed
      .split('|')
      .map((city) => city.trim())
      .filter(Boolean);
  }
  const matches = trimmed.match(/[^,|]+,\s*[A-Z]{2}/g);
  if (matches && matches.length > 0) {
    return matches.map((city) => city.trim());
  }
  return parseCityList(trimmed);
}

/**
 * Cities for a market: env override when set, otherwise the bundled default list.
 */
export function citiesFromEnv(market: ListingMarket): string[] {
  const envRaw = process.env[ENV_KEYS[market]];
  const envCities = market === 'US' ? parseUsCityList(envRaw) : parseCityList(envRaw);
  if (envCities.length > 0) return envCities;
  return [...DEFAULT_MARKET_CITIES[market]];
}

/** Provider options with the resolved city list (env or defaults). */
export function citiesOptionsFromEnv(market: ListingMarket): { cities: string[] } {
  return { cities: citiesFromEnv(market) };
}

/**
 * Discover cities for one provider: optional `LISTING_<PROVIDER>_CITIES` override,
 * otherwise the market list from `LISTING_<MARKET>_CITIES` / bundled defaults.
 */
export function providerCitiesFromEnv(providerEnvKey: string, market: ListingMarket): string[] {
  const envRaw = process.env[providerEnvKey];
  const envCities = market === 'US' ? parseUsCityList(envRaw) : parseCityList(envRaw);
  if (envCities.length > 0) return envCities;
  return citiesFromEnv(market);
}

/** Provider options with optional per-provider city override. */
export function providerCitiesOptionsFromEnv(
  providerEnvKey: string,
  market: ListingMarket,
): { cities: string[] } {
  return { cities: providerCitiesFromEnv(providerEnvKey, market) };
}
