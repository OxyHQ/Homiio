/**
 * Migration 0030 — folding a city that failed to geocode a province.
 *
 * Like `cityDuplicateMerge.test.ts`, this runs the real file from `drizzle/`,
 * statement by statement, inside a transaction it always rolls back. 0030
 * changes no schema, so unlike 0029 there is no index to put back first — the
 * fixture is just rows, and `cities_region_slug_key` permits them because the
 * whole point is that they sit in DIFFERENT regions.
 *
 * ## The fixture is three cases, and two of them must NOT move
 *
 * The rule is "fold into the twin, but only when the twin is unique", so a test
 * that only proves folding measures half of it. The restraint is the half that
 * protects ADR 0001 §1.3's measured `Santiago` — two genuinely different cities
 * that both landed in the placeholder bucket — and a migration that folded
 * those would be the homonym bug wearing a repair's clothes.
 *
 *   hamburg   one real twin    -> folds
 *   santiago  TWO real twins   -> stays, still ambiguous, on purpose
 *   nowhere   no twin at all   -> stays, nothing to fold into
 *
 * All three are seeded in the same country so the query cannot pass by
 * accidentally scoping to one.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { addresses, cities, neighborhoods } from '../../db/schema';

const MIGRATION = path.join(__dirname, '..', '..', 'drizzle', '0030_placeholder_region_merge.sql');

let db: Database;

const SUITE = uuidv7().slice(-12);
const countryId = `c-${SUITE}`;

beforeAll(async () => {
  db = await connectPostgres();
  await db.execute(
    sql`insert into countries (id, name, code) values (${countryId}, ${`Bucketland ${SUITE}`}, ${`B${SUITE.slice(-1)}`})`,
  );
});

afterAll(async () => {
  await db.execute(sql`delete from countries where id = ${countryId}`);
  await closePostgres();
});

/** Every statement of the migration, in file order, with its comments stripped. */
function migrationStatements(): string[] {
  return fs
    .readFileSync(MIGRATION, 'utf8')
    .split('--> statement-breakpoint')
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((chunk) => chunk.length > 0);
}

interface Outcome {
  readonly keptHamburgId: string;
  readonly shadowHamburgGone: boolean;
  readonly shadowSantiagoSurvives: boolean;
  readonly shadowOrphanSurvives: boolean;
  readonly hamburgProperties: number;
  readonly hamburgTimezone: string | null;
  readonly addressCityId: string | null;
  readonly addressRegionId: string | null;
  readonly keptRegionId: string;
  readonly neighborhoodCityId: string | null;
}

/** A sentinel: thrown to roll the fixture back, never a failure. */
class Rollback extends Error {}

