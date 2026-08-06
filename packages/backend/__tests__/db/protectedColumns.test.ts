/**
 * The protected-column registry.
 *
 * Both halves of it are empty in migration 0000, and that is the correct state —
 * `countries`, `regions`, `cities`, `neighborhoods`, `images` and `addresses`
 * hold no secret. So this file's job today is narrow but real: prove the
 * MECHANISM works before the first secret arrives, rather than discovering it
 * does not while porting `profiles.annual_income`.
 *
 * The two registries are written separately on purpose — one carries reasons for
 * a human, the other is the literal the TYPE SYSTEM reads — so the assertion
 * that they name the same set is what stops them drifting.
 */

import { getTableColumns, getTableName } from 'drizzle-orm';
import {
  PROTECTED_COLUMNS,
  PROTECTED_COLUMNS_BY_TABLE,
  publicColumns,
} from '../../db/schema/protectedColumns';
import { addresses, images } from '../../db/schema';

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
