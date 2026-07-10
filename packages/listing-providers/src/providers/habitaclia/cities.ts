/**
 * Habitaclia discover city scope.
 *
 * Browser + listainmuebles discover warms a session per city. The full
 * `LISTING_ES_CITIES` list (~70 metros) in one discover job blocks the
 * single-concurrency queue for hours. Default to Madrid until coverage is broad.
 */

/** Default metros for Habitaclia browser discover. */
export const HABITACLIA_DEFAULT_CITIES: readonly string[] = ['madrid'];

function parseCityList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((city) => city.trim())
    .filter(Boolean);
}

/** Cities for Habitaclia discover: `LISTING_HABITACLIA_CITIES` or {@link HABITACLIA_DEFAULT_CITIES}. */
export function habitacliaCitiesFromEnv(): string[] {
  const envCities = parseCityList(process.env.LISTING_HABITACLIA_CITIES);
  if (envCities.length > 0) return envCities;
  return [...HABITACLIA_DEFAULT_CITIES];
}

/** Provider options with the Habitaclia-specific city list. */
export function habitacliaCitiesOptionsFromEnv(): { cities: readonly string[] } {
  return { cities: habitacliaCitiesFromEnv() };
}
