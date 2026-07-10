/**
 * Pisos discover city scope.
 *
 * Pisos discover can warm a browser session per city and paginate deeply. A
 * single market-wide job over the full `LISTING_ES_CITIES` list blocks the
 * single-concurrency discover worker for hours before Fotocasa/Habitaclia jobs
 * run. Keep Pisos on its own default metros with `LISTING_PISOS_CITIES`.
 */

/** Default metros for Pisos discover (matches the provider's historical scope). */
export const PISOS_DEFAULT_CITIES: readonly string[] = [
  'madrid',
  'barcelona',
  'valencia',
  'sevilla',
  'malaga',
  'bilbao',
  'zaragoza',
  'alicante',
  'murcia',
  'palma',
];

function parseCityList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((city) => city.trim())
    .filter(Boolean);
}

/** Cities for Pisos discover: `LISTING_PISOS_CITIES` or {@link PISOS_DEFAULT_CITIES}. */
export function pisosCitiesFromEnv(): string[] {
  const envCities = parseCityList(process.env.LISTING_PISOS_CITIES);
  if (envCities.length > 0) return envCities;
  return [...PISOS_DEFAULT_CITIES];
}

/** Provider options with the Pisos-specific city list. */
export function pisosCitiesOptionsFromEnv(): { cities: readonly string[] } {
  return { cities: pisosCitiesFromEnv() };
}