async function runMerge(): Promise<Outcome> {
  const statements = migrationStatements();
  let captured: Outcome | undefined;

  const region = async (tx: Database, id: string, name: string): Promise<string> => {
    await tx.execute(sql`insert into regions (id, country_id, name) values (${id}, ${countryId}, ${name})`);
    return id;
  };
  const city = async (
    tx: Database,
    id: string,
    regionId: string,
    name: string,
    props: number,
    timezone: string | null,
  ): Promise<string> => {
    await tx.execute(sql`
      insert into cities (id, country_id, region_id, name, properties_count, timezone)
      values (${id}, ${countryId}, ${regionId}, ${name}, ${props}, ${timezone})`);
    return id;
  };

  try {
    await db.transaction(async (tx) => {
      // The placeholder bucket, named exactly as `addressService` names it.
      const bucket = await region(tx as Database, `r-unknown-${SUITE}`, 'Unknown');
      const realHamburg = await region(tx as Database, `r-hh-${SUITE}`, `Hamburg ${SUITE}`);
      const chileA = await region(tx as Database, `r-rm-${SUITE}`, `Metropolitana ${SUITE}`);
      const chileB = await region(tx as Database, `r-bio-${SUITE}`, `Biobio ${SUITE}`);

      // Folds: exactly one real twin. The twin carries the listings and lacks a
      // timezone, so both halves of the carry-forward are measured.
      const keptHamburg = await city(tx as Database, `ci-hh-${SUITE}`, realHamburg, 'Hamburg', 4, null);
      const shadowHamburg = await city(tx as Database, `ci-hh-shadow-${SUITE}`, bucket, 'Hamburg', 3, 'Europe/Berlin');

      // Stays: TWO real twins, so which one it is remains unknown.
      await city(tx as Database, `ci-sa-a-${SUITE}`, chileA, 'Santiago', 1, null);
      await city(tx as Database, `ci-sa-b-${SUITE}`, chileB, 'Santiago', 1, null);
      const shadowSantiago = await city(tx as Database, `ci-sa-shadow-${SUITE}`, bucket, 'Santiago', 0, null);

      // Stays: nothing to fold into.
      const shadowOrphan = await city(tx as Database, `ci-orphan-${SUITE}`, bucket, `Nowhere ${SUITE}`, 0, null);

      const neighborhoodId = `n-${SUITE}`;
      await tx.insert(neighborhoods).values({ id: neighborhoodId, cityId: shadowHamburg, name: `Altona ${SUITE}` });

      const addressId = `a-${SUITE}`;
      await tx.insert(addresses).values({
        id: addressId,
        countryId,
        // BOTH parents point at the bucket, which is the state the fallback
        // leaves behind and the state the migration has to repair together.
        regionId: bucket,
        cityId: shadowHamburg,
        neighborhoodId,
        countryCode: 'DE',
        street: `Reeperbahn ${SUITE}`,
        postalCode: '20359',
        number: '1',
        longitude: 9.9578,
        latitude: 53.5503,
      });

      for (const statement of statements) {
        await tx.execute(sql.raw(statement));
      }

      const survivors = await tx
        .select({ id: cities.id, props: cities.propertiesCount, tz: cities.timezone, regionId: cities.regionId })
        .from(cities)
        .where(eq(cities.countryId, countryId));
      const kept = survivors.find((row) => row.id === keptHamburg);
      const address = await tx
        .select({ cityId: addresses.cityId, regionId: addresses.regionId })
        .from(addresses)
        .where(eq(addresses.id, addressId));
      const hood = await tx
        .select({ cityId: neighborhoods.cityId })
        .from(neighborhoods)
        .where(eq(neighborhoods.id, neighborhoodId));

      captured = {
        keptHamburgId: keptHamburg,
        shadowHamburgGone: !survivors.some((row) => row.id === shadowHamburg),
        shadowSantiagoSurvives: survivors.some((row) => row.id === shadowSantiago),
        shadowOrphanSurvives: survivors.some((row) => row.id === shadowOrphan),
        hamburgProperties: kept?.props ?? -1,
        hamburgTimezone: kept?.tz ?? null,
        addressCityId: address[0]?.cityId ?? null,
        addressRegionId: address[0]?.regionId ?? null,
        keptRegionId: realHamburg,
        neighborhoodCityId: hood[0]?.cityId ?? null,
      };

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  if (!captured) throw new Error('the merge produced no outcome');
  return captured;
}

describe('migration 0030 folds a bucketed city into the one place it can only be', () => {
  let outcome: Outcome;

  beforeAll(async () => {
    outcome = await runMerge();
  }, 60_000);

  it('deletes the placeholder row when the real twin is unique', () => {
    expect(outcome.shadowHamburgGone).toBe(true);
  });

  it('KEEPS the placeholder row when two real cities share the slug', () => {
    // ADR 0001 §1.3's `Santiago`. Folding this one would pick a city at random
    // and call it a repair.
    expect(outcome.shadowSantiagoSurvives).toBe(true);
  });

  it('keeps a bucketed city that has no twin at all', () => {
    expect(outcome.shadowOrphanSurvives).toBe(true);
  });

  it('sums the listing counts onto the twin', () => {
    expect(outcome.hamburgProperties).toBe(7);
  });

  it('takes an optional field the twin lacked from the row it deleted', () => {
    expect(outcome.hamburgTimezone).toBe('Europe/Berlin');
  });

  it('moves BOTH of an address’s parents, so they cannot contradict', () => {
    expect(outcome.addressCityId).toBe(outcome.keptHamburgId);
    expect(outcome.addressRegionId).toBe(outcome.keptRegionId);
  });

  it('moves the neighbourhood with its city', () => {
    expect(outcome.neighborhoodCityId).toBe(outcome.keptHamburgId);
  });
});
