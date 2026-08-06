/**
 * Columns That Must Not Reach a Client
 *
 * ## Why this exists while it is empty
 *
 * Mongoose has `select: false`, and Homiio DOES use it — `EvictionCase.attendees`
 * is declared that way today. Mongoose therefore left those fields out of a
 * document unless a query asked for them, which is a per-QUERY default.
 *
 * **Drizzle has no such default.** `db.select().from(t)` enumerates every column
 * explicitly, so a naive port LEAKS exactly what `select: false` was hiding, and
 * it leaks it on the first query anyone writes. The same is true of the much
 * larger set of columns that were never `select: false` at all and stayed out of
 * responses only because no DTO happened to list them — Homiio has **153
 * `.lean()` call sites**, and a `.lean()` read returns the whole document already;
 * their ported form is a bare `select()` that returns the whole ROW.
 *
 * Migration 0000 carried `countries`, `regions`, `cities`, `neighborhoods`,
 * `images` and `addresses`, and not one column in those six is a secret — so
 * the registry was legitimately empty, and the module existed so the mechanism
 * was in the repository BEFORE the first secret arrived rather than being
 * invented while porting the table that needed it.
 *
 * Migration 0001 brings the first one. The columns known to belong here, from
 * the tracking issue:
 *
 * | Column | Batch | Why |
 * |---|---|---|
 * | `properties.accommodation_details_wifi_password` | 3 | A credential for a real network — **landed** |
 * | `profiles.annual_income` | 5 | `privacy.showIncome` defaults to FALSE |
 * | `leases.*_digital_signature` | 7 | Signature material |
 * | `eviction_cases.contact_*` (5 columns) | 8 | Organizer PII on a PUBLIC board |
 *
 * ## The mechanism, and why part 3 is the part a convention could not give you
 *
 * 1. **The registry is data** (`PROTECTED_COLUMNS`), one entry per column with
 *    its reason — the same shape as `deferredForeignKeys.ts`, for the same
 *    reason: a rule written only in a comment is a rule nothing checks.
 * 2. **`publicColumns(table)` is the sanctioned read.**
 * 3. **The exclusion is at the TYPE level.** `publicColumns` returns a selection
 *    whose row type has no `annualIncome` property AT ALL, so a serializer that
 *    reads one fails `tsc` rather than shipping it. A runtime filter would only
 *    stop the columns somebody remembered to filter.
 * 4. **Opting in is explicit and greppable.** A path that genuinely needs the
 *    column names it: `db.select({ id: leases.id, signature: leases.tenantDigitalSignature })`.
 *    There is deliberately no helper for that — the whole point is that it reads
 *    differently from an ordinary select.
 *
 * `findImplicitWholeRowReads` from `@oxyhq/db/assert` is the scan that turns
 * this into a gate: it walks the source tree for the two shapes that return
 * every column IMPLICITLY — a bare `select()` and the relational
 * `db.query.<table>` API — against any table named here, and reports the
 * offending `file:line`.
 *
 * `eviction_cases.attendees` is the one entry that will NOT be a protected
 * column: it becomes a CHILD TABLE (`eviction_case_attendees`) instead, which is
 * strictly stronger. You cannot select a column you forgot to exclude if getting
 * the data requires writing a join.
 */

import {
  type ProtectedColumnRegistry,
  publicColumns as excludeProtectedColumns,
} from '@oxyhq/db/assert';
import type { PgTable } from 'drizzle-orm/pg-core';
import { properties } from './properties';

/**
 * Table SQL name → the TypeScript property names of its protected columns.
 *
 * **This literal is the type-level authority and must stay a literal.** The
 * exclusion is computed as `Omit<columns, Registry[tableName][number]>`, so
 * widening the annotation to `ProtectedColumnRegistry` would make the value type
 * `string` — and `Omit<X, string>` removes EVERY property, silently turning
 * every `publicColumns()` call into an empty selection. `as const satisfies`
 * gives the literal type AND the shape check; a plain type annotation gives only
 * the second and breaks the first.
 *
 * Keyed by the SQL TABLE name and valued by TypeScript PROPERTY names — the two
 * sides genuinely differ, and mixing them up produces an `Omit` over a key that
 * does not exist, which is a silent no-op rather than an error.
 */
export const PROTECTED_COLUMNS_BY_TABLE = {
  properties: ['accommodationDetailsWifiPassword'],
} as const satisfies ProtectedColumnRegistry;

/** One protected column, with the reason it is protected. */
export interface ProtectedColumn {
  readonly table: PgTable;
  /** The TypeScript property name on the table — what a drizzle selection is keyed by. */
  readonly property: string;
  readonly reason: string;
}

/**
 * The reasons, one entry per protected column.
 *
 * Kept alongside {@link PROTECTED_COLUMNS_BY_TABLE} rather than derived from it
 * because the two answer different questions — this one is for a human deciding
 * whether a column belongs, that one is what the type system reads — and
 * `__tests__/db/protectedColumns.test.ts` asserts they name the same set, so
 * they cannot drift.
 */
export const PROTECTED_COLUMNS: readonly ProtectedColumn[] = [
  {
    table: properties,
    property: 'accommodationDetailsWifiPassword',
    reason:
      'A credential for a real network, stored in plaintext on the most-read ' +
      'table in the product. Mongoose hid it BY ACCIDENT, not by design — it ' +
      'is not `select: false`; it simply never appeared in any DTO\'s field ' +
      'list, so every one of this package\'s `.lean()` reads carried it and ' +
      'nothing shipped it only because no serializer happened to look. Under ' +
      'drizzle the equivalent read is a bare `select()`, which returns every ' +
      'column, so the accident stops protecting it the day someone writes one.',
  },
];

/**
 * The columns of `table` that are safe to hand to a client, as a drizzle
 * selection object.
 *
 * `db.select(publicColumns(evictionCases)).from(evictionCases)` — the returned
 * row type has no protected property at all, so reading one is a compile error
 * rather than a runtime leak.
 */
export function publicColumns<T extends PgTable>(table: T) {
  return excludeProtectedColumns(table, PROTECTED_COLUMNS_BY_TABLE);
}
