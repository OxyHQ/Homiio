/**
 * Conversation ordering across the id-shape boundary, against a REAL server.
 *
 * ## The bug this exists to catch, and why an ordinary fixture cannot
 *
 * Every primary key in `db/schema` is `text`, holding a 24-char ObjectId hex for
 * a row that existed before the cutover and a uuid v7 for one created after it.
 * Sorting by that column looks like sorting by creation time — for a table whose
 * rows all came from ONE of the two generations it even IS one, which is exactly
 * why a hand-written fixture passes against the wrong implementation.
 *
 * The two shapes interleave BACKWARDS. A uuid v7 minted now begins `0199…` (the
 * millisecond clock, hex, in the leading 48 bits); an ObjectId minted this year
 * begins `69…`/`6a…` (a 32-bit unix-seconds prefix). `'0' < '6'`, so a
 * lexicographic sort puts every NEW row before every LEGACY one, whatever their
 * real order — and the damage lands only on the rows that span the cutover.
 *
 * So each case below does three things, and the third is what makes it a real
 * check rather than one that cannot tell success from failure:
 *
 *  1. asserts the ordering the repository produces;
 *  2. computes what an ID sort would have produced;
 *  3. asserts those two DISAGREE.
 *
 * Without (3) the file would keep passing if somebody changed `order by
 * updated_at desc` to `order by id desc`, because a fixture whose ids happen to
 * agree with its timestamps cannot see the difference. `expectIdOrderIsWrong`
 * makes the fixture prove it is the adversarial one.
 */

import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import {
  appendMessages,
  listConversations,
  listMessages,
} from '../../db/conversations/conversationRepository';
import { conversationMessages, conversations } from '../../db/schema';
import { objectIdHex } from '../helpers/postgresGeoFixtures';

/**
 * A 24-char ObjectId hex, exactly as every pre-cutover row carries.
 *
 * The shared minter rather than a second local one: this file used
 * `new Types.ObjectId().toHexString()`, which was the last reason it imported
 * mongoose at all — it seeds nothing in Mongo. The property the cases below
 * actually rest on (a fresh ObjectId hex sorts AFTER a fresh uuid v7) is not
 * assumed either way; the first `describe` measures it.
 */
const legacyId = objectIdHex;

let db: Database;

/** A distinct owner per case, so no two can see each other's rows. */
const owner = (): string => `oxy-${uuidv7()}`;

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

/**
 * Assert that ordering the same rows by ID would have produced a DIFFERENT
 * sequence than the one under test.
 *
 * This is the anti-vacuity guard. If it ever fails, the FIXTURE stopped being
 * adversarial — not the code — and the fix is to change the fixture rather than
 * to delete the assertion.
 */
function expectIdOrderIsWrong(actualIds: readonly string[], direction: 'asc' | 'desc'): void {
  const byId = [...actualIds].sort((a, b) => (direction === 'asc' ? (a < b ? -1 : 1) : a < b ? 1 : -1));
  expect(byId).not.toEqual([...actualIds]);
}

