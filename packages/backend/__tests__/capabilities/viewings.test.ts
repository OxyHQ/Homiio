/**
 * The viewing tools, through the same wrapped handlers both MCP lanes call,
 * against the REAL Postgres.
 *
 * What each case pins:
 *  - the effective account is the ONLY authority (no input names the actor);
 *  - a stranger is refused exactly as the route refuses them (these routes
 *    answer 403 for "not your viewing", 404 for "not your schedule" — the tool
 *    matches the route rather than inventing a third answer);
 *  - an external listing never gets a request, only its own link;
 *  - the owner hears about it through `notificationDispatchService`, and only
 *    through it;
 *  - an idempotency key replays the stored result and runs the effect once.
 */

import { eq } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { capabilityEffectReceipts, viewingRequests } from '../../db/schema';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { callTool } from '../helpers/capabilityHarness';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const OWNER = 'oxy-viewing-owner';
const VISITOR = 'oxy-viewing-visitor';
const STRANGER = 'oxy-viewing-stranger';

let geoChainCounter = 0;
function nextCountryCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const index = geoChainCounter++;
  return `${alphabet[Math.floor(index / 26) % 26]}${alphabet[index % 26]}`;
}

async function seedListing(overrides: Record<string, unknown> = {}): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: { oxyUserId: OWNER, status: 'published', isExternal: false, ...overrides },
  });
  return propertyId;
}

function futureSlot(offsetDays = 14, time = '10:00'): { date: string; time: string } {
  const day = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return { date: day.toISOString().slice(0, 10), time };
}

async function viewingCount(): Promise<number> {
  return (await getDb().select().from(viewingRequests)).length;
}

async function request(propertyId: string, slot = futureSlot()): Promise<string> {
  const result = await callTool('requestViewing', VISITOR, { propertyId, ...slot });
  expect(result.isError).toBe(false);
  return (result.structuredContent.data as { id: string }).id;
}

let dispatch: jest.SpyInstance;

beforeEach(async () => {
  dispatch = jest.spyOn(notificationDispatchService, 'createForUser');
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(viewingRequests);
  await resetGeoTables();
});

afterEach(() => dispatch.mockRestore());

afterAll(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(viewingRequests);
  await resetGeoTables();
});

describe('requestViewing', () => {
  it('requests as the effective account and notifies the owner through the dispatcher', async () => {
    const propertyId = await seedListing();
    const result = await callTool('requestViewing', VISITOR, { propertyId, ...futureSlot() });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.status).toBe('requested');
    const data = result.structuredContent.data as { id: string; status: string };
    expect(data.status).toBe('pending');
    const [row] = await getDb()
      .select()
      .from(viewingRequests)
      .where(eq(viewingRequests.id, data.id));
    expect(row.requesterOxyUserId).toBe(VISITOR);
    expect(row.ownerOxyUserId).toBe(OWNER);
    expect(dispatch).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ title: 'New viewing request' }),
    );
  });

  it('takes the account from a capability ticket exactly as from an OAuth connection', async () => {
    const propertyId = await seedListing();
    const result = await callTool(
      'requestViewing',
      VISITOR,
      { propertyId, ...futureSlot() },
      { lane: 'capability' },
    );
    expect(result.isError).toBe(false);
    const [row] = await getDb().select().from(viewingRequests);
    expect(row.requesterOxyUserId).toBe(VISITOR);
  });

  it('answers external_listing with the source link and requests nothing', async () => {
    const propertyId = await seedListing({
      isExternal: true,
      source: 'idealista',
      sourceUrl: 'https://advertiser.test/listing/1',
    });
    const result = await callTool('requestViewing', VISITOR, { propertyId, ...futureSlot() });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      status: 'external_listing',
      sourceUrl: 'https://advertiser.test/listing/1',
    });
    expect(await viewingCount()).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses the owner booking their own listing, as the route does', async () => {
    const propertyId = await seedListing();
    const result = await callTool('requestViewing', OWNER, { propertyId, ...futureSlot() });
    expect(result.error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(await viewingCount()).toBe(0);
  });

  it('replays the stored result for the same key and runs the effect once', async () => {
    const propertyId = await seedListing();
    const input = { propertyId, ...futureSlot() };
    const first = await callTool('requestViewing', VISITOR, input, { idempotencyKey: 'view-1' });
    const second = await callTool('requestViewing', VISITOR, input, { idempotencyKey: 'view-1' });

    expect(first.isError).toBe(false);
    expect(second).toEqual(first);
    expect(await viewingCount()).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);

    const reused = await callTool(
      'requestViewing',
      VISITOR,
      { ...input, time: '11:00' },
      { idempotencyKey: 'view-1' },
    );
    expect(reused.error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await viewingCount()).toBe(1);
  });
});

