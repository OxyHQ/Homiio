/**
 * Agency name canonicalization helpers.
 *
 * An {@link Agency} is deduplicated by a diacritics-stripped, case-folded,
 * whitespace-collapsed `normalizedName` and addressed publicly by a URL-safe
 * `slug`. Both derivations live here so the model's `findOrCreateByName` write
 * path and the read-side agency search apply the exact same rules — a portal
 * that reports "Fincas García" and one that reports "FINCAS  garcia" must
 * resolve to a single agency.
 */

/** Unicode combining diacritical marks (stripped after NFD decomposition). */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Fold a raw agency name to its canonical dedup key: NFD-decompose, strip
 * combining diacritics, lowercase, collapse internal whitespace, trim.
 */
export function normalizeAgencyName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Derive a URL-safe slug from a raw agency name: diacritics-stripped,
 * lowercased, non-alphanumeric runs replaced with a single hyphen, no leading
 * or trailing hyphen. Returns an empty string when the name has no slug-able
 * characters (callers must guard).
 */
export function slugifyAgencyName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Escape a string for safe use inside a `RegExp` (prefix search, etc.). */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
