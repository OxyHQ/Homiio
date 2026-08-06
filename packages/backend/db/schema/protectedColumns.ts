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
 * The registry is empty because migration 0000 carries `countries`, `regions`,
 * `cities`, `neighborhoods`, `images` and `addresses`, and not one column in
 * those six is a secret. That is the correct state, not an omission — and the
 * module exists now so the mechanism is in the repository BEFORE the first
 * secret arrives, rather than being invented while porting the table that needs
 * it. The columns already known to belong here, from the tracking issue:
 *
 * | Column | Batch | Why |
 * |---|---|---|
 * | `properties.accommodation_wifi_password` | 3 | A credential for a real network |
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
 * EMPTY as of migration 0000. See the module docblock for the four groups of
 * columns that land here in batches 3, 5, 7 and 8.
 */
export const PROTECTED_COLUMNS_BY_TABLE = {} as const satisfies ProtectedColumnRegistry;

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
export const PROTECTED_COLUMNS: readonly ProtectedColumn[] = [];

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
