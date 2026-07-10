/**
 * Heuristic filter for city names that should appear in user-facing geo pickers.
 * Rejects street/building-level labels that geo resolution sometimes creates.
 */

const MIN_NAME_LENGTH = 2;

/** Whole-word tokens that indicate a street or building, not a municipality. */
const STREET_BUILDING_TOKENS = [
  'street',
  'road',
  'avenue',
  'lane',
  'house',
  'calle',
  'avenida',
  'plaza',
] as const;

const STREET_BUILDING_PATTERN = new RegExp(
  `\\b(?:${STREET_BUILDING_TOKENS.join('|')})\\b`,
  'i',
);

/** Returns true when `name` looks like a real city/municipality label. */
export function isPlausibleCityName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? '';
  if (trimmed.length < MIN_NAME_LENGTH) {
    return false;
  }
  if (/\d/.test(trimmed)) {
    return false;
  }
  if (STREET_BUILDING_PATTERN.test(trimmed)) {
    return false;
  }
  return true;
}