describe('id shapes — the property every case below depends on', () => {
  it('sorts a fresh uuid v7 BEFORE a fresh ObjectId hex, lexicographically', () => {
    // Measured rather than assumed: this single fact is why ordering by the
    // primary key is wrong on every table in this migration.
    const uuid = uuidv7();
    const objectId = legacyId();
    expect(uuid < objectId).toBe(true);
    expect(uuid).toMatch(/^0/);
    expect(objectId).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('conversation_messages — ordered by position, never by id', () => {
  it('keeps a legacy turn before the uuid v7 turn that answers it', async () => {
    const oxyUserId = owner();
    const conversationId = legacyId();
    const now = new Date();
    await db.insert(conversations).values({
      id: conversationId,
      oxyUserId,
      title: 'A transcript that spans the cutover',
      analyticsLastActivity: now,
    });

    // The natural shape: the backfilled question carries its Mongo id, the reply
    // the user got after the cutover carries a fresh uuid v7. Position — and
    // therefore meaning — is question first.
    const legacyMessageId = legacyId();
    await db.insert(conversationMessages).values([
      {
        id: legacyMessageId,
        conversationId,
        role: 'user',
        content: 'Can my landlord raise the rent mid-contract?',
        timestamp: new Date(now.getTime() - 60_000),
        position: 0,
      },
    ]);
    const [reply] = await appendMessages(db, conversationId, [
      { role: 'assistant', content: 'Not without a clause that allows it.' },
    ]);

    expect(reply.id).toMatch(/^0/);
    expect(reply.position).toBe(1);

    const hydrated = await listMessages(db, conversationId);
    const ids = hydrated.map((entry) => entry.message.id);
    expect(ids).toEqual([legacyMessageId, reply.id]);
    expect(hydrated.map((entry) => entry.message.role)).toEqual(['user', 'assistant']);

    // An `order by id asc` would have hoisted the answer above its own question.
    expectIdOrderIsWrong(ids, 'asc');
  });

  it('orders by position even when the timestamps are identical', async () => {
    // `timestamp` defaults to `Date.now()` at millisecond resolution, so two
    // turns appended in one tick tie on it — which is the whole reason
    // `db/schema/conversations.ts` carries `position` at all.
    const oxyUserId = owner();
    const conversationId = uuidv7();
    const stamp = new Date();
    await db.insert(conversations).values({
      id: conversationId,
      oxyUserId,
      title: 'Same millisecond',
      analyticsLastActivity: stamp,
    });

    await db.insert(conversationMessages).values([
      { id: uuidv7(), conversationId, role: 'assistant', content: 'second', timestamp: stamp, position: 1 },
      { id: legacyId(), conversationId, role: 'user', content: 'first', timestamp: stamp, position: 0 },
    ]);

    const contents = (await listMessages(db, conversationId)).map((entry) => entry.message.content);
    expect(contents).toEqual(['first', 'second']);
  });
});

describe('conversations list — ordered by updated_at, with the id only a tiebreaker', () => {
  it('puts the recently-touched uuid v7 conversation above the older legacy one', async () => {
    const oxyUserId = owner();
    const olderLegacy = legacyId();
    const newerUuid = uuidv7();
    const base = new Date('2026-08-01T10:00:00.000Z');

    await db.insert(conversations).values([
      {
        id: olderLegacy,
        oxyUserId,
        title: 'Older, and backfilled',
        analyticsLastActivity: base,
        createdAt: base,
        updatedAt: base,
      },
      {
        id: newerUuid,
        oxyUserId,
        title: 'Newer, and created after the cutover',
        analyticsLastActivity: new Date(base.getTime() + 3_600_000),
        createdAt: new Date(base.getTime() + 3_600_000),
        updatedAt: new Date(base.getTime() + 3_600_000),
      },
    ]);

    const ids = (await listConversations(db, oxyUserId)).map((row) => row.conversation.id);
    expect(ids).toEqual([newerUuid, olderLegacy]);

    // `order by id desc` would have answered `[olderLegacy, newerUuid]`, i.e.
    // the stale conversation at the top of the sidebar for good.
    expectIdOrderIsWrong(ids, 'desc');
  });

  it('breaks a tie on updated_at with the id, so the order is stable across calls', async () => {
    const oxyUserId = owner();
    const stamp = new Date('2026-08-02T09:00:00.000Z');
    const ids = [legacyId(), uuidv7(), legacyId()];
    await db.insert(conversations).values(
      ids.map((id, index) => ({
        id,
        oxyUserId,
        title: `Tied ${index}`,
        analyticsLastActivity: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      })),
    );

    const first = (await listConversations(db, oxyUserId)).map((row) => row.conversation.id);
    const second = (await listConversations(db, oxyUserId)).map((row) => row.conversation.id);
    expect(first).toEqual(second);
    expect(first).toEqual([...ids].sort((a, b) => (a < b ? 1 : -1)));
  });
});

describe('listConversations — the two figures that stopped being stored', () => {
  it('counts messages and reports the LAST one by position, not by id', async () => {
    const oxyUserId = owner();
    const conversationId = legacyId();
    const now = new Date();
    await db.insert(conversations).values({
      id: conversationId,
      oxyUserId,
      title: 'Counted',
      analyticsLastActivity: now,
    });

    // Position 2 carries a LEGACY id and position 0 a uuid v7, so "the last
    // message" and "the greatest id" are different rows.
    const lastId = legacyId();
    await db.insert(conversationMessages).values([
      { id: uuidv7(), conversationId, role: 'user', content: 'one', timestamp: now, position: 0 },
      { id: uuidv7(), conversationId, role: 'assistant', content: 'two', timestamp: now, position: 1 },
      { id: lastId, conversationId, role: 'user', content: 'three', timestamp: now, position: 2 },
    ]);

    const [summary] = await listConversations(db, oxyUserId);
    expect(summary.messageCount).toBe(3);
    expect(summary.lastMessage?.content).toBe('three');
    expect(summary.lastMessage?.id).toBe(lastId);

    // The correlated subqueries must be QUALIFIED. An unqualified
    // `${conversations.id}` resolves against `conversation_messages`'s own `id`
    // inside the subquery and silently returns 0 with no error at all — the trap
    // `db/schema/CONVENTIONS.md` records. A non-zero count here is what
    // distinguishes the two.
    expect(summary.messageCount).toBeGreaterThan(0);
  });

  it('reports a conversation with no messages as count 0 and no last message', async () => {
    const oxyUserId = owner();
    await db.insert(conversations).values({
      id: uuidv7(),
      oxyUserId,
      title: 'Empty',
      analyticsLastActivity: new Date(),
    });

    const [summary] = await listConversations(db, oxyUserId);
    expect(summary.messageCount).toBe(0);
    expect(summary.lastMessage).toBeUndefined();
  });
});

describe('appendMessages — position is assigned, never guessed', () => {
  it('continues from the highest existing position, across id shapes', async () => {
    const oxyUserId = owner();
    const conversationId = legacyId();
    const now = new Date();
    await db.insert(conversations).values({
      id: conversationId,
      oxyUserId,
      title: 'Continued',
      analyticsLastActivity: now,
    });
    await db
      .insert(conversationMessages)
      .values({ id: legacyId(), conversationId, role: 'user', content: 'backfilled', timestamp: now, position: 7 });

    const appended = await appendMessages(db, conversationId, [
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
    expect(appended.map((row) => row.position)).toEqual([8, 9]);

    const stored = await db
      .select({ position: conversationMessages.position })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.position));
    expect(stored.map((row) => row.position)).toEqual([7, 8, 9]);
  });

  it('moves analytics.last_activity, which is the hook the Mongo pre-save was', async () => {
    const oxyUserId = owner();
    const conversationId = uuidv7();
    const stale = new Date('2026-07-01T00:00:00.000Z');
    await db.insert(conversations).values({
      id: conversationId,
      oxyUserId,
      title: 'Stamped',
      analyticsLastActivity: stale,
    });

    await appendMessages(db, conversationId, [{ role: 'user', content: 'hello' }]);

    const [row] = await db
      .select({ lastActivity: conversations.analyticsLastActivity })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    expect(row.lastActivity.getTime()).toBeGreaterThan(stale.getTime());
  });
});
