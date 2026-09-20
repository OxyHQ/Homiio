/**
 * Migration 0029 — the city merge — run as the bytes that will run in
 * production.
 *
 * The migration executes exactly once against the real database, so the only
 * useful test of it is one that executes the SAME FILE. This suite reads
 * `drizzle/0029_city_slug_identity.sql`, splits it on drizzle's statement
 * breakpoints and runs it against a fixture built to make every branch
 * DISAGREE with doing nothing:
 *
 *  - the survivor is NOT the row with the nicest name, so "kept the right row"
 *    and "kept the right name" are two different assertions and a merge that
 *    got one right can still fail the other;
 *  - one neighbourhood collides case-insensitively with one under the survivor
 *    (it must be folded away, taking its addresses and reviews with it) and one
 *    does not (it must simply move), so a fixture-wide "everything ended up
 *    under the survivor" count cannot pass for both;
 *  - the address, the review and the neighbourhood each hang off a DIFFERENT
 *    losing city, so the three repointing statements are measured separately
 *    rather than by one that happens to cover them all.
 *
 * ## It restores the PRE-migration schema first, and that is the whole test
 *
 * The harness hands every worker a database with all migrations applied, so at
 * test time 0029 has already run: `cities_region_slug_key` exists and
 * `cities_region_name_key` does not. Running the file against THAT is running
 * it against a schema strictly weaker than the one it meets in production, and
 * the first version of this suite did exactly that — it dropped the slug index,
 * never recreated the name index, and went green on a migration that failed in
 * production with `23505` on `(region_id, name)=(…, Salford)`.
 *
 * The rename is what collides: the survivor takes the group's mixed-case
 * spelling, which belongs to a row that has not been deleted yet, so `SALFORD`
 * becomes `Salford` while the other `Salford` is still there. Only the old
 * case-sensitive index can see that, and only a test that has that index can
 * catch it.
 *
 * So the transaction puts the schema back the way the migration expects to find
 * it — slug index out, name index in — and then runs EVERY statement of the
 * file, including its own `DROP INDEX`. Nothing is skipped and nothing is
 * simulated.
 *
 * Everything runs inside ONE transaction that is ALWAYS rolled back: the schema
 * comes back and the fixture rows never commit. The obvious objection is the
 * `DROP INDEX`'s ACCESS EXCLUSIVE lock on `cities`, held until that rollback.
 * It costs nothing here, and the reason is worth stating rather than assumed:
 * `jest.setup.ts` gives every worker its own throwaway database, so the only
 * session that can want this table is this one. A suite that shared a database
 * with its neighbours could not do this.
 *
 * Facts are collected inside the transaction and asserted OUTSIDE it, so a
 * failed `expect` cannot be mistaken for the sentinel that triggers the
 * rollback.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { addresses, cities, neighborhoods, reviews } from '../../db/schema';
import { insertReview } from '../../db/reviews/reviewWrites';

const MIGRATION = path.join(__dirname, '..', '..', 'drizzle', '0029_city_slug_identity.sql');

let db: Database;

const SUITE = uuidv7().slice(-12);
const countryId = `c-${SUITE}`;
const regionId = `r-${SUITE}`;

beforeAll(async () => {
  db = await connectPostgres();
  await db.execute(
    sql`insert into countries (id, name, code) values (${countryId}, ${`Slugland ${SUITE}`}, ${`S${SUITE.slice(-1)}`})`,
  );
  await db.execute(
    sql`insert into regions (id, country_id, name) values (${regionId}, ${countryId}, ${`Slugregion ${SUITE}`})`,
  );
});

afterAll(async () => {
  await db.execute(sql`delete from regions where id = ${regionId}`);
  await db.execute(sql`delete from countries where id = ${countryId}`);
  await closePostgres();
});

/** Every statement of the migration, in file order, with its comments stripped. */
function migrationStatements(): string[] {
  const raw = fs.readFileSync(MIGRATION, 'utf8');
  return raw
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

interface MergeOutcome {
  readonly survivorId: string;
  readonly losingIds: readonly string[];
  readonly remainingCityIds: readonly string[];
  readonly survivorName: string;
  readonly survivorProperties: number;
  readonly survivorTimezone: string | null;
  readonly survivorLatitude: number | null;
  readonly survivorLongitude: number | null;
  readonly keptNeighborhoodId: string;
  readonly collidingNeighborhoodExists: boolean;
  readonly movedNeighborhoodCityId: string | null;
  readonly addressCityId: string | null;
  readonly addressNeighborhoodId: string | null;
  readonly reviewCityId: string | null;
  readonly reviewNeighborhoodId: string | null;
  readonly uniqueIndexRestored: boolean;
  readonly nameIndexDropped: boolean;
}

/** A sentinel: thrown to roll the fixture back, never a failure. */
class Rollback extends Error {}

async function runMerge(): Promise<MergeOutcome> {
  const statements = migrationStatements();
  let captured: MergeOutcome | undefined;

  try {
    await db.transaction(async (tx) => {
      // The schema as the migration expects to FIND it: the index it creates
      // does not exist yet, and the case-sensitive one it replaces still does.
      await tx.execute(sql`drop index cities_region_slug_key`);
      await tx.execute(sql`create unique index cities_region_name_key on cities (region_id, name)`);

      // The survivor is the row holding the listings, and it is SHOUTED. The
      // mixed-case spelling belongs to a row that is about to be deleted, so
      // "kept the right row" and "kept the right name" cannot both be satisfied
      // by copying one row wholesale.
      const survivorId = `city-upper-${SUITE}`;
      const prettyId = `city-pretty-${SUITE}`;
      const lowerId = `city-lower-${SUITE}`;
      await tx.execute(sql`
        insert into cities (id, country_id, region_id, name, properties_count, timezone, latitude, longitude)
        values
          (${survivorId}, ${countryId}, ${regionId}, ${'BARCELONA'}, 3, null, null, null),
          (${prettyId}, ${countryId}, ${regionId}, ${'Barcelona'}, 2, ${'Europe/Madrid'}, 41.38, 2.17),
          (${lowerId}, ${countryId}, ${regionId}, ${'barcelona'}, 1, null, null, null)
      `);

      const keptNeighborhoodId = `n-kept-${SUITE}`;
      const collidingNeighborhoodId = `n-collide-${SUITE}`;
      const movingNeighborhoodId = `n-move-${SUITE}`;
      await tx.insert(neighborhoods).values([
        { id: keptNeighborhoodId, cityId: survivorId, name: 'Eixample' },
        { id: collidingNeighborhoodId, cityId: prettyId, name: 'EIXAMPLE' },
        { id: movingNeighborhoodId, cityId: prettyId, name: 'Gràcia' },
      ]);

      // A STREET row and the BUILDING row on it: `reviews.street_level_id` is
      // NOT NULL, so a review needs both. Both sit under a losing city.
      const streetAddressId = `a-street-${SUITE}`;
      await tx.insert(addresses).values({
        id: streetAddressId,
        countryId,
        regionId,
        cityId: lowerId,
        neighborhoodId: collidingNeighborhoodId,
        countryCode: 'ES',
        street: `Carrer Slug ${SUITE}`,
        postalCode: '08013',
        longitude: 2.17,
        latitude: 41.39,
      });

      const addressId = `a-${SUITE}`;
      await tx.insert(addresses).values({
        id: addressId,
        countryId,
        regionId,
        // The LOWER-cased city, so the address proves its own repointing
        // statement rather than riding along with the neighbourhood's.
        cityId: lowerId,
        neighborhoodId: collidingNeighborhoodId,
        countryCode: 'ES',
        street: `Carrer Slug ${SUITE}`,
        postalCode: '08013',
        number: '7',
        longitude: 2.17,
        latitude: 41.39,
      });

      const review = await insertReview(tx, {
        addressId,
        addressLevel: 'BUILDING',
        streetLevelId: streetAddressId,
        buildingLevelId: addressId,
        unitLevelId: null,
        cityId: prettyId,
        neighborhoodId: collidingNeighborhoodId,
        agencyId: null,
        oxyUserId: `oxy-slug-${SUITE}`,
        title: 'A perfectly reasonable title',
        price: 1000,
        currency: 'EUR',
        livedFrom: new Date('2020-01-01T00:00:00.000Z'),
        livedTo: new Date('2021-01-01T00:00:00.000Z'),
        rating: 4,
        recommendation: true,
        opinion: 'Lived here a while — a reasonable opinion string.',
        depositReturned: null,
        moderationStatus: 'active',
      });

      for (const statement of statements) {
        await tx.execute(sql.raw(statement));
      }

      const remaining = await tx
        .select({ id: cities.id, name: cities.name, propertiesCount: cities.propertiesCount,
                  timezone: cities.timezone, latitude: cities.latitude, longitude: cities.longitude })
        .from(cities)
        .where(eq(cities.regionId, regionId));
      const survivor = remaining.find((row) => row.id === survivorId);
      const colliding = await tx
        .select({ id: neighborhoods.id })
        .from(neighborhoods)
        .where(eq(neighborhoods.id, collidingNeighborhoodId));
      const moved = await tx
        .select({ cityId: neighborhoods.cityId })
        .from(neighborhoods)
        .where(eq(neighborhoods.id, movingNeighborhoodId));
      const address = await tx
        .select({ cityId: addresses.cityId, neighborhoodId: addresses.neighborhoodId })
        .from(addresses)
        .where(eq(addresses.id, addressId));
      const reviewRow = await tx
        .select({ cityId: reviews.cityId, neighborhoodId: reviews.neighborhoodId })
        .from(reviews)
        .where(eq(reviews.id, review.id));

      // The index the migration creates is created from the FILE, above. That
      // it exists now is the migration's own last statement having succeeded,
      // which it could not have done with a duplicate slug left in the table.
      const restored = await tx.execute(sql`
        select 1 from pg_indexes
        where tablename = 'cities' and indexname = 'cities_region_slug_key'
      `);
      const nameIndex = await tx.execute(sql`
        select 1 from pg_indexes
        where tablename = 'cities' and indexname = 'cities_region_name_key'
      `);

      captured = {
        survivorId,
        losingIds: [prettyId, lowerId],
        remainingCityIds: remaining.map((row) => row.id),
        survivorName: survivor?.name ?? '',
        survivorProperties: survivor?.propertiesCount ?? -1,
        survivorTimezone: survivor?.timezone ?? null,
        survivorLatitude: survivor?.latitude ?? null,
        survivorLongitude: survivor?.longitude ?? null,
        keptNeighborhoodId,
        collidingNeighborhoodExists: colliding.length > 0,
        movedNeighborhoodCityId: moved[0]?.cityId ?? null,
        addressCityId: address[0]?.cityId ?? null,
        addressNeighborhoodId: address[0]?.neighborhoodId ?? null,
        reviewCityId: reviewRow[0]?.cityId ?? null,
        reviewNeighborhoodId: reviewRow[0]?.neighborhoodId ?? null,
        uniqueIndexRestored: restored.length > 0,
        nameIndexDropped: nameIndex.length === 0,
      };

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  if (!captured) throw new Error('the merge produced no outcome');
  return captured;
}

describe('migration 0029 folds duplicate cities onto one row per region and slug', () => {
  let outcome: MergeOutcome;

  beforeAll(async () => {
    outcome = await runMerge();
  }, 60_000);

  it('drops the case-sensitive index it replaces', () => {
    expect(outcome.nameIndexDropped).toBe(true);
  });

  it('leaves one city, and it is the one that held the listings', () => {
    expect(outcome.remainingCityIds).toEqual([outcome.survivorId]);
  });

  it('gives it the mixed-case name, which belonged to a row it deleted', () => {
    expect(outcome.survivorName).toBe('Barcelona');
  });

  it('sums the listing counts rather than keeping the survivor’s own', () => {
    expect(outcome.survivorProperties).toBe(6);
  });

  it('takes an optional field the survivor lacked from a row it deleted', () => {
    expect(outcome.survivorTimezone).toBe('Europe/Madrid');
    expect(outcome.survivorLatitude).toBeCloseTo(41.38, 5);
    expect(outcome.survivorLongitude).toBeCloseTo(2.17, 5);
  });

  it('folds a case-colliding neighbourhood away instead of moving it', () => {
    expect(outcome.collidingNeighborhoodExists).toBe(false);
    expect(outcome.addressNeighborhoodId).toBe(outcome.keptNeighborhoodId);
    expect(outcome.reviewNeighborhoodId).toBe(outcome.keptNeighborhoodId);
  });

  it('moves a neighbourhood that collides with nothing', () => {
    expect(outcome.movedNeighborhoodCityId).toBe(outcome.survivorId);
  });

  it('repoints the address and the review off their own losing cities', () => {
    expect(outcome.addressCityId).toBe(outcome.survivorId);
    expect(outcome.reviewCityId).toBe(outcome.survivorId);
    expect(outcome.losingIds).not.toContain(outcome.addressCityId);
  });

  it('can then create the unique index the duplicates made impossible', () => {
    expect(outcome.uniqueIndexRestored).toBe(true);
  });
});