describe('listing the requests', () => {
  it('lists my own requests with the route pagination', async () => {
    const propertyId = await seedListing();
    await request(propertyId);
    const result = await callTool('listMyViewingRequests', VISITOR, {});
    expect(result.isError).toBe(false);
    expect(result.structuredContent.data).toHaveLength(1);
    expect(result.structuredContent.pagination).toMatchObject({ page: 1, limit: 10, total: 1 });
    expect((await callTool('listMyViewingRequests', STRANGER, {})).structuredContent.data).toEqual(
      [],
    );
  });

  it('shows the owner every request and a stranger only their own', async () => {
    const propertyId = await seedListing();
    await request(propertyId);
    const asOwner = await callTool('listListingViewingRequests', OWNER, { propertyId });
    const asStranger = await callTool('listListingViewingRequests', STRANGER, { propertyId });
    expect(asOwner.structuredContent.data).toHaveLength(1);
    expect(asStranger.structuredContent.data).toEqual([]);
  });
});

describe('deciding on a request', () => {
  it('lets only the owner approve (the route answers 403 to anybody else)', async () => {
    const viewingId = await request(await seedListing());
    dispatch.mockClear();

    const refused = await callTool('approveViewing', STRANGER, { viewingId });
    expect(refused.error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(dispatch).not.toHaveBeenCalled();

    const approved = await callTool('approveViewing', OWNER, { viewingId, response: 'See you' });
    expect(approved.structuredContent.data).toMatchObject({ status: 'approved' });
    expect(dispatch).toHaveBeenCalledWith(
      VISITOR,
      expect.objectContaining({ title: 'Viewing approved', message: 'See you' }),
    );
  });

  it('lets the owner decline', async () => {
    const viewingId = await request(await seedListing());
    expect((await callTool('declineViewing', VISITOR, { viewingId })).error).toMatchObject({
      code: 'FORBIDDEN',
    });
    const declined = await callTool('declineViewing', OWNER, { viewingId });
    expect(declined.structuredContent.data).toMatchObject({ status: 'declined' });
  });

  it('answers not-found for a viewing that does not exist', async () => {
    const result = await callTool('approveViewing', OWNER, { viewingId: 'no-such-viewing' });
    expect(result.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('cancels for the requester, refuses a stranger, and converges on a repeat', async () => {
    const viewingId = await request(await seedListing());
    expect((await callTool('cancelViewing', STRANGER, { viewingId })).error).toMatchObject({
      code: 'FORBIDDEN',
    });
    const cancelled = await callTool('cancelViewing', VISITOR, { viewingId });
    expect(cancelled.structuredContent).toMatchObject({
      alreadyCancelled: false,
      data: { status: 'cancelled' },
    });
    const again = await callTool('cancelViewing', VISITOR, { viewingId });
    expect(again.structuredContent.alreadyCancelled).toBe(true);
  });

  it('reschedules only for the requester', async () => {
    const viewingId = await request(await seedListing());
    const scheduledAt = async () =>
      (
        await getDb().select().from(viewingRequests).where(eq(viewingRequests.id, viewingId))
      )[0].scheduledAt.getTime();
    const before = await scheduledAt();
    const moved = futureSlot(15, '12:00');

    expect(
      (await callTool('rescheduleViewing', OWNER, { viewingId, ...moved })).error,
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(await scheduledAt()).toBe(before);

    const result = await callTool('rescheduleViewing', VISITOR, { viewingId, ...moved });
    expect(result.isError).toBe(false);
    // A day later at 12:00 rather than 10:00 — at least a day on, in any zone.
    expect(await scheduledAt()).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
  });
});

describe('the schedule', () => {
  const windows = [
    { weekday: 1, startMinute: 600, endMinute: 720, slotMinutes: 30, modality: 'in_person' },
  ];

  it("answers not-found for somebody else's listing, as the route does", async () => {
    const propertyId = await seedListing();
    expect((await callTool('getViewingWindows', STRANGER, { propertyId })).error).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(
      (await callTool('setViewingWindows', STRANGER, { propertyId, windows })).error,
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('publishes the owner schedule, which the public availability then offers', async () => {
    const propertyId = await seedListing();
    const set = await callTool('setViewingWindows', OWNER, {
      propertyId,
      windows,
      timeZone: 'Europe/Madrid',
    });
    expect(set.structuredContent.data).toMatchObject({ timeZone: 'Europe/Madrid' });
    const read = await callTool('getViewingWindows', OWNER, { propertyId });
    expect((read.structuredContent.data as { windows: unknown[] }).windows).toHaveLength(1);

    const availability = await callTool('getViewingAvailability', STRANGER, {
      propertyId,
      days: 14,
    });
    const data = availability.structuredContent.data as { published: boolean; slots: unknown[] };
    expect(data.published).toBe(true);
    expect(data.slots.length).toBeGreaterThan(0);
  });

  it('answers external_listing for an external listing availability', async () => {
    const propertyId = await seedListing({
      isExternal: true,
      source: 'idealista',
      sourceUrl: 'https://advertiser.test/listing/2',
    });
    const result = await callTool('getViewingAvailability', VISITOR, { propertyId });
    expect(result.structuredContent).toEqual({
      status: 'external_listing',
      sourceUrl: 'https://advertiser.test/listing/2',
    });
  });
});
