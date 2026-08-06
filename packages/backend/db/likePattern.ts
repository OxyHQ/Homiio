/**
 * Escaping a user string for `LIKE` / `ILIKE`
 *
 * ## This is not a rename of `escapeRegExp`, it is a different escape
 *
 * Mongo's unanchored typeahead filters (`{ $regex: q, $options: 'i' }`) ran the
 * term through `escapeRegExp`, which escapes the REGEX metacharacters
 * (`. * + ? ^ $ { } ( ) | [ ] \`). Their Postgres form is
 * `ILIKE '%' || $1 || '%'`, and `LIKE` has a completely different, much smaller
 * metacharacter set: `%` (any run of characters), `_` (any one character), and
 * the escape character itself, `\`.
 *
 * The two sets barely overlap, and the direction of the mistake matters:
 *
 * | User types | Mongo (regex, escaped) | Postgres WITHOUT this | Postgres WITH this |
 * |---|---|---|---|
 * | `100%` | literal `100%` | `%` becomes a WILDCARD — `100` matches everything after it | literal `100%` |
 * | `C_2`  | literal `C_2` | `_` matches any character | literal `C_2` |
 * | `a.b`  | literal `a.b` | literal `a.b` (`.` means nothing to LIKE) | literal `a.b` |
 *
 * So porting the call sites without changing the escape is a QUIET behaviour
 * change on the search box: a term containing `%` silently stops filtering. It
 * is not a crash and no test that only searches alphabetic terms would ever see
 * it, which is exactly why the escape gets its own module and its own test
 * rather than being inlined at each of the four call sites.
 *
 * ## Why backslash, and why no explicit `ESCAPE` clause
 *
 * `\` is `LIKE`'s DEFAULT escape character, and that default is a property of
 * the `LIKE` operator — not of string-literal parsing — so it holds regardless
 * of `standard_conforming_strings`. Every call site passes the pattern as a bound
 * PARAMETER, so the value never goes through literal parsing at all and arrives
 * byte-for-byte as written here.
 */

/**
 * Escape `%`, `_` and `\` so `value` matches LITERALLY inside a `LIKE`/`ILIKE`
 * pattern.
 *
 * The backslash must be escaped FIRST in the same pass, which is why this is one
 * character class and not three chained `replace` calls: escaping `%` before `\`
 * would turn a user's `\` into `\\` and then re-escape the backslash this
 * function just introduced.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
