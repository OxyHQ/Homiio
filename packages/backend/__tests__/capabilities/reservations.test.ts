/**
 * The reservation tools, through the wrapped handlers both MCP lanes call,
 * against the REAL Postgres: the effective account as guest or host, the
 * route's own refusals (403 for a stranger, as the route answers), the route's
 * validation chain, external listings answering their link, and a replayed
 * idempotency key booking once.
 */

import { eq } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { capabilityEffectReceipts, reservations } from '../../db/schema';
import { callTool } from '../helpers/capabilityHarness';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const HOST = 'oxy-stay-host';
const GUEST = 'oxy-stay-guest';
const STRANGER = 'oxy-stay-stranger';
const DAY = 24 * 60 * 60 * 1000;

let geoChainCounter = 0;
function nextCountryCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const index = geoChainCounter++;
  return `${alphabet[Math.floor(index / 26) % 26]}${alphabet[index % 26]}`;
}

async function seedBookable(overrides: Record<string, unknown> = {}): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: {
      oxyUserId: HOST,
      status: 'published',
      isExternal: false,
      offerings: ['short_term_rent'],
      shortTermRentNightlyRate: 100,
      shortTermRentCurrency: 'EUR',
      maxGuests: 4,
      cancellationPolicy: 'flexible',
      ...overrides,
    },
  });
  return propertyId;
}

function stay(fromDays: number, toDays: number, base = Date.now()) {
  return {
    checkIn: new Date(base + fromDays * DAY).toISOString(),
    checkOut: new Date(base + toDays * DAY).toISOString(),
  };
}

async function book(propertyId: string): Promise<string> {
  const result = await callTool('createReservation', GUEST, {
    propertyId,
    ...stay(10, 13),
    guestCount: 2,
  });
  expect(result.isError).toBe(false);
  return (result.structuredContent.data as { id: string }).id;
}

async function row(id: string) {
  const [found] = await getDb().select().from(reservations).where(eq(reservations.id, id));
  return found;
}

beforeEach(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(reservations);
  await resetGeoTables();
});

afterAll(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(reservations);
  await resetGeoTables();
});

describe('createReservation', () => {
  it('books as the effective account, priced from the listing', async () => {
    const id = await book(await seedBookable());
    const stored = await row(id);
    expect(stored.guestOxyUserId).toBe(GUEST);
    expect(stored.hostOxyUserId).toBe(HOST);
    expect(stored.status).toBe('pending');
    expect(stored.subtotal).toBe(300);
  });

  it('answers external_listing and books nothing', async () => {
    const propertyId = await seedBookable({
      isExternal: true,
      source: 'idealista',
      sourceUrl: 'https://advertiser.test/stay/1',
    });
    const result = await callTool('createReservation', GUEST, {
      propertyId,
      ...stay(10, 13),
      guestCount: 2,
    });
    expect(result.structuredContent).toEqual({
      status: 'external_listing',
      sourceUrl: 'https://advertiser.test/stay/1',
    });
    expect(await getDb().select().from(reservations)).toHaveLength(0);
  });

  it("refuses what the route's validation chain refuses", async () => {
    const propertyId = await seedBookable();
    const { checkIn } = stay(10, 13);
    const result = await callTool('createReservation', GUEST, {
      propertyId,
      checkIn,
      checkOut: checkIn,
      guestCount: 2,
    });
    expect(result.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('replays the stored result for the same key and books once', async () => {
    const propertyId = await seedBookable();
    const input = { propertyId, ...stay(10, 13), guestCount: 2 };
    const first = await callTool('createReservation', GUEST, input, { idempotencyKey: 'stay-1' });
    const second = await callTool('createReservation', GUEST, input, { idempotencyKey: 'stay-1' });
    expect(second).toEqual(first);
    expect(await getDb().select().from(reservations)).toHaveLength(1);
  });
});

describe('reading', () => {
  it('lists as guest and as host, and refuses a stranger the single read (403, as the route)', async () => {
    const id = await book(await seedBookable());
    expect((await callTool('listMyReservations', GUEST, {})).structuredContent.data).toHaveLength(
      1,
    );
    expect(
      (await callTool('listMyReservations', HOST, { asHost: true })).structuredContent.data,
    ).toHaveLength(1);
    expect((await callTool('listMyReservations', HOST, {})).structuredContent.data).toEqual([]);

    expect((await callTool('getReservation', GUEST, { reservationId: id })).isError).toBe(false);
    expect((await callTool('getReservation', STRANGER, { reservationId: id })).error).toMatchObject(
      { code: 'FORBIDDEN', status: 403 },
    );
    expect(
      (await callTool('getReservation', GUEST, { reservationId: 'no-such-stay' })).error,
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('publishes the stay calendar without who booked', async () => {
    const propertyId = await seedBookable();
    const id = await book(propertyId);
    await callTool('confirmReservation', HOST, { reservationId: id });
    const result = await callTool('getListingAvailability', STRANGER, { propertyId });
    const data = result.structuredContent.data as { booked: Record<string, unknown>[] };
    expect(data.booked).toHaveLength(1);
    expect(Object.keys(data.booked[0]).sort()).toEqual(['end', 'start', 'status']);
  });
});

describe('transitions', () => {
  it('lets only the host confirm', async () => {
    const id = await book(await seedBookable());
    expect(
      (await callTool('confirmReservation', GUEST, { reservationId: id })).error,
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (await callTool('confirmReservation', STRANGER, { reservationId: id })).error,
    ).toMatchObject({ code: 'FORBIDDEN' });
    const confirmed = await callTool('confirmReservation', HOST, { reservationId: id });
    expect(confirmed.structuredContent.data).toMatchObject({ status: 'confirmed' });
  });

  it('lets the host decline', async () => {
    const id = await book(await seedBookable());
    await callTool('declineReservation', HOST, { reservationId: id });
    expect((await row(id)).status).toBe('declined');
  });

  it('lets the guest cancel, and converges on a repeat', async () => {
    const id = await book(await seedBookable());
    const cancelled = await callTool('cancelReservation', GUEST, { reservationId: id });
    expect(cancelled.structuredContent).toMatchObject({
      alreadyCancelled: false,
      data: { status: 'cancelled' },
    });
    const again = await callTool('cancelReservation', GUEST, { reservationId: id });
    expect(again.structuredContent.alreadyCancelled).toBe(true);
  });
});
