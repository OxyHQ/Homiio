/**
 * The owner-side listing, room and analytics tools, called the way both MCP
 * lanes call them (`callTool`), against the real Postgres.
 *
 * What each case pins:
 *  - the tool acts as the EFFECTIVE account and only on its own rows — a
 *    listing or room that is someone else's answers the route's not-found
 *    (`markPropertyTransacted` keeps the route's 403);
 *  - writes go through the same validation and field whitelist as the route;
 *  - re-marking a listing transacted never books a second commission;
 *  - an idempotency key replays the stored receipt instead of writing twice.
 */

import { count, eq } from 'drizzle-orm';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { getDb } from '../../db/postgres';
import { commissions, partners, properties } from '../../db/schema';
import { callTool } from '../helpers/capabilityHarness';
import { createAddress, createRentProperty } from '../helpers/factories';
import { resetGeoTables, resetPartnerTables } from '../helpers/postgresGeoFixtures';

jest.mock('../../services/geocodingService', () => ({
  __esModule: true,
  reverseGeocode: jest.fn(async () => ({ success: false as const, error: 'offline' })),
  forwardGeocode: jest.fn(async () => ({ success: false as const, error: 'offline' })),
}));

const OWNER = 'oxy-owner-capabilities';
const STRANGER = 'oxy-stranger-capabilities';

/** A create body that passes `validation.validateProperty`, as the form sends it. */
function createBody(overrides: Record<string, unknown> = {}) {
  return {
    type: PropertyType.APARTMENT,
    description: 'Bright two-bedroom flat',
    bedrooms: 2,
    bathrooms: 1,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 1250, currency: 'EUR' },
    status: PropertyStatus.DRAFT,
    address: {
      street: 'Carrer de Mallorca',
      number: '401',
      postal_code: '08013',
      city: 'Barcelona',
      state: 'Catalonia',
      country: 'Spain',
      countryCode: 'ES',
    },
    location: { type: 'Point', coordinates: [2.1734, 41.3851] },
    ...overrides,
  };
}

function dataOf(result: { structuredContent: Record<string, unknown> }) {
  return result.structuredContent.data as Record<string, unknown>;
}

async function statusOf(propertyId: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ status: properties.status })
    .from(properties)
    .where(eq(properties.id, propertyId));
  return row?.status;
}

beforeEach(async () => {
  await resetPartnerTables();
  await resetGeoTables();
});

