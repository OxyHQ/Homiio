/**
 * The slug rule for a place name, defined ONCE and emitted in two forms.
 *
 * A slug is how a place reaches Homiio from outside — `?city=barcelona`, an old
 * bookmark, a shared link — so it has to survive being typed by a human, being
 * stripped of accents by whatever produced it, and being compared against a name
 * stored as `Málaga`. It is NOT an identity: two cities can slug to the same
 * string, which is precisely why `db/geo/placeLookup.ts` answers a slug with a
 * candidate LIST rather than a row.
 *
 * ## Why the rule exists twice, and why that is not a drift risk
 *
 * Postgres needs it as an expression (`cities.slug` is `GENERATED ALWAYS`, so
 * the database computes it on every write and an index can be built on it);
 * TypeScript needs it to slug an inbound token before comparing. Both forms are
 * DERIVED from the tables below rather than written out twice — {@link
 * placeSlugSql} builds its SQL text from the same arrays {@link slugifyPlaceName}
 * iterates — so a change to the rule cannot land in one form and not the other.
 * The two are still asserted to agree against a real server, because "derived
 * from the same data" is an argument and the test is the measurement: see the
 * `the slug rule agrees in TypeScript and in Postgres` block in
 * `__tests__/integration/cityPlaceLookup.test.ts`. It reads the `GENERATED`
 * column back off the database rather than recomputing it, so it also catches a
 * migration that was never regenerated after this file changed.
 *
 * ## Why not `unaccent()`
 *
 * `unaccent` is the obvious tool and it CANNOT be used here: measured on the
 * `postgis/postgis:17-3.5` server this repo runs, both overloads
 * (`unaccent(text)` and `unaccent(regdictionary, text)`) are marked STABLE, so
 * `CREATE INDEX … (unaccent(name))` fails outright with
 * `functions in index expression must be marked IMMUTABLE`, and a generated
 * column refuses it for the same reason. `translate`, `replace`, `lower` and
 * `regexp_replace` are all IMMUTABLE, so the rule is built from those instead.
 * The cost is that the transliteration table is ours to maintain rather than the
 * extension's; the benefit is that the stored value cannot silently change
 * meaning when the extension's dictionary is upgraded under an existing index.
 *
 * A character this table does not know is not mangled — it falls through to the
 * `[^a-z0-9]+ → -` rule, so `千代田区` slugs to the empty string rather than to
 * something wrong. An empty slug matches nothing, which is the correct outcome:
 * such a place is addressable by id, and a slug was never going to identify it.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Unicode combining diacritical marks, removed straight after lowercasing.
 *
 * **This step exists because the two forms disagreed without it, and the
 * disagreement was found by the test rather than reasoned about.** Turkish `İ`
 * (U+0130) lowercases to a single `i` in Postgres under `en_US.utf8`, and to
 * `i` + U+0307 (COMBINING DOT ABOVE) in JavaScript, which is Unicode-strict. So
 * `İzmir` stored in the database slugged to `izmir` while the same name typed
 * into a URL slugged to `i-zmir` in TypeScript — the combining mark fell through
 * to the `[^a-z0-9]+ → -` rule. A lookup for that city would simply have
 * stopped matching, with no error anywhere.
 *
 * Removing the marks on BOTH sides also fixes the mirror case, which stripping
 * them on the JavaScript side alone would have introduced: a name STORED in
 * decomposed form (`Ma` + U+0301 + `laga`) is not in the precomposed
 * transliteration table, so Postgres would have turned it into `ma-laga`.
 *
 * Written with ASCII `\uXXXX` escapes on purpose. Postgres' advanced regular
 * expressions accept them (verified against this repo's server, with a control
 * confirming `a-b` is left alone), and the alternative — the two invisible
 * characters themselves, inside a bracket expression, in a migration file — is
 * unreviewable.
 */
const COMBINING_MARKS = '[\\u0300-\\u036F]';

/**
 * Characters that expand to more than one ASCII character.
 *
 * `translate` maps character-to-character and cannot do this — given a shorter
 * `to` string it DELETES the character instead, which is a silent wrong answer
 * (`straße` → `strae`). So these run first, as ordinary replacements.
 */
export const SLUG_EXPANSIONS: ReadonlyArray<readonly [string, string]> = [
  ['ß', 'ss'],
  ['æ', 'ae'],
  ['œ', 'oe'],
  ['þ', 'th'],
  ['ĳ', 'ij'],
];

/**
 * One-to-one transliterations, applied after {@link SLUG_EXPANSIONS} and after
 * `lower()`, so only lowercase forms need an entry.
 *
 * Coverage is the Latin scripts Homiio's markets are written in (see AGENTS.md
 * §"Market status"): Spanish, Portuguese, Catalan, Italian, French, German,
 * Dutch, Polish, Romanian, Czech/Slovak, Croatian, Turkish, the Nordics.
 */
