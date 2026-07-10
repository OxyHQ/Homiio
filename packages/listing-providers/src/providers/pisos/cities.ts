/**
 * Pisos discover city scope — `LISTING_PISOS_CITIES` override, else `LISTING_ES_CITIES`.
 */

import { providerCitiesFromEnv, providerCitiesOptionsFromEnv } from '../../parse/cities';

const PROVIDER_CITIES_ENV = 'LISTING_PISOS_CITIES';

/** Cities for Pisos discover: `LISTING_PISOS_CITIES` or the ES market list. */
export function pisosCitiesFromEnv(): string[] {
  return providerCitiesFromEnv(PROVIDER_CITIES_ENV, 'ES');
}

/** Provider options with the Pisos city list. */
export function pisosCitiesOptionsFromEnv(): { cities: readonly string[] } {
  return providerCitiesOptionsFromEnv(PROVIDER_CITIES_ENV, 'ES');
}
