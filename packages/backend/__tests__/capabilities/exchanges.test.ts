/**
 * The exchange tools, through the wrapped handlers both MCP lanes call,
 * against the REAL Postgres: requester and host as the effective account, the
 * route's own refusals (403 for a non-party, as the route answers), external
 * target listings answering their link, the four transitions, reviews, and a
 * replayed idempotency key creating one request.
 */

import { eq } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import {
  capabilityEffectReceipts,
  exchangeRequests,
  exchangeReviews,
  reservations,
} from '../../db/schema';
import { callTool } from '../helpers/capabilityHarness';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const HOST = 'oxy-exchange-host';
const GUEST = 'oxy-exchange-guest';
const STRANGER = 'oxy-exchange-stranger';
const DAY = 24 * 60 * 60 * 1000;

let geoChainCounter = 0;
function nextCountryCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const index = geoChainCounter++;
  return `${alphabet[Math.floor(index / 26) % 26]}${alphabet[index % 26]}`;
}

async function seedExchangeListing(overrides: Record<string, unknown> = {}): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: {
      oxyUserId: HOST,
      status: 'published',
      isExternal: false,
      offerings: ['exchange'],
      exchangeMode: 'both',
      ...overrides,
    },
  });
  return propertyId;
}

function window(fromDays: number, toDays: number) {
  return {
    start: new Date(Date.now() + fromDays * DAY).toISOString(),
    end: new Date(Date.now() + toDays * DAY).toISOString(),
  };
}

async function hostRequest(propertyId: string): Promise<string> {
  const result = await callTool('requestExchange', GUEST, {
    propertyId,
    mode: 'host',
    requestedWindow: window(10, 20),
  });
  expect(result.isError).toBe(false);
  return (result.structuredContent.data as { id: string }).id;
}

async function status(id: string): Promise<string> {
  const [row] = await getDb().select().from(exchangeRequests).where(eq(exchangeRequests.id, id));
  return row.status;
}

async function clean(): Promise<void> {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(exchangeReviews);
  await getDb().delete(exchangeRequests);
  await getDb().delete(reservations);
  await resetGeoTables();
}

beforeEach(clean);
afterAll(clean);

describe('requestExchange', () => {
  it('requests as the effective account', async () => {
    const id = await hostRequest(await seedExchangeListing());
    const [row] = await getDb().select().from(exchangeRequests).where(eq(exchangeRequests.id, id));
    expect(row.requesterOxyUserId).toBe(GUEST);
    expect(row.hostOxyUserId).toBe(HOST);
  });

  it('answers external_listing for an external target and requests nothing', async () => {
    const propertyId = await seedExchangeListing({
      isExternal: true,
      source: 'idealista',
      sourceUrl: 'https://advertiser.test/swap/1',
    });
    const result = await callTool('requestExchange', GUEST, {
      propertyId,
      mode: 'host',
      requestedWindow: window(10, 20),
    });
    expect(result.structuredContent).toEqual({
      status: 'external_listing',
      sourceUrl: 'https://advertiser.test/swap/1',
    });
    expect(await getDb().select().from(exchangeRequests)).toHaveLength(0);
  });

  it('replays the stored result for the same key and creates one request', async () => {
    const propertyId = await seedExchangeListing();
    const input = { propertyId, mode: 'host', requestedWindow: window(10, 20) };
    const first = await callTool('requestExchange', GUEST, input, { idempotencyKey: 'swap-1' });
    const second = await callTool('requestExchange', GUEST, input, { idempotencyKey: 'swap-1' });
    expect(second).toEqual(first);
    expect(await getDb().select().from(exchangeRequests)).toHaveLength(1);
  });
});

