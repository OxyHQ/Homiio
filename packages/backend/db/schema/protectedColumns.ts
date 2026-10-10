/**
 * Columns That Must Not Reach a Client
 *
 * ## Why this exists
 *
 * **Drizzle has no per-query "hidden column" default.** `db.select().from(t)`
 * enumerates every column explicitly, so a secret column LEAKS on the first
 * query anyone writes. A column that stays out of responses only because no DTO
 * happens to list it is protected by luck: a bare `select()` returns the whole
 * ROW.
 *
 * Migration 0000 carried `countries`, `regions`, `cities`, `neighborhoods`,
 * `images` and `addresses`, and not one column in those six is a secret — so
 * the registry was legitimately empty, and the module existed so the mechanism
 * was in the repository BEFORE the first secret arrived rather than being
 * invented alongside the table that needed it.
 *
 * Migration 0001 brings the first one; migrations 0003-0007 bring the rest, so
 * the list the tracking issue predicted is now complete:
 *
 * | Column | Why |
 * |---|---|
 * | `properties.accommodation_details_wifi_password` | A credential for a real network |
 * | `profiles.personal_info_annual_income` | `settings.privacy.showIncome` defaults to FALSE |
 * | `leases.signatures_*_digital_signature` (2) | Signature material |
 * | `eviction_cases.contact_*` (5) | Organizer PII on a PUBLIC board |
 *
 * The tracking issue named `profiles.annual_income`; the column is
 * `personal_info_annual_income`, because `profiles.ts` keeps the wire path
 * minus the `personalProfile` wrapper. Recorded rather than silently corrected —
 * an entry naming a column that does not exist protects nothing, which is the
 * failure `__tests__/db/protectedColumns.test.ts` is built to catch.
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
 * `findImplicitWholeRowReads` from `@oxy.so/db/assert` is the scan that turns
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
} from '@oxy.so/db/assert';
import type { PgTable } from 'drizzle-orm/pg-core';
import { evictionCases } from './evictions';
import { leases } from './leases';
import { profiles } from './profiles';
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
  eviction_cases: [
    'contactPhone',
    'contactEmail',
    'contactTelegram',
    'contactWhatsapp',
    'contactInstructions',
    'locationExactLongitude',
    'locationExactLatitude',
    'locationExactAddress',
  ],
  leases: ['signaturesLandlordDigitalSignature', 'signaturesTenantDigitalSignature'],
  profiles: ['personalInfoAnnualIncome'],
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
      "table in the product. Leaving it out of every DTO's field list protects " +
      'it only by accident: a bare `select()` returns every column, so the ' +
      'accident stops protecting it the day someone writes one.',
  },
  {
    table: profiles,
    property: 'personalInfoAnnualIncome',
    reason:
      "A person's income, and the profile schema itself says it is private: " +
      "`settings.privacy.showIncome` defaults to FALSE, so the product's own " +
      'default is that nobody sees it. A field list in the profile serializer ' +
      'is not enough — a bare `select()` returns it. The ' +
      'privacy FLAG is a per-viewer decision the application still has to make; ' +
      'this registry only makes forgetting to ask a compile error rather than a ' +
      'disclosure.',
  },
  {
    table: leases,
    property: 'signaturesLandlordDigitalSignature',
    reason:
      'Signature material on a tenancy contract. It exists to prove who agreed ' +
      'to what, so a read path that hands it out hands out the proof — and ' +
      '`toLeaseDTO` omits it today only by not listing it. A path that ' +
      'genuinely needs it (rendering the signed PDF) names the column ' +
      'explicitly, which is greppable in a way a whole-row read is not.',
  },
  {
    table: leases,
    property: 'signaturesTenantDigitalSignature',
    reason:
      'The tenant half of the same fact, protected for the same reason. Listed ' +
      'separately rather than as a wildcard because the registry is what the ' +
      'TYPE-level exclusion is computed from, and a pattern cannot be.',
  },
  {
    table: evictionCases,
    property: 'contactPhone',
    reason:
      "The organizer's phone number on a PUBLIC board, and the one place in " +
      'this schema where a leak is a physical-safety problem rather than a ' +
      'privacy one: an eviction notice names a time and a place where a ' +
      "confrontation is expected, and the organizer is the person a landlord's " +
      'agent would most like to reach. The whole `contactInfo` block is served ' +
      'only to a viewer the controller decides may have it.',
  },
  {
    table: evictionCases,
    property: 'contactEmail',
    reason: 'Organizer PII on a public board — see `contact_phone`.',
  },
  {
    table: evictionCases,
    property: 'contactTelegram',
    reason: 'Organizer PII on a public board — see `contact_phone`.',
  },
  {
    table: evictionCases,
    property: 'contactWhatsapp',
    reason: 'Organizer PII on a public board — see `contact_phone`.',
  },
  {
    table: evictionCases,
    property: 'contactInstructions',
    reason:
      'Free text the organizer writes for people who are coming — routinely a ' +
      'meeting point, a door code or a name. Protected with the four contact ' +
      'handles because it is the same disclosure by a different route.',
  },
  {
    table: evictionCases,
    property: 'locationExactLongitude',
    reason:
      'Half of the coordinate of a home a bailiff is expected at, stored ONLY ' +
      'when the affected household itself authorised it (ADR 0003 §7.3). Every ' +
      'public read of this table goes through `publicColumns`, so the exclusion ' +
      'is what makes "the public response never contains the exact coordinate" ' +
      'a COMPILE error rather than a serializer nobody re-reads. The one path ' +
      'that may serve it — an unexpired, unrevoked access grant — names the ' +
      'column explicitly, which is greppable in a way a whole-row read is not.',
  },
  {
    table: evictionCases,
    property: 'locationExactLatitude',
    reason:
      'The other half of the same coordinate, protected for the same reason. ' +
      'Listed separately rather than as a wildcard because the registry is what ' +
      'the TYPE-level exclusion is computed from, and a pattern cannot be.',
  },
  {
    table: evictionCases,
    property: 'locationExactAddress',
    reason:
      'The street address, and the reason a coordinate rule alone is not ' +
      'enough: a reporter who types the full address into a text column has ' +
      'published it however precise the pin is. Stored only under the same ' +
      'household authorisation, and served only through the same grant.',
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
