/**
 * Fotocasa discover city scope.
 *
 * Fotocasa discover warms a Playwright session per city — using the full
 * `LISTING_ES_CITIES` list (~70 metros) makes a single discover job run for
 * hours before any fetch jobs enqueue. This module keeps Fotocasa on a smaller
 * default set with an optional `LISTING_FOTOCASA_CITIES` override.
 */

/** Default metros for Fotocasa browser discover (not the full ES market list). */
export const FOTOCASA_DEFAULT_CITIES: readonly string[] = [
  'madrid',
  'barcelona',
  'valencia',
];

function parseCityList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((city) => city.trim())
    .filter(Boolean);
}

/** Cities for Fotocasa discover: `LISTING_FOTOCASA_CITIES` or {@link FOTOCASA_DEFAULT_CITIES}. */
export function fotocasaCitiesFromEnv(): string[] {
  const envCities = parseCityList(process.env.LISTING_FOTOCASA_CITIES);
  if (envCities.length > 0) return envCities;
  return [...FOTOCASA_DEFAULT_CITIES];
}

/** Provider options with the Fotocasa-specific city list. */
export function fotocasaCitiesOptionsFromEnv(): { cities: readonly string[] } {
  return { cities: fotocasaCitiesFromEnv() };
}
