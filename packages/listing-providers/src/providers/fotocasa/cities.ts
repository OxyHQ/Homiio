/**
 * Fotocasa discover city scope — `LISTING_FOTOCASA_CITIES` override, else `LISTING_ES_CITIES`.
 */

import { providerCitiesFromEnv, providerCitiesOptionsFromEnv } from '../../parse/cities';

const PROVIDER_CITIES_ENV = 'LISTING_FOTOCASA_CITIES';

/** Cities for Fotocasa discover: `LISTING_FOTOCASA_CITIES` or the ES market list. */
export function fotocasaCitiesFromEnv(): string[] {
  return providerCitiesFromEnv(PROVIDER_CITIES_ENV, 'ES');
}

/** Provider options with the Fotocasa city list. */
export function fotocasaCitiesOptionsFromEnv(): { cities: readonly string[] } {
  return providerCitiesOptionsFromEnv(PROVIDER_CITIES_ENV, 'ES');
}
