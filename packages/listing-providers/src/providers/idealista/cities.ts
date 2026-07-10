/**
 * Idealista discover city scope — `LISTING_IDEALISTA_CITIES` override, else `LISTING_ES_CITIES`.
 */

import { providerCitiesFromEnv, providerCitiesOptionsFromEnv } from '../../parse/cities';

const PROVIDER_CITIES_ENV = 'LISTING_IDEALISTA_CITIES';

/** Cities for Idealista discover: `LISTING_IDEALISTA_CITIES` or the ES market list. */
export function idealistaCitiesFromEnv(): string[] {
  return providerCitiesFromEnv(PROVIDER_CITIES_ENV, 'ES');
}

/** Provider options with the Idealista city list. */
export function idealistaCitiesOptionsFromEnv(): { cities: readonly string[] } {
  return providerCitiesOptionsFromEnv(PROVIDER_CITIES_ENV, 'ES');
}
