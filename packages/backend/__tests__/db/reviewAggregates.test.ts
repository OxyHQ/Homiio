/**
 * The seven review rollups, against a REAL Postgres server.
 *
 * These were Mongo aggregation pipelines, and an aggregation is exactly the kind
 * of code a mocked driver cannot test at all: a mock returns whatever the test
 * told it to, so the `GROUP BY`, the join, the `filter (where …)` and the
 * `count(distinct …)` would all be asserted against the fixture rather than
 * against the server.
 *
 * ## Every fixture here is scoped to ids this file minted
 *
 * The worker's database persists for the whole run and other files write reviews
 * into it, so a rollup that answers GLOBALLY (`getCitiesWithReviews`) is asserted
 * by finding this file's own city in the result rather than by counting rows. A
 * length assertion there would pass or fail on which files jest happened to
 * schedule onto this worker.
 */

import { sql } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';

import {
  closePostgres,
  connectPostgres,
  getPostgresClient,
  type Database,
} from '../../db/postgres';
import { insertReview } from '../../db/reviews/reviewWrites';
import {
  countBuildingsOnStreet,
  getAgencyStats,
  getBuildingSummaries,
  getCitiesWithReviews,
  getNeighborhoodSummaries,
  summarizeBuilding,
  summarizeBuildingOfUnit,
  summarizeStreet,
  summarizeUnit,
} from '../../db/reviews/reviewAggregates';
import { reviews } from '../../db/schema';
import {
  seedAddress,
  seedAgency,
  seedGeoChain,
  seedNeighborhood,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

let db: Database;
let chain: GeoChain;
let neighborhoodId: string;
let streetId: string;
let buildingId: string;
let otherBuildingId: string;
let unitAId: string;
let unitBId: string;

function unique(prefix: string): string {
  return `${prefix}-${uuidv7()}`;
}

interface ReviewSeed {
  addressId: string;
  addressLevel?: 'BUILDING' | 'UNIT';
  unitLevelId?: string | null;
  buildingLevelId?: string;
  rating?: number;
  recommendation?: boolean;
  depositReturned?: 'full' | 'partial' | 'no';
  agencyId?: string;
  moderationStatus?: 'active' | 'under_review' | 'removed';
  neighborhoodId?: string | null;
  cityId?: string | null;
}

async function seedReview(seed: ReviewSeed): Promise<string> {
  const row = await insertReview(db, {
    addressId: seed.addressId,
    addressLevel: seed.addressLevel ?? 'BUILDING',
    streetLevelId: streetId,
    buildingLevelId: seed.buildingLevelId ?? buildingId,
    unitLevelId: seed.unitLevelId ?? null,
    cityId: seed.cityId === undefined ? chain.cityId : seed.cityId,
    neighborhoodId: seed.neighborhoodId === undefined ? neighborhoodId : seed.neighborhoodId,
    agencyId: seed.agencyId ?? null,
    oxyUserId: unique('oxy-agg'),
    title: 'A perfectly reasonable title',
    price: 1000,
    currency: 'EUR',
    livedFrom: new Date('2020-01-01T00:00:00.000Z'),
    livedTo: new Date('2021-01-01T00:00:00.000Z'),
    rating: seed.rating ?? 4,
    recommendation: seed.recommendation ?? true,
    opinion: 'Lived here a while — a reasonable opinion string.',
    depositReturned: seed.depositReturned ?? null,
    moderationStatus: seed.moderationStatus ?? 'active',
  });
  return row.id;
}

beforeAll(async () => {
  db = await connectPostgres();
  chain = await seedGeoChain({ countryCode: 'RA', cityName: `Aggregateville ${uuidv7()}` });
  neighborhoodId = await seedNeighborhood({ cityId: chain.cityId, name: `Eixample ${uuidv7()}` });
  const street = `Carrer Aggregate ${uuidv7()}`;
  streetId = await seedAddress({ chain, street, neighborhoodId });
  buildingId = await seedAddress({ chain, street, number: '10', neighborhoodId });
  otherBuildingId = await seedAddress({ chain, street, number: '20', neighborhoodId });
  unitAId = await seedAddress({ chain, street, number: '10', floor: '1', neighborhoodId });
  unitBId = await seedAddress({ chain, street, number: '10', floor: '2', neighborhoodId });
});

afterAll(async () => {
  await closePostgres();
});

describe('the street → building → unit rollups', () => {
  beforeAll(async () => {
    // Two reviews ABOUT the building, one per unit, and one removed review that
    // must not reach any of the six pipelines.
    await seedReview({ addressId: buildingId, rating: 5, recommendation: true });
    await seedReview({ addressId: buildingId, rating: 3, recommendation: false });
    await seedReview({
      addressId: unitAId,
      addressLevel: 'UNIT',
      unitLevelId: unitAId,
      rating: 4,
      recommendation: true,
    });
    await seedReview({
      addressId: unitBId,
      addressLevel: 'UNIT',
      unitLevelId: unitBId,
      rating: 2,
      recommendation: false,
    });
    await seedReview({
      addressId: otherBuildingId,
      buildingLevelId: otherBuildingId,
      rating: 1,
      recommendation: false,
    });
    await seedReview({
      addressId: buildingId,
      rating: 1,
      recommendation: false,
      moderationStatus: 'removed',
    });
  });

  it('summarizes a UNIT from its own reviews only', async () => {
    const stats = await summarizeUnit(unitAId);
    expect(stats).toEqual({ averageRating: 4, totalReviews: 1, recommendationPercentage: 100 });
  });

  /**
   * The BUILDING summary a UNIT view shows counts BUILDING-level reviews only.
   *
   * That is the source's behaviour and it is a DIFFERENT number from
   * {@link summarizeBuilding}, which counts both levels — so the fixture has
   * both, and a rollup that dropped the `addressLevel` filter would read 3.5
   * over four rows instead of 4 over two.
   */
  it('summarizes the BUILDING a unit sits in, from building-level reviews only', async () => {
    const stats = await summarizeBuildingOfUnit(buildingId);
    expect(stats).toEqual({ averageRating: 4, totalReviews: 2, recommendationPercentage: 50 });
  });

  it('summarizes a BUILDING from both levels', async () => {
    const stats = await summarizeBuilding(buildingId);
    // 5, 3, 4, 2 → 3.5; two of four recommend.
    expect(stats).toEqual({ averageRating: 3.5, totalReviews: 4, recommendationPercentage: 50 });
  });

  it('summarizes a STREET across every building on it', async () => {
    const stats = await summarizeStreet(streetId);
    // The four above plus the other building's single 1-star. The removed one is
    // excluded, which is what makes 5 the right answer rather than 6.
    expect(stats.totalReviews).toBe(5);
    expect(stats.averageRating).toBeCloseTo(3, 5);
    expect(stats.recommendationPercentage).toBe(40);
  });

  /**
   * `count(distinct building_level_id)`, where Mongo shipped every distinct id to
   * the application to take `.length`.
   *
   * Five reviews across TWO buildings is the discriminating fixture: a plain
   * `count(*)` reports 5 and reads exactly like a plausible building count.
   */
  it('counts DISTINCT buildings on a street', async () => {
    expect(await countBuildingsOnStreet(streetId)).toBe(2);
  });

  it('answers an empty summary for a unit nobody reviewed', async () => {
    const stats = await summarizeUnit(unique('no-such-unit'));
    expect(stats).toEqual({ averageRating: 0, totalReviews: 0, recommendationPercentage: 0 });
  });

  it('answers an empty summary when a unit has no building to summarize', async () => {
    const stats = await summarizeBuildingOfUnit(undefined);
    expect(stats).toEqual({ averageRating: 0, totalReviews: 0, recommendationPercentage: 0 });
  });
});

describe('the agency profile', () => {
  let agencyId: string;

  beforeAll(async () => {
    agencyId = await seedAgency({
      id: uuidv7(),
      name: `Stats Agency ${uuidv7()}`,
      normalizedName: `stats agency ${uuidv7()}`,
      slug: `stats-agency-${uuidv7()}`,
    });

    await seedReview({ addressId: buildingId, agencyId, rating: 5, recommendation: true, depositReturned: 'full' });
    await seedReview({ addressId: buildingId, agencyId, rating: 3, recommendation: false, depositReturned: 'no' });
    // A tenancy whose deposit outcome was never answered: it counts toward the
    // rating and the recommendation and NOT toward the deposit percentage. That
    // is what makes `depositKnownCount` a different denominator from
    // `totalReviews`, and a fixture without it cannot tell the two apart.
    await seedReview({ addressId: buildingId, agencyId, rating: 4, recommendation: true });
    await seedReview({
      addressId: buildingId,
      agencyId,
      rating: 1,
      recommendation: false,
      depositReturned: 'no',
      moderationStatus: 'removed',
    });
  });

  it('averages, counts and takes both percentages over the VISIBLE reviews', async () => {
    const stats = await getAgencyStats(agencyId);
    expect(stats.totalReviews).toBe(3);
    // (5 + 3 + 4) / 3 = 4.
    expect(stats.averageRating).toBe(4);
    // 2 of 3 recommend → 67 after `Math.round`.
    expect(stats.recommendationPercentage).toBe(67);
    // 1 full of 2 ANSWERED, not of 3 reviews.
    expect(stats.depositFullPct).toBe(50);
  });

  it('answers zeros for an agency with no reviews', async () => {
    const empty = await seedAgency({
      id: uuidv7(),
      name: `Quiet Agency ${uuidv7()}`,
      normalizedName: `quiet agency ${uuidv7()}`,
      slug: `quiet-agency-${uuidv7()}`,
    });
    expect(await getAgencyStats(empty)).toEqual({
      averageRating: 0,
      totalReviews: 0,
      recommendationPercentage: 0,
      depositFullPct: 0,
    });
  });
});

describe('the three explore levels', () => {
  it('lists this city with its own coverage, and its name from the join', async () => {
    const cities = await getCitiesWithReviews();
    const mine = cities.find((city) => city.cityId === chain.cityId);
    expect(mine).toBeDefined();
    // Every review this file seeded except the two `removed` ones.
    expect(mine?.reviewCount).toBeGreaterThan(0);
    expect(mine?.name).toContain('Aggregateville');
  });

  it('summarizes the neighborhoods of one city', async () => {
    const summaries = await getNeighborhoodSummaries(chain.cityId);
    const mine = summaries.find((entry) => entry.neighborhoodId === neighborhoodId);
    expect(mine).toBeDefined();
    expect(mine?.name).toContain('Eixample');
  });

  /**
   * A review with NO neighborhood is counted by the city and by no
   * neighborhood — Mongo's `$match` carried `neighborhoodId: { $ne: null }` and
   * the join here would drop it anyway, so both halves are asserted.
   */
  it('excludes a review that resolved no neighborhood', async () => {
    const before = await getNeighborhoodSummaries(chain.cityId);
    const mineBefore = before.find((entry) => entry.neighborhoodId === neighborhoodId)?.reviewCount ?? 0;

    await seedReview({ addressId: buildingId, neighborhoodId: null });

    const after = await getNeighborhoodSummaries(chain.cityId);
    const mineAfter = after.find((entry) => entry.neighborhoodId === neighborhoodId)?.reviewCount ?? 0;
    expect(mineAfter).toBe(mineBefore);
  });

  it('pages the buildings of a neighborhood, most-reviewed first', async () => {
    const page = await getBuildingSummaries({ neighborhoodId, page: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.buildings).toHaveLength(1);
    // `building_id` carries the most reviews, so it leads.
    expect(page.buildings[0].buildingLevelId).toBe(buildingId);
    expect(page.buildings[0].street).toContain('Carrer Aggregate');
    expect(page.buildings[0].number).toBe('10');

    const second = await getBuildingSummaries({ neighborhoodId, page: 2, limit: 1 });
    expect(second.buildings).toHaveLength(1);
    expect(second.buildings[0].buildingLevelId).toBe(otherBuildingId);
    // The TOTAL is over groups, not over the page — a `count(*)` there would
    // report the review count and make `totalPages` wrong by a factor.
    expect(second.total).toBe(2);
  });

  it('clamps a page number below one rather than issuing a negative OFFSET', async () => {
    const page = await getBuildingSummaries({ neighborhoodId, page: 0, limit: 10 });
    expect(page.buildings.length).toBeGreaterThan(0);
  });
});

describe('the partial indexes are REACHABLE from the visibility predicate', () => {
  /**
   * Seven of the ten indexes on `reviews` are partial on
   * `moderation_status <> 'removed'`, and a partial index only serves a query
   * whose predicate the planner can PROVE implies the index's own.
   *
   * This is the assertion behind `visibleModeration()` spelling the value inline
   * rather than as `ne(reviews.moderationStatus, REMOVED)`. The result sets are
   * identical, so the difference is visible only in the PLAN — and only under a
   * GENERIC one, which is the measured part and the reason this test is written
   * the way it is:
   *
   *  - Under a CUSTOM plan (what Postgres builds for the first executions of a
   *    prepared statement, and what a plain parameterized `EXPLAIN` gets) the
   *    parameter's VALUE is known, `predicate_implied_by` succeeds, and BOTH
   *    forms use the partial index. A test written against that comparison
   *    passes for the literal and passes for the parameter, i.e. it measures
   *    nothing — which is exactly what the first version of this test did.
   *  - Under a GENERIC plan the value is a `Param`, the implication cannot be
   *    proven, and the parameter form falls off the index. Measured below: it
   *    switches to `reviews_author_address_key` plus an explicit `Sort`, with
   *    `moderation_status <> $1` demoted to a Filter.
   *
   * So the literal is not a micro-optimisation, it is what keeps the seven
   * scoped indexes reachable once a statement has been executed enough times for
   * the plan cache to generalise it.
   */
  it('keeps the partial index under a GENERIC plan, where a bound parameter loses it', async () => {
    // The raw postgres.js handle, because `PREPARE`/`EXECUTE` and `SET` have no
    // query-builder form. `db/postgres.ts` names the legitimate callers of this
    // accessor; a plan probe is exactly the kind of one-shot it means.
    const client = getPostgresClient();
    await client`set enable_seqscan = off`;
    await client`prepare visibility_literal as
      select id from reviews
      where address_id = 'probe' and moderation_status <> 'removed'
      order by created_at desc`;
    await client`prepare visibility_param (text) as
      select id from reviews
      where address_id = 'probe' and moderation_status <> $1
      order by created_at desc`;
    await client`set plan_cache_mode = force_generic_plan`;

    const literal = await client`explain (costs off) execute visibility_literal`;
    const parameterized = await client`explain (costs off) execute visibility_param('removed')`;

    await client`set plan_cache_mode = auto`;
    await client`deallocate visibility_literal`;
    await client`deallocate visibility_param`;
    await client`set enable_seqscan = on`;

    const plan = (rows: readonly Record<string, unknown>[]) =>
      rows.map((row) => String(row['QUERY PLAN'])).join('\n');

    expect(plan(literal)).toContain('reviews_address_created_idx');
    // The anti-vacuity half: if the parameter form ALSO kept the partial index,
    // this test would be asserting nothing about the literal.
    expect(plan(parameterized)).not.toContain('reviews_address_created_idx');
    expect(plan(parameterized)).toContain('Filter');
  });
});

describe('a removed review reaches no rollup', () => {
  it('is invisible to every level it belongs to', async () => {
    const isolatedChain = await seedGeoChain({ countryCode: 'RB', cityName: `Quietville ${uuidv7()}` });
    const isolatedNeighborhood = await seedNeighborhood({
      cityId: isolatedChain.cityId,
      name: `Silent ${uuidv7()}`,
    });
    const street = `Carrer Silent ${uuidv7()}`;
    const isolatedStreet = await seedAddress({ chain: isolatedChain, street, neighborhoodId: isolatedNeighborhood });
    const isolatedBuilding = await seedAddress({
      chain: isolatedChain,
      street,
      number: '1',
      neighborhoodId: isolatedNeighborhood,
    });

    await insertReview(db, {
      addressId: isolatedBuilding,
      addressLevel: 'BUILDING',
      streetLevelId: isolatedStreet,
      buildingLevelId: isolatedBuilding,
      cityId: isolatedChain.cityId,
      neighborhoodId: isolatedNeighborhood,
      oxyUserId: unique('oxy-removed'),
      title: 'A perfectly reasonable title',
      price: 1000,
      currency: 'EUR',
      livedFrom: new Date('2020-01-01T00:00:00.000Z'),
      livedTo: new Date('2021-01-01T00:00:00.000Z'),
      rating: 5,
      recommendation: true,
      opinion: 'Lived here a while — a reasonable opinion string.',
      moderationStatus: 'removed',
    });

    expect(await summarizeBuilding(isolatedBuilding)).toEqual({
      averageRating: 0,
      totalReviews: 0,
      recommendationPercentage: 0,
    });
    expect(await summarizeStreet(isolatedStreet)).toEqual({
      averageRating: 0,
      totalReviews: 0,
      recommendationPercentage: 0,
    });
    expect(await countBuildingsOnStreet(isolatedStreet)).toBe(0);
    expect(await getNeighborhoodSummaries(isolatedChain.cityId)).toEqual([]);
    expect(await getBuildingSummaries({ neighborhoodId: isolatedNeighborhood, page: 1, limit: 10 })).toEqual({
      buildings: [],
      total: 0,
    });
    expect((await getCitiesWithReviews()).find((city) => city.cityId === isolatedChain.cityId)).toBeUndefined();

    // The row really is there — otherwise every assertion above passes on an
    // empty table and the test proves nothing.
    const [present] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(reviews)
      .where(sql`${reviews.buildingLevelId} = ${isolatedBuilding}`);
    expect(present.total).toBe(1);
  });
});
