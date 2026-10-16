/**
 * The listing tools, through the wrapped handlers both MCP lanes call
 * (`callTool`), against the real Postgres.
 *
 * What is pinned: the reads answer with the effective account as the VIEWER
 * (owner precision for the person's own listing, the published one for anyone
 * else's — ADR 0003), a tool read does not record a view, an unresolvable place
 * never widens into a worldwide feed (ADR 0002), `resolvePlace` refuses to pick
 * between homonyms, and a report is the community report the route files —
 * with idempotent replay through the receipt table.
 */

import { count, eq } from 'drizzle-orm';
import {
  ListingReportReason,
  OfferingType,
  PropertyStatus,
  PropertyType,
} from '@homiio/shared-types';

import { getDb } from '../../db/postgres';
import {
  capabilityEffectReceipts,
  listingReports,
  moderationOutbox,
  moderationReports,
  properties,
  recentlyViewed,
} from '../../db/schema';
import { callTool } from '../helpers/capabilityHarness';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
} from '../helpers/postgresGeoFixtures';

const OWNER = 'oxy-listing-owner';
const VISITOR = 'oxy-listing-visitor';

let propertyId: string;
let cityId: string;

function listingOverrides(overrides: Partial<typeof properties.$inferInsert> = {}) {
  return {
    oxyUserId: OWNER,
    title: 'Corner flat',
    type: PropertyType.APARTMENT,
    status: PropertyStatus.PUBLISHED,
    availabilityIsAvailable: true,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRentMonthlyAmount: 1450,
    longTermRentCurrency: 'EUR' as const,
    bedrooms: 2,
    floor: 3,
    ...overrides,
  };
}

async function reset(): Promise<void> {
  const db = getDb();
  await db.delete(capabilityEffectReceipts);
  await db.delete(moderationOutbox);
  await db.delete(moderationReports);
  await db.delete(listingReports);
  await db.delete(recentlyViewed);
  await resetGeoTables();
}

beforeEach(async () => {
  await reset();
  const chain = await seedGeoChain({ cityName: 'Barcelona', propertiesCount: 1 });
  cityId = chain.cityId;
  const addressId = await seedAddress({ chain, longitude: 2.17, latitude: 41.38 });
  propertyId = await seedProperty({ addressId, overrides: listingOverrides() });
});

afterAll(reset);

