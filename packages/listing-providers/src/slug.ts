/**
 * Shared city / path slug helpers.
 *
 * Providers must import {@link citySlug} from here instead of copying the
 * NFD-deaccent + lowercase + hyphenate snippet.
 */

/** `Cluj-Napoca` → `cluj-napoca`; strips diacritics. */
export function citySlug(city: string, separator: '-' | '_' = '-'): string {
  const sepRe = separator === '_' ? /[^a-z0-9]+/g : /[^a-z0-9]+/g;
  const trimRe = separator === '_' ? /^_+|_+$/g : /^-+|-+$/g;
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(sepRe, separator)
    .replace(trimRe, '');
}
