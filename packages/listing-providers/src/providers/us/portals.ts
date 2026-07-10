/**
 * Shared US portal helpers (city slugs, Stingray prefix, default markets).
 */

/** US cities enumerated when a discover job omits an explicit `city`. */
export const DEFAULT_US_CITIES: readonly string[] = [
  'New York, NY',
  'Los Angeles, CA',
  'Chicago, IL',
  'Austin, TX',
  'Miami, FL',
];

/** `Austin, TX` → `austin-tx` (HotPads resourceId slug). */
export function cityToResourceSlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/,/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `Austin, TX` → `austin-tx` search slug segment (same as resource slug). */
export function cityToSearchSlug(city: string): string {
  return cityToResourceSlug(city);
}

/** Redfin Stingray responses are prefixed with `{}&&` — strip before JSON.parse. */
export function stripStingrayPrefix(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith('{}&&')) return trimmed.slice(4);
  return trimmed;
}

/** JSON bodies that indicate a Stingray / portal challenge rather than listings. */
export function isStingrayErrorBody(body: string): boolean {
  const trimmed = stripStingrayPrefix(body);
  if (!trimmed.startsWith('{')) return true;
  try {
    const parsed = JSON.parse(trimmed) as { resultCode?: unknown; errorMessage?: unknown };
    if (typeof parsed.resultCode === 'number' && parsed.resultCode !== 0) return true;
    if (typeof parsed.errorMessage === 'string' && parsed.errorMessage.length > 0) return true;
    return false;
  } catch {
    return true;
  }
}