export const SLUG_TRANSLITERATIONS: ReadonlyArray<readonly [string, string]> = [
  ['à', 'a'], ['á', 'a'], ['â', 'a'], ['ã', 'a'], ['ä', 'a'], ['å', 'a'], ['ā', 'a'], ['ă', 'a'], ['ą', 'a'],
  ['ç', 'c'], ['ć', 'c'], ['č', 'c'], ['ĉ', 'c'], ['ċ', 'c'],
  ['ď', 'd'], ['đ', 'd'], ['ð', 'd'],
  ['è', 'e'], ['é', 'e'], ['ê', 'e'], ['ë', 'e'], ['ē', 'e'], ['ĕ', 'e'], ['ė', 'e'], ['ę', 'e'], ['ě', 'e'],
  ['ĝ', 'g'], ['ğ', 'g'], ['ġ', 'g'], ['ģ', 'g'],
  ['ĥ', 'h'], ['ħ', 'h'],
  ['ì', 'i'], ['í', 'i'], ['î', 'i'], ['ï', 'i'], ['ĩ', 'i'], ['ī', 'i'], ['ĭ', 'i'], ['į', 'i'], ['ı', 'i'],
  ['ĵ', 'j'],
  ['ķ', 'k'],
  ['ĺ', 'l'], ['ļ', 'l'], ['ľ', 'l'], ['ł', 'l'],
  ['ñ', 'n'], ['ń', 'n'], ['ņ', 'n'], ['ň', 'n'],
  ['ò', 'o'], ['ó', 'o'], ['ô', 'o'], ['õ', 'o'], ['ö', 'o'], ['ø', 'o'], ['ō', 'o'], ['ŏ', 'o'], ['ő', 'o'],
  ['ŕ', 'r'], ['ŗ', 'r'], ['ř', 'r'],
  ['ś', 's'], ['ŝ', 's'], ['ş', 's'], ['š', 's'], ['ș', 's'],
  ['ţ', 't'], ['ť', 't'], ['ŧ', 't'], ['ț', 't'],
  ['ù', 'u'], ['ú', 'u'], ['û', 'u'], ['ü', 'u'], ['ũ', 'u'], ['ū', 'u'], ['ŭ', 'u'], ['ů', 'u'], ['ű', 'u'], ['ų', 'u'],
  ['ŵ', 'w'],
  ['ý', 'y'], ['ÿ', 'y'], ['ŷ', 'y'],
  ['ź', 'z'], ['ż', 'z'], ['ž', 'z'],
];

const TRANSLATE_FROM = SLUG_TRANSLITERATIONS.map(([from]) => from).join('');
const TRANSLATE_TO = SLUG_TRANSLITERATIONS.map(([, to]) => to).join('');

/**
 * Slug a place name in TypeScript.
 *
 * Used on the INBOUND side — the token a deep link or a saved search carries —
 * so it is compared against the stored `slug` column with the same rule that
 * produced it.
 */
export function slugifyPlaceName(name: string): string {
  let out = name.toLowerCase().replace(new RegExp(COMBINING_MARKS, 'g'), '');
  for (const [from, to] of SLUG_EXPANSIONS) out = out.split(from).join(to);
  let mapped = '';
  for (const character of out) {
    const index = TRANSLATE_FROM.indexOf(character);
    mapped += index === -1 ? character : TRANSLATE_TO[index];
  }
  return mapped.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A single-quoted SQL string literal. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The same rule as a SQL expression over `column`.
 *
 * `sql.raw` for every literal, deliberately: this expression is written into a
 * `GENERATED ALWAYS AS (…)` column definition, and DDL cannot carry a bound
 * parameter — an interpolated value would be emitted into the migration as the
 * placeholder `$1` and fail at APPLY time, not at generation time
 * (`~/Oxy/AGENTS.md` §"Drizzle `sql` templates").
 */
export function placeSlugSql(column: AnyPgColumn | SQL): SQL {
  let expression = sql`regexp_replace(lower(${column}), ${sql.raw(literal(COMBINING_MARKS))}, '', 'g')`;
  for (const [from, to] of SLUG_EXPANSIONS) {
    expression = sql`replace(${expression}, ${sql.raw(literal(from))}, ${sql.raw(literal(to))})`;
  }
  return sql`regexp_replace(
    regexp_replace(
      translate(${expression}, ${sql.raw(literal(TRANSLATE_FROM))}, ${sql.raw(literal(TRANSLATE_TO))}),
      '[^a-z0-9]+', '-', 'g'
    ),
    '^-+|-+$', '', 'g'
  )`;
}
