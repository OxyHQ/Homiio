/**
 * Column-Naming Authority
 *
 * Schema modules declare columns in camelCase and let drizzle derive the
 * snake_case SQL name. That derivation happens in THREE places that must agree,
 * or queries reference columns the migrations never created: `drizzle()` in
 * `db/postgres.ts` (what queries reference), `drizzle-kit` in
 * `drizzle.config.ts` (what the DDL creates), and any code that needs the SQL
 * name for a catalogue lookup. All three read `DATABASE_CASING` from here, so
 * there is one setting rather than three copies to keep in lockstep.
 *
 * The implementations live in `@oxyhq/db` — every Oxy backend on Postgres uses
 * the same convention, and a second copy of the converter is a second thing that
 * can disagree with drizzle. This module exists to give Homiio ONE import path
 * for them and to carry the trap below where a reader will meet it.
 *
 * ## The trap: `column.name` is the TypeScript property name, never the SQL one
 *
 * `column.name` on a drizzle column is `postalCode`, not `postal_code` — casing
 * is applied when SQL is BUILT, not when the column is declared. The two guises
 * of that mistake fail very differently, and only one of them is loud:
 *
 *  - **In hand-written SQL it throws.** `column "postalCode" does not exist`,
 *    at runtime, on the first request that reaches the query.
 *  - **In a catalogue query it matches NOTHING and the check passes.** A gate
 *    that asks `information_schema` about `postalCode`, or filters columns with
 *    `column.name.endsWith('_id')`, finds zero rows — and "no offenders" reads
 *    exactly like "no violations". A gate built that way protects nothing and
 *    reports success forever. Every catalogue-facing check in `__tests__/db/`
 *    goes through {@link sqlColumnName} for this reason, and each carries a
 *    vacuity floor asserting it found a population to check.
 *
 * ## The second guise, which costs DATA rather than a crash
 *
 * {@link qualified} is the answer to it. A drizzle column interpolated into a
 * `sql` template renders BARE (`"city_id"`) when its table is not in that
 * statement's `FROM` — which is precisely the case inside a correlated
 * subquery. `where ${addresses.cityId} = ${cities.id}` renders
 * `where "city_id" = "id"`: both names then resolve against the SUBQUERY's own
 * table, so the predicate compares two of ITS columns to each other, matches
 * nothing, and returns an empty result with **no error at all**.
 *
 * This has already shipped once in this ecosystem — in the sibling oxy-api port,
 * where follow counts read zero on every public profile until an assertion on
 * real rows caught it. Homiio has the same shape in at least three live places:
 * a city's `propertiesCount`, saved-listing counts, and the review aggregates.
 * Qualify every correlated reference, and treat "a correlated subquery returned
 * nothing" as a bug in the SQL until proven otherwise.
 */

export { DATABASE_CASING, qualified, sqlColumnName } from '@oxyhq/db';
