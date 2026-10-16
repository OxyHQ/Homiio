/**
 * The roommate tools, through the wrapped handlers both MCP lanes call.
 *
 * A request is answered only by its RECIPIENT and a relationship ended only by
 * a participant — both in the repository's UPDATE predicate, so anybody else
 * gets not-found — and every notification goes through
 * `notificationDispatchService`. A retried `sendRoommateRequest` with the same
 * idempotency key replays its receipt: one request, one notification.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import { getDb } from '../../db/postgres';
import { ensureProfile } from '../../db/profiles/profileRepository';
import { profiles, roommateRelationships, roommateRequests } from '../../db/schema';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { callTool } from '../helpers/capabilityHarness';

const SUITE = uuidv7().slice(-8);
const ALICE = `oxy-rm-alice-${SUITE}`;
const BOB = `oxy-rm-bob-${SUITE}`;
const MALLORY = `oxy-rm-mallory-${SUITE}`;

const realFetch = global.fetch;

beforeAll(() => {
  // Participant display names come from Oxy's `/users/by-ids`; no network here.
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
  }));
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(async () => {
  await getDb().delete(roommateRelationships);
  await getDb().delete(roommateRequests);
  await getDb().delete(profiles);
  for (const oxyUserId of [ALICE, BOB, MALLORY]) {
    await ensureProfile(getDb(), oxyUserId, 'owner');
  }
  await getDb()
    .update(profiles)
    .set({ settingsRoommateEnabled: true })
    .where(eq(profiles.oxyUserId, BOB));
});

afterEach(() => jest.restoreAllMocks());

async function send(from = ALICE, to = BOB) {
  const result = await callTool('sendRoommateRequest', from, { oxyUserId: to, message: 'Hi!' });
  if (result.isError) throw new Error(JSON.stringify(result.error));
  return (result.structuredContent.data as { id: string }).id;
}

describe('preferences and matching', () => {
  it('reads status, toggles matching and updates preferences as the effective account', async () => {
    const toggled = await callTool('toggleRoommateMatching', ALICE, { enabled: true });
    expect(toggled.structuredContent).toEqual({ enabled: true });

    const updated = await callTool('updateRoommatePreferences', ALICE, {
      preferences: { budget: { min: 400, max: 800 } },
    });
    expect(updated.isError).toBe(false);

    const status = await callTool('getRoommateStatus', ALICE);
    expect(status.structuredContent).toMatchObject({
      hasRoommateMatching: true,
      profile: { oxyUserId: ALICE },
    });
    expect((await callTool('getRoommatePreferences', ALICE)).isError).toBe(false);
  });

  it('discovers candidates with matching enabled, never the caller', async () => {
    const result = await callTool('listRoommateProfiles', ALICE, { nonSmoking: false });
    expect(result.isError).toBe(false);
    const found = result.structuredContent.profiles as Array<{ oxyUserId: string }>;
    expect(found.map((entry) => entry.oxyUserId)).toContain(BOB);
    expect(found.map((entry) => entry.oxyUserId)).not.toContain(ALICE);
  });
});

describe('the request handshake', () => {
  it('sends a request and notifies the recipient through the dispatch chokepoint', async () => {
    const dispatch = jest.spyOn(notificationDispatchService, 'createForUser');
    await send();
    expect(dispatch).toHaveBeenCalledWith(BOB, expect.objectContaining({ type: 'roommate' }));
    const listed = await callTool('listRoommateRequests', BOB);
    expect((listed.structuredContent.data as { received: unknown[] }).received).toHaveLength(1);
  });

  it('refuses somebody without matching enabled, and oneself', async () => {
    expect(
      (await callTool('sendRoommateRequest', BOB, { oxyUserId: MALLORY })).error,
    ).toMatchObject({ status: 400 });
    expect(
      (await callTool('sendRoommateRequest', ALICE, { oxyUserId: ALICE })).error,
    ).toMatchObject({ status: 400 });
  });

  it('lets only the recipient answer; anybody else gets not-found', async () => {
    const requestId = await send();
    expect((await callTool('acceptRoommateRequest', ALICE, { requestId })).error).toMatchObject({
      status: 404,
    });
    expect((await callTool('acceptRoommateRequest', MALLORY, { requestId })).error).toMatchObject({
      status: 404,
    });
    const accepted = await callTool('acceptRoommateRequest', BOB, { requestId });
    expect(accepted.structuredContent).toMatchObject({ data: { status: 'accepted' } });

    const relationships = await callTool('listRoommateRelationships', ALICE);
    const [relationship] = relationships.structuredContent.data as Array<{ id: string }>;
    expect(relationship).toBeDefined();

    expect(
      (await callTool('endRoommateRelationship', MALLORY, { relationshipId: relationship.id }))
        .error,
    ).toMatchObject({ status: 404 });
    const ended = await callTool('endRoommateRelationship', ALICE, {
      relationshipId: relationship.id,
    });
    expect(ended.isError).toBe(false);
  });

  it('declines a received request', async () => {
    const requestId = await send();
    const declined = await callTool('declineRoommateRequest', BOB, { requestId });
    expect(declined.structuredContent).toMatchObject({ data: { status: 'declined' } });
  });

  it('replays a retried request for the same idempotency key: one request, one notification', async () => {
    const dispatch = jest.spyOn(notificationDispatchService, 'createForUser');
    const key = `rm-${uuidv7()}`;
    const first = await callTool(
      'sendRoommateRequest',
      ALICE,
      { oxyUserId: BOB },
      { idempotencyKey: key },
    );
    const second = await callTool(
      'sendRoommateRequest',
      ALICE,
      { oxyUserId: BOB },
      { idempotencyKey: key },
    );
    expect(first.isError).toBe(false);
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(await getDb().select().from(roommateRequests)).toHaveLength(1);
  });
});