describe('getListing', () => {
  it("serves the person's own listing at owner precision, and records no view", async () => {
    const result = await callTool('getListing', OWNER, { propertyId });
    expect(result.isError).toBe(false);
    const listing = result.structuredContent.data as Record<string, unknown>;
    expect(listing.id).toBe(propertyId);
    expect(listing.floor).toBe(3);

    // The route records the person opening it; an agent reading it is not that.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [views] = await getDb().select({ total: count() }).from(recentlyViewed);
    expect(views.total).toBe(0);
    const [row] = await getDb()
      .select({ views: properties.views })
      .from(properties)
      .where(eq(properties.id, propertyId));
    expect(row.views).toBe(0);
  });

  it("serves someone else's listing at its published precision", async () => {
    const result = await callTool('getListing', VISITOR, { propertyId });
    expect(result.isError).toBe(false);
    expect(result.structuredContent.data).not.toHaveProperty('floor');
  });

  it('hides a soft-deleted listing from everyone but its owner', async () => {
    await getDb()
      .update(properties)
      .set({ deletedAt: new Date() })
      .where(eq(properties.id, propertyId));
    const visitor = await callTool('getListing', VISITOR, { propertyId });
    expect(visitor.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    const owner = await callTool('getListing', OWNER, { propertyId });
    expect(owner.isError).toBe(false);
  });

  it('answers not-found for an id that names nothing', async () => {
    const result = await callTool('getListing', VISITOR, { propertyId: 'no-such-listing' });
    expect(result.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('searchListings', () => {
  it('finds the listing in the city it names, with the location echo', async () => {
    const result = await callTool('searchListings', VISITOR, { city: cityId });
    expect(result.isError).toBe(false);
    const { data, location, pagination } = result.structuredContent as {
      data: Array<Record<string, unknown>>;
      location: Record<string, unknown>;
      pagination: Record<string, unknown>;
    };
    expect(data.map((listing) => listing.id)).toEqual([propertyId]);
    expect(location).toMatchObject({ status: 'resolved', appliedLocationKind: 'city', cityId });
    expect(pagination).toMatchObject({ total: 1 });
    expect(result.structuredContent).not.toHaveProperty('success');
    expect(result.structuredContent).not.toHaveProperty('meta');
  });

  it('answers an EMPTY page marked unresolved for a place it does not know — never a global feed', async () => {
    const result = await callTool('searchListings', VISITOR, { city: 'Atlantis' });
    expect(result.isError).toBe(false);
    expect(result.structuredContent.data).toEqual([]);
    expect(result.structuredContent.location).toMatchObject({
      status: 'unresolved',
      requested: { param: 'city', value: 'Atlantis' },
    });
  });

  it("refuses a malformed geometry with the route's 400", async () => {
    const result = await callTool('searchListings', VISITOR, { swLat: 41, swLng: 2 });
    expect(result.error).toMatchObject({ status: 400 });
  });
});

describe('findNearbyListings', () => {
  it('finds listings around a point', async () => {
    const result = await callTool('findNearbyListings', VISITOR, {
      latitude: 41.38,
      longitude: 2.17,
      maxDistance: 1000,
    });
    expect(result.isError).toBe(false);
    const data = result.structuredContent.data as Array<Record<string, unknown>>;
    expect(data.map((listing) => listing.id)).toEqual([propertyId]);
  });

  it('answers nothing far away', async () => {
    const result = await callTool('findNearbyListings', VISITOR, {
      latitude: 40.0,
      longitude: -3.0,
      maxDistance: 1000,
    });
    expect(result.structuredContent.data).toEqual([]);
  });
});

describe('resolvePlace', () => {
  it('resolves a city with a location the search takes', async () => {
    const result = await callTool('resolvePlace', VISITOR, { city: 'Barcelona' });
    expect(result.structuredContent).toMatchObject({
      status: 'resolved',
      place: { id: cityId },
      location: { kind: 'place', source: { kind: 'homiio', entity: 'city', id: cityId } },
    });
  });

  it('refuses to choose between two real places, and names them', async () => {
    const twin = await seedGeoChain({
      countryCode: 'VE',
      countryName: 'Venezuela',
      regionName: 'Anzoátegui',
      cityName: 'Barcelona',
      propertiesCount: 4,
    });
    const result = await callTool('resolvePlace', VISITOR, { city: 'Barcelona' });
    expect(result.structuredContent.status).toBe('ambiguous');
    const ids = (result.structuredContent.candidates as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([cityId, twin.cityId]));
  });

  it('says not_found for a place nobody has', async () => {
    const result = await callTool('resolvePlace', VISITOR, { city: 'Atlantis' });
    expect(result.structuredContent).toEqual({ status: 'not_found' });
  });
});

describe('reportListing', () => {
  it('files the community report the route files', async () => {
    const result = await callTool('reportListing', VISITOR, {
      propertyId,
      reason: ListingReportReason.SCAM,
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent.alreadyReported).toBe(false);
    const reports = await getDb().select().from(listingReports);
    expect(reports).toHaveLength(1);
    expect(reports[0].reporterOxyUserId).toBe(VISITOR);
    const [moderation] = await getDb().select({ total: count() }).from(moderationReports);
    expect(moderation.total).toBe(1);
  });

  it('returns the open report instead of filing a second one', async () => {
    await callTool('reportListing', VISITOR, { propertyId, reason: ListingReportReason.SCAM });
    const again = await callTool('reportListing', VISITOR, {
      propertyId,
      reason: ListingReportReason.SCAM,
    });
    expect(again.structuredContent.alreadyReported).toBe(true);
    const [reports] = await getDb().select({ total: count() }).from(listingReports);
    expect(reports.total).toBe(1);
  });

  it("refuses an 'other' report without details", async () => {
    const result = await callTool('reportListing', VISITOR, {
      propertyId,
      reason: ListingReportReason.OTHER,
    });
    expect(result.error).toMatchObject({ code: 'DETAILS_REQUIRED', status: 400 });
  });

  it('replays the stored receipt for the same key, and refuses the key with other input', async () => {
    const first = await callTool(
      'reportListing',
      VISITOR,
      { propertyId, reason: ListingReportReason.SCAM },
      { idempotencyKey: 'report-key-1', lane: 'capability' },
    );
    const replay = await callTool(
      'reportListing',
      VISITOR,
      { propertyId, reason: ListingReportReason.SCAM },
      { idempotencyKey: 'report-key-1', lane: 'capability' },
    );
    // The replay is the FIRST answer, byte for byte — not a second call that
    // happens to say "already reported".
    expect(replay.structuredContent).toEqual(first.structuredContent);
    expect(replay.structuredContent.alreadyReported).toBe(false);

    const mismatch = await callTool(
      'reportListing',
      VISITOR,
      { propertyId, reason: ListingReportReason.UNSAFE },
      { idempotencyKey: 'report-key-1', lane: 'capability' },
    );
    expect(mismatch.error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('answers not-found for a listing that does not exist', async () => {
    const result = await callTool('reportListing', VISITOR, {
      propertyId: 'no-such-listing',
      reason: ListingReportReason.SCAM,
    });
    expect(result.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