describe('reading', () => {
  it('lists by role and refuses a non-party the single read (403, as the route)', async () => {
    const id = await hostRequest(await seedExchangeListing());
    expect(
      (await callTool('listMyExchangeRequests', GUEST, {})).structuredContent.data,
    ).toHaveLength(1);
    expect(
      (await callTool('listMyExchangeRequests', HOST, { asHost: true })).structuredContent.data,
    ).toHaveLength(1);
    expect((await callTool('getExchangeRequest', HOST, { exchangeRequestId: id })).isError).toBe(
      false,
    );
    expect(
      (await callTool('getExchangeRequest', STRANGER, { exchangeRequestId: id })).error,
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});

describe('transitions', () => {
  it('lets only the host confirm', async () => {
    const id = await hostRequest(await seedExchangeListing());
    expect(
      (await callTool('confirmExchange', GUEST, { exchangeRequestId: id })).error,
    ).toMatchObject({ code: 'FORBIDDEN' });
    const confirmed = await callTool('confirmExchange', HOST, { exchangeRequestId: id });
    expect(confirmed.structuredContent.data).toMatchObject({ status: 'confirmed' });
  });

  it('lets the host decline and only the requester cancel', async () => {
    const declined = await hostRequest(await seedExchangeListing());
    await callTool('declineExchange', HOST, { exchangeRequestId: declined });
    expect(await status(declined)).toBe('declined');

    const id = await hostRequest(await seedExchangeListing());
    expect((await callTool('cancelExchange', HOST, { exchangeRequestId: id })).error).toMatchObject(
      { code: 'FORBIDDEN' },
    );
    const cancelled = await callTool('cancelExchange', GUEST, {
      exchangeRequestId: id,
      message: 'Plans changed',
    });
    expect(cancelled.structuredContent.alreadyCancelled).toBe(false);
    expect(await status(id)).toBe('cancelled');
  });

  it('completes after the stay, and then each party reviews the other once', async () => {
    const propertyId = await seedExchangeListing();
    const [past] = await getDb()
      .insert(exchangeRequests)
      .values({
        propertyId,
        requesterOxyUserId: GUEST,
        hostOxyUserId: HOST,
        mode: 'host',
        requestedWindowStart: new Date(Date.now() - 20 * DAY),
        requestedWindowEnd: new Date(Date.now() - 10 * DAY),
        status: 'confirmed',
      })
      .returning();

    const completed = await callTool('completeExchange', GUEST, { exchangeRequestId: past.id });
    expect(completed.structuredContent.data).toMatchObject({ status: 'completed' });

    expect(
      (await callTool('writeExchangeReview', STRANGER, { exchangeRequestId: past.id, rating: 5 }))
        .error,
    ).toMatchObject({ code: 'FORBIDDEN' });
    const review = await callTool('writeExchangeReview', GUEST, {
      exchangeRequestId: past.id,
      rating: 5,
      comment: 'Lovely home',
      categories: { cleanliness: 5 },
    });
    expect(review.structuredContent.data).toMatchObject({ subjectOxyUserId: HOST, rating: 5 });
    expect(
      (await callTool('writeExchangeReview', GUEST, { exchangeRequestId: past.id, rating: 4 }))
        .error,
    ).toMatchObject({ code: 'ALREADY_REVIEWED', status: 409 });
    expect(
      (await callTool('writeExchangeReview', GUEST, { exchangeRequestId: past.id, rating: 9 }))
        .isError,
    ).toBe(true);

    const reviews = await callTool('listExchangeReviews', HOST, { exchangeRequestId: past.id });
    expect(reviews.structuredContent.data).toHaveLength(1);
    expect(
      (await callTool('listExchangeReviews', STRANGER, { exchangeRequestId: past.id })).error,
    ).toMatchObject({ code: 'FORBIDDEN' });

    const aboutHost = await callTool('listUserExchangeReviews', STRANGER, { oxyUserId: HOST });
    expect(aboutHost.structuredContent).toMatchObject({
      pagination: { total: 1 },
      meta: { averageRating: 5, reviewCount: 1 },
    });
  });
});
