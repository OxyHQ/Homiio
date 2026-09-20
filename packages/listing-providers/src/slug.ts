/**
 * Shared city / path slug helpers.
 *
 * Providers must import {@link citySlug} from here instead of copying the
 * NFD-deaccent + lowercase + hyphenate snippet.
 */

/** `Ciudad de México` → `ciudad-de-mexico`; strips diacritics. */
export function citySlug(city: string, separator: '-' | '_' = '-'): string {
  const collapsed = city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, separator);
  return trimSeparator(collapsed, separator);
}

/**
 * Strip leading and trailing separators, without a regex.
 *
 * The obvious `/^-+|-+$/g` is a polynomial ReDoS (CodeQL `js/polynomial-redos`):
 * on a run of separators the `-+$` branch re-matches from every position and
 * fails `$` each time. Bounded in practice — the collapse above leaves at most
 * one separator at each end — but "the input can't reach the bad case" is an
 * argument about today's caller, and this function is exported for anyone to
 * call with anything.
 *
 * Two index walks are linear, obviously so, and need no argument at all.
 */
function trimSeparator(value: string, separator: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === separator) start += 1;
  while (end > start && value[end - 1] === separator) end -= 1;
  return value.slice(start, end);
}
