/**
 * Idealista discover city scope.
 *
 * Georeach discover warms a DataDome session per city. A market-wide job over
 * the full ES city list blocks the worker queue for hours. Default to Madrid.
 */

/** Default metros for Idealista browser discover. */
export const IDEALISTA_DEFAULT_CITIES: readonly string[] = ['madrid'];

function parseCityList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((city) => city.trim())
    .filter(Boolean);
}

/** Cities for Idealista discover: `LISTING_IDEALISTA_CITIES` or {@link IDEALISTA_DEFAULT_CITIES}. */
export function idealistaCitiesFromEnv(): string[] {
  const envCities = parseCityList(process.env.LISTING_IDEALISTA_CITIES);
  if (envCities.length > 0) return envCities;
  return [...IDEALISTA_DEFAULT_CITIES];
}

/** Provider options with the Idealista-specific city list. */
export function idealistaCitiesOptionsFromEnv(): { cities: readonly string[] } {
  return { cities: idealistaCitiesFromEnv() };
}
