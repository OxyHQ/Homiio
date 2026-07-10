/**
 * Shared city / path slug helpers.
 *
 * Providers must import {@link citySlug} from here instead of copying the
 * NFD-deaccent + lowercase + hyphenate snippet.
 */

/** `Ciudad de México` → `ciudad-de-mexico`; strips diacritics. */
export function citySlug(city: string, separator: '-' | '_' = '-'): string {
  const trimRe = separator === '_' ? /^_+|_+$/g : /^-+|-+$/g;
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(trimRe, '');
}
