/**
 * Input validation for the geo gateway.
 *
 * Pure functions over `req.query`, separated from the controller so they can be
 * tested without an HTTP server and so every endpoint validates the same way.
 *
 * Two properties this has to hold that a naive `String(req.query.q)` does not.
 *
 * **Express query values are not strings.** `?q=a&q=b` arrives as an array and
 * `?q[x]=1` as an object (Express's `extended` query parser builds both). A
 * cast turns those into `"a,b"` and `"[object Object]"` and sends them to a
 * provider as a query, which is a non-textual payload reaching the network —
 * exactly what the issue says to reject. Each reader below therefore proves the
 * value is a string before doing anything else.
 *
 * **The backend does not rely on the client's debounce.** A client-side
 * debounce is a UX affordance, not a control: it is absent from a script, a
 * replay or an old app binary. The minimum and maximum query lengths, the limit
 * cap and the coordinate ranges here are the actual boundary.
 */

/** Shorter than this cannot usefully disambiguate and floods the provider. */
export const MIN_QUERY_LENGTH = 2;
/**
 * Longer than this is not a place name. Nominatim itself truncates long
 * queries, so accepting them buys nothing and widens the request surface.
 */
export const MAX_QUERY_LENGTH = 120;
export const MAX_SEARCH_LIMIT = 10;
export const DEFAULT_SEARCH_LIMIT = 5;
/** A `loc` token is an identifier, not a document. */
export const MAX_LOC_LENGTH = 256;

/**
 * Place types a caller may ask for.
 *
 * Kept as a local constant rather than derived from the shared `PlaceType`
 * union because a runtime membership test needs runtime values, and a type
 * cannot supply them. `normalize.ts` asserts the two agree.
 */
export const REQUESTABLE_PLACE_TYPES = [
  'country',
  'region',
  'city',
  'district',
  'neighborhood',
  'postcode',
  'address',
] as const;

export type RequestablePlaceType = (typeof REQUESTABLE_PLACE_TYPES)[number];

export class GeoValidationError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = 'GeoValidationError';
    this.field = field;
    this.code = code;
  }
}

/**
 * Read a query parameter that must be a string.
 *
 * Anything that is not a string — an array from a repeated parameter, an object
 * from bracket syntax — is rejected rather than coerced.
 */
export function readStringParam(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new GeoValidationError(field, 'INVALID_PARAM_TYPE', `${field} must be a single text value`);
  }
  return value;
}

export function parseQueryText(value: unknown): string {
  const raw = readStringParam(value, 'q');
  if (raw === undefined) {
    throw new GeoValidationError('q', 'MISSING_QUERY', 'q is required');
  }
  // Normalise BEFORE measuring: a decomposed "Gràcia" is 7 code points and a
  // precomposed one is 6, and a length rule that disagrees with itself
  // depending on how a keyboard emitted the accent is not a rule.
  const query = raw.normalize('NFC').trim();
  if (query.length < MIN_QUERY_LENGTH) {
    throw new GeoValidationError(
      'q',
      'QUERY_TOO_SHORT',
      `q must be at least ${MIN_QUERY_LENGTH} characters`,
    );
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new GeoValidationError(
      'q',
      'QUERY_TOO_LONG',
      `q must be at most ${MAX_QUERY_LENGTH} characters`,
    );
  }
  return query;
}

export function parseCountryCode(value: unknown): string | undefined {
  const raw = readStringParam(value, 'countryCode');
  if (raw === undefined || raw.trim() === '') return undefined;
  const code = raw.trim();
  if (!/^[A-Za-z]{2}$/.test(code)) {
    throw new GeoValidationError(
      'countryCode',
      'INVALID_COUNTRY_CODE',
      'countryCode must be an ISO-3166-1 alpha-2 code',
    );
  }
  return code.toUpperCase();
}

export function parseTypes(value: unknown): RequestablePlaceType[] | undefined {
  const raw = readStringParam(value, 'types');
  if (raw === undefined || raw.trim() === '') return undefined;
  const requested = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 0) return undefined;

  const allowed = new Set<string>(REQUESTABLE_PLACE_TYPES);
  const unknown = requested.filter((type) => !allowed.has(type));
  if (unknown.length > 0) {
    throw new GeoValidationError(
      'types',
      'INVALID_PLACE_TYPE',
      `types must be a comma-separated subset of: ${REQUESTABLE_PLACE_TYPES.join(', ')}`,
    );
  }
  return [...new Set(requested)] as RequestablePlaceType[];
}