describe('listing owner tools', () => {
  it('createProperty creates a listing owned by the effective account, validated like the route', async () => {
    const created = await callTool('createProperty', OWNER, {
      property: createBody({ oxyUserId: STRANGER, views: 999 }),
    });
    expect(created.isError).toBe(false);
    const listing = dataOf(created);
    const id = String(listing.id);

    const [row] = await getDb().select().from(properties).where(eq(properties.id, id));
    // The owner is the effective account, never a body field; `views` is
    // system-managed and off the whitelist.
    expect(row.oxyUserId).toBe(OWNER);
    expect(row.views).toBe(0);

    const refused = await callTool('createProperty', OWNER, {
      property: { type: PropertyType.APARTMENT, offerings: [OfferingType.LONG_TERM_RENT] },
    });
    expect(refused.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('listMyProperties and getMyProperty read only the account’s own listings', async () => {
    const mine = await createRentProperty({ oxyUserId: OWNER, status: PropertyStatus.DRAFT });
    await createRentProperty({ oxyUserId: STRANGER });

    const list = await callTool('listMyProperties', OWNER, { page: 1, limit: 10 });
    const ids = (list.structuredContent.data as { id: string }[]).map((entry) => entry.id);
    expect(ids).toEqual([mine.id]);
    expect(list.structuredContent.pagination).toMatchObject({ page: 1, limit: 10, total: 1 });

    expect(dataOf(await callTool('getMyProperty', OWNER, { propertyId: mine.id })).id).toBe(
      mine.id,
    );
    const foreign = await callTool('getMyProperty', STRANGER, { propertyId: mine.id });
    expect(foreign.error).toMatchObject({ code: 'PROPERTY_NOT_FOUND', status: 404 });
  });

  it('listPropertiesByOwner answers only another owner’s published listings', async () => {
    const published = await createRentProperty({ oxyUserId: OWNER });
    await createRentProperty({ oxyUserId: OWNER, status: PropertyStatus.DRAFT });

    const result = await callTool('listPropertiesByOwner', STRANGER, { oxyUserId: OWNER });
    const ids = (result.structuredContent.data as { id: string }[]).map((entry) => entry.id);
    expect(ids).toEqual([published.id]);
  });

  it('updateProperty edits only whitelisted fields of the account’s own listing', async () => {
    const created = await callTool('createProperty', OWNER, { property: createBody() });
    const propertyId = String(dataOf(created).id);

    const updated = await callTool('updateProperty', OWNER, {
      propertyId,
      property: createBody({ description: 'Renovated', oxyUserId: STRANGER }),
    });
    expect(updated.isError).toBe(false);
    const [row] = await getDb().select().from(properties).where(eq(properties.id, propertyId));
    expect(row.description).toBe('Renovated');
    expect(row.oxyUserId).toBe(OWNER);

    const foreign = await callTool('updateProperty', STRANGER, {
      propertyId,
      property: createBody({ description: 'Hijacked' }),
    });
    expect(foreign.error).toMatchObject({ code: 'PROPERTY_NOT_FOUND', status: 404 });
  });

  it('publishProperty and unpublishProperty move the account’s own listing', async () => {
    const listing = await createRentProperty({ oxyUserId: OWNER, status: PropertyStatus.DRAFT });

    expect((await callTool('publishProperty', OWNER, { propertyId: listing.id })).isError).toBe(
      false,
    );
    expect(await statusOf(listing.id)).toBe(PropertyStatus.PUBLISHED);

    const foreign = await callTool('unpublishProperty', STRANGER, { propertyId: listing.id });
    expect(foreign.error).toMatchObject({ code: 'PROPERTY_NOT_FOUND', status: 404 });
    expect(await statusOf(listing.id)).toBe(PropertyStatus.PUBLISHED);

    await callTool('unpublishProperty', OWNER, { propertyId: listing.id });
    expect(await statusOf(listing.id)).toBe(PropertyStatus.DRAFT);
  });

  it('deleteProperty archives the account’s own listing and refuses a stranger', async () => {
    const listing = await createRentProperty({ oxyUserId: OWNER });

    const foreign = await callTool('deleteProperty', STRANGER, { propertyId: listing.id });
    expect(foreign.error).toMatchObject({ code: 'PROPERTY_NOT_FOUND', status: 404 });
    expect(await statusOf(listing.id)).toBe(PropertyStatus.PUBLISHED);

    const deleted = await callTool('deleteProperty', OWNER, { propertyId: listing.id });
    expect(deleted.structuredContent).toEqual({ data: null });
    const list = await callTool('listMyProperties', OWNER, {});
    expect(list.structuredContent.data).toEqual([]);
  });

  it('markPropertyTransacted books one commission however often it runs; a stranger gets the route’s 403', async () => {
    const [partner] = await getDb()
      .insert(partners)
      .values({ oxyUserId: 'oxy-partner-capabilities', referralCode: 'capref' })
      .returning({ id: partners.id });
    const created = await callTool('createProperty', OWNER, {
      property: createBody({ referralCode: 'capref', status: PropertyStatus.PUBLISHED }),
    });
    const propertyId = String(dataOf(created).id);
    const [stamped] = await getDb().select().from(properties).where(eq(properties.id, propertyId));
    expect(stamped.sourcedByPartnerId).toBe(partner.id);

    const foreign = await callTool('markPropertyTransacted', STRANGER, { propertyId });
    expect(foreign.error).toMatchObject({ code: 'FORBIDDEN', status: 403 });

    const first = await callTool('markPropertyTransacted', OWNER, { propertyId });
    expect(first.isError).toBe(false);
    expect((dataOf(first).property as { status: string }).status).toBe(PropertyStatus.RENTED);
    await callTool('markPropertyTransacted', OWNER, { propertyId });

    const [booked] = await getDb()
      .select({ n: count() })
      .from(commissions)
      .where(eq(commissions.propertyId, propertyId));
    expect(booked.n).toBe(1);
  });

  it('an idempotency key replays the stored listing instead of creating a second one', async () => {
    const body = createBody();
    const first = await callTool(
      'createProperty',
      OWNER,
      { property: body },
      {
        idempotencyKey: 'create-once',
      },
    );
    const replay = await callTool(
      'createProperty',
      OWNER,
      { property: body },
      {
        idempotencyKey: 'create-once',
      },
    );
    expect(replay.structuredContent).toEqual(first.structuredContent);
    const [rows] = await getDb()
      .select({ n: count() })
      .from(properties)
      .where(eq(properties.oxyUserId, OWNER));
    expect(rows.n).toBe(1);

    const reused = await callTool(
      'createProperty',
      OWNER,
      { property: createBody({ description: 'Another one' }) },
      { idempotencyKey: 'create-once' },
    );
    expect(reused.error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });
});

describe('room tools', () => {
  it('createRoom needs a parent the account owns', async () => {
    const parent = await createRentProperty({ oxyUserId: OWNER });

    const foreign = await callTool('createRoom', STRANGER, {
      room: { parentPropertyId: parent.id, description: 'Not mine' },
    });
    expect(foreign.error).toMatchObject({ code: 'PARENT_PROPERTY_NOT_FOUND', status: 404 });

    const created = await callTool('createRoom', OWNER, {
      room: { parentPropertyId: parent.id, description: 'Box room', status: 'published' },
    });
    expect(created.isError).toBe(false);
    const roomId = String(dataOf(created).id);

    const [row] = await getDb().select().from(properties).where(eq(properties.id, roomId));
    expect(row).toMatchObject({
      type: PropertyType.ROOM,
      oxyUserId: OWNER,
      parentPropertyId: parent.id,
    });

    expect(dataOf(await callTool('getRoom', STRANGER, { roomId })).id).toBe(roomId);
    const listed = await callTool('listRooms', STRANGER, { oxyUserId: OWNER });
    expect((listed.structuredContent.data as { id: string }[]).map((r) => r.id)).toEqual([roomId]);
  });

  it('updateRoom and deleteRoom answer NOT_FOUND to a stranger', async () => {
    const parent = await createRentProperty({ oxyUserId: OWNER });
    const created = await callTool('createRoom', OWNER, {
      room: { parentPropertyId: parent.id, description: 'Box room' },
    });
    const roomId = String(dataOf(created).id);

    const foreignUpdate = await callTool('updateRoom', STRANGER, {
      roomId,
      room: { description: 'Hijacked' },
    });
    expect(foreignUpdate.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    const foreignDelete = await callTool('deleteRoom', STRANGER, { roomId });
    expect(foreignDelete.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });

    const updated = await callTool('updateRoom', OWNER, {
      roomId,
      room: { description: 'Sunny room' },
    });
    expect(dataOf(updated).description).toBe('Sunny room');
    expect((await callTool('deleteRoom', OWNER, { roomId })).structuredContent).toEqual({
      data: null,
    });
    expect(await statusOf(roomId)).toBe('archived');
  });

  it('getRoom refuses a listing that is not a room', async () => {
    const listing = await createRentProperty({ oxyUserId: OWNER });
    const result = await callTool('getRoom', OWNER, { roomId: listing.id });
    expect(result.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('analytics tools', () => {
  it('getMyAnalytics answers the zeroed shape for an account with no profile', async () => {
    const result = await callTool('getMyAnalytics', OWNER, { period: '7d' });
    expect(dataOf(result)).toMatchObject({
      period: '7d',
      totalInteractions: 0,
      properties: { listed: 0 },
    });
  });

  it('getAppStats counts the catalogue', async () => {
    await createAddress();
    await createRentProperty({ oxyUserId: OWNER });
    const result = await callTool('getAppStats', STRANGER, {});
    expect(result.isError).toBe(false);
    expect(dataOf(result)).toHaveProperty('totals');
    expect(dataOf(result)).toHaveProperty('priceBuckets');
  });
});
