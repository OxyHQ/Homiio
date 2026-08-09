/**
 * The protected-column registry.
 *
 * Both halves of it were empty in migration 0000 and that was the correct state
 * — `countries`, `regions`, `cities`, `neighborhoods`, `images` and `addresses`
 * hold no secret — so this file proved the MECHANISM worked before the first
 * secret arrived, rather than discovering it did not while porting
 * `profiles.annual_income`.
 *
 * Migration 0001 brings the first real entry,
 * `properties.accommodation_details_wifi_password`, and with it the assertion
 * that actually matters: **the exclusion is at the TYPE level.** A runtime
 * filter would only withhold the columns somebody remembered to filter; the
 * `describe` block at the bottom of this file fails `tsc` — not jest — if the
 * password becomes reachable from `publicColumns(properties)`.
 *
 * The two registries are written separately on purpose — one carries reasons for
 * a human, the other is the literal the TYPE SYSTEM reads — so the assertion
 * that they name the same set is what stops them drifting.
 */

import { getTableColumns, getTableName } from 'drizzle-orm';
import type { SelectedRow } from '@oxyhq/db';
import {
  PROTECTED_COLUMNS,
  PROTECTED_COLUMNS_BY_TABLE,
  publicColumns,
} from '../../db/schema/protectedColumns';
import { addresses, images, properties } from '../../db/schema';

describe('protected column registry', () => {
  it('agrees with the type-level registry about what is protected', () => {
    const fromReasons = PROTECTED_COLUMNS
      .map((entry) => `${getTableName(entry.table)}.${entry.property}`)
      .sort();
    const fromRegistry = Object.entries(
      PROTECTED_COLUMNS_BY_TABLE as Record<string, readonly string[]>,
    )
      .flatMap(([table, properties]) => properties.map((property) => `${table}.${property}`))
      .sort();
    expect(fromReasons).toEqual(fromRegistry);
  });

  it('gives every protected column a reason', () => {
    const unexplained = PROTECTED_COLUMNS
      .filter((entry) => entry.reason.trim().length < 20)
      .map((entry) => `${getTableName(entry.table)}.${entry.property}`);
    expect(unexplained).toEqual([]);
  });

  it('names a real property on its table, for every entry', () => {
    // A registry entry naming a column that does not exist protects nothing, and
    // nothing else would report it — `Omit` over a property that is not there is
    // a no-op, so the type-level exclusion would silently do nothing too.
    const missing = PROTECTED_COLUMNS
      .filter((entry) => !(entry.property in getTableColumns(entry.table)))
      .map((entry) => `${getTableName(entry.table)}.${entry.property}`);
    expect(missing).toEqual([]);
  });
});

/**
 * The row shape a serializer sees when it reads a listing the sanctioned way.
 *
 * This is the type, not a value: `SelectedRow` turns a drizzle selection object
 * into the row it produces, honouring nullability. Everything below is checked
 * by `tsc`, and jest only reports what `tsc` already accepted.
 */
const PUBLIC_PROPERTY_COLUMNS = publicColumns(properties);
type PublicPropertyRow = SelectedRow<typeof PUBLIC_PROPERTY_COLUMNS>;

/**
 * **A COMPILE-TIME assertion.** If `accommodationDetailsWifiPassword` is
 * reachable on the public row type, the conditional resolves to `never`,
 * `= true` is not assignable to it, and `bun run typecheck` fails with the
 * property named. A serializer that reads the password therefore cannot
 * compile — which is the whole point of doing this at the type level rather
 * than filtering at runtime, where it would only stop the columns somebody
 * remembered.
 */
const wifiPasswordIsUnreachable: 'accommodationDetailsWifiPassword' extends keyof PublicPropertyRow
  ? never
  : true = true;

/**
 * The vacuity floor for the assertion above, and it is not theoretical:
 * `@oxyhq/db`'s own documentation records that widening the registry from a
 * literal to `ProtectedColumnRegistry` collapses `PublicColumns` to `{}` — at
 * which point EVERY column becomes type-inaccessible and the check above passes
 * while protecting nothing. This pins the other side.
 */
const descriptionIsStillReachable: 'description' extends keyof PublicPropertyRow ? true : never =
  true;

describe('the wifi password is excluded at the TYPE level', () => {
  it('is unreachable on the public row type', () => {
    // `tsc` has already decided this. The runtime assertion exists so the
    // constants above are not dead code a linter would remove, taking the
    // compile-time check with them.
    expect(wifiPasswordIsUnreachable).toBe(true);
    expect(descriptionIsStillReachable).toBe(true);
  });

  it('is absent from the selection at runtime too', () => {
    const keys = Object.keys(PUBLIC_PROPERTY_COLUMNS);
    expect(keys).not.toContain('accommodationDetailsWifiPassword');
    // Vacuity floor: `properties` has 135 columns, so a selection this size is
    // evidence the exclusion removed one column rather than all of them.
    expect(keys.length).toBeGreaterThan(120);
  });

  it('is still a real column on the table, reachable when named explicitly', () => {
    // Opting in is deliberately unhelped, not impossible: a path that
    // legitimately needs the password names it, which reads differently from an
    // ordinary select and stays greppable.
    expect('accommodationDetailsWifiPassword' in getTableColumns(properties)).toBe(true);
  });
});

describe('publicColumns', () => {
  it('returns every column of a table with nothing protected', () => {
    // The property that must hold while the registry is empty, and the one that
    // breaks catastrophically if `PROTECTED_COLUMNS_BY_TABLE` is ever widened
    // from a literal to `ProtectedColumnRegistry`: the value type becomes
    // `string`, `Omit<X, string>` removes EVERYTHING, and every selection built
    // this way silently becomes empty.
    expect(Object.keys(publicColumns(addresses)).sort()).toEqual(
      Object.keys(getTableColumns(addresses)).sort(),
    );
    expect(Object.keys(publicColumns(images)).sort()).toEqual(
      Object.keys(getTableColumns(images)).sort(),
    );
  });

  it('returns a non-empty selection', () => {
    // Vacuity floor for the assertion above: two empty objects are equal, so
    // without this a totally broken `publicColumns` would satisfy it.
    expect(Object.keys(publicColumns(addresses)).length).toBeGreaterThan(20);
  });
});
