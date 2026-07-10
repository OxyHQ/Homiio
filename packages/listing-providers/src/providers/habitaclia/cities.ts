/**
 * Habitaclia discover city scope — `LISTING_HABITACLIA_CITIES` override, else `LISTING_ES_CITIES`.
 */

import { providerCitiesFromEnv, providerCitiesOptionsFromEnv } from '../../parse/cities';

const PROVIDER_CITIES_ENV = 'LISTING_HABITACLIA_CITIES';

/** Cities for Habitaclia discover: `LISTING_HABITACLIA_CITIES` or the ES market list. */
export function habitacliaCitiesFromEnv(): string[] {
  return providerCitiesFromEnv(PROVIDER_CITIES_ENV, 'ES');
}

/** Provider options with the Habitaclia city list. */
export function habitacliaCitiesOptionsFromEnv(): { cities: readonly string[] } {
  return providerCitiesOptionsFromEnv(PROVIDER_CITIES_ENV, 'ES');
}