export function parseLimit(value: unknown): number {
  const raw = readStringParam(value, 'limit');
  if (raw === undefined || raw.trim() === '') return DEFAULT_SEARCH_LIMIT;
  // `Number()` rather than `parseInt`: `parseInt('5abc')` is 5, which silently
  // accepts a malformed value instead of reporting it.
  const limit = Number(raw.trim());
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new GeoValidationError(
      'limit',
      'INVALID_LIMIT',
      `limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`,
    );
  }
  return limit;
}

export interface ParsedPoint {
  readonly longitude: number;
  readonly latitude: number;
}

const isLongitude = (value: number): boolean => Number.isFinite(value) && value >= -180 && value <= 180;
const isLatitude = (value: number): boolean => Number.isFinite(value) && value >= -90 && value <= 90;

/** `near=lng,lat` — GeoJSON order, matching every other coordinate on the wire. */
export function parseNear(value: unknown): ParsedPoint | undefined {
  const raw = readStringParam(value, 'near');
  if (raw === undefined || raw.trim() === '') return undefined;
  const parts = raw.split(',');
  if (parts.length !== 2) {
    throw new GeoValidationError('near', 'INVALID_NEAR', 'near must be "lng,lat"');
  }
  const longitude = Number(parts[0].trim());
  const latitude = Number(parts[1].trim());
  if (!isLongitude(longitude) || !isLatitude(latitude)) {
    throw new GeoValidationError(
      'near',
      'INVALID_NEAR',
      'near must be "lng,lat" within [-180,180] and [-90,90]',
    );
  }
  return { longitude, latitude };
}

/**
 * `lng` and `lat` for reverse geocoding.
 *
 * Both required and both range-checked. A NaN reaching the provider would be
 * serialised into the URL as the literal `NaN`, which some instances answer
 * with a 200 and a nonsense place rather than an error.
 */
export function parseReversePoint(query: Record<string, unknown>): ParsedPoint {
  const rawLng = readStringParam(query.lng, 'lng');
  const rawLat = readStringParam(query.lat, 'lat');
  if (rawLng === undefined || rawLat === undefined) {
    throw new GeoValidationError('lng', 'MISSING_COORDINATES', 'lng and lat are required');
  }
  const longitude = Number(rawLng.trim());
  const latitude = Number(rawLat.trim());
  if (!isLongitude(longitude)) {
    throw new GeoValidationError(
      'lng',
      'INVALID_COORDINATES',
      'lng must be a number within [-180, 180]',
    );
  }
  if (!isLatitude(latitude)) {
    throw new GeoValidationError(
      'lat',
      'INVALID_COORDINATES',
      'lat must be a number within [-90, 90]',
    );
  }
  return { longitude, latitude };
}

/**
 * BCP-47-ish language tag, from the explicit `language` parameter or the
 * `Accept-Language` header.
 *
 * Only the primary tag and an optional region are kept (`ca`, `pt-BR`); quality
 * values and long private-use subtags are dropped. The value ends up in a cache
 * key, so an unbounded string from a header would let a caller mint unlimited
 * distinct keys for the same query — a cache-poisoning shape, cheap to close
 * here and awkward to close later.
 */
export function parseLanguage(explicit: unknown, acceptLanguageHeader?: string): string {
  const raw = readStringParam(explicit, 'language');
  const candidate = raw?.trim() || acceptLanguageHeader?.split(',')[0]?.split(';')[0]?.trim() || '';
  if (!candidate) return '';
  const match = /^([A-Za-z]{2,3})(?:-([A-Za-z]{2}|\d{3}))?$/.exec(candidate);
  if (!match) return '';
  const primary = match[1].toLowerCase();
  return match[2] ? `${primary}-${match[2].toUpperCase()}` : primary;
}

export function parseLocToken(value: unknown): string {
  const raw = readStringParam(value, 'loc');
  if (raw === undefined || raw.trim() === '') {
    throw new GeoValidationError('loc', 'MISSING_LOC', 'loc is required');
  }
  const token = raw.trim();
  if (token.length > MAX_LOC_LENGTH) {
    throw new GeoValidationError('loc', 'INVALID_LOC', 'loc is not a valid location token');
  }
  return token;
}
