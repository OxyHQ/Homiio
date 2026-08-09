/**
 * Applying a paid Checkout session, against a REAL Postgres server.
 *
 * `billingRepository.test.ts` covers the primitives this builds on —
 * `ensureBilling`, `consumeFileCredit`, `setPlusActive`, `claimStripeSession`.
 * This file covers what the Stripe controller needs on top of them: the claim
 * and the credit committing TOGETHER, the two webhook lookups by Stripe id, and
 * the entitlements projection.
 *
 * A mocked drizzle cannot express any of it: the guarantees are a real unique
 * index, a real transaction, and a real SAVEPOINT.
 */

import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';

import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import {
  creditCheckoutSession,
  deactivateSubscriptionByStripeId,
  ensureBilling,
  findBillingByOxyUserId,
  readEntitlements,
  recordSubscriptionPayment,
} from '../../db/billing/billingRepository';
import { billing, billingProcessedSessions } from '../../db/schema';

let db: Database;

/** A distinct account per test, so parallel workers and reruns never collide. */
const account = (): string => `oxy-${uuidv7()}`;
const stripeId = (prefix: string): string => `${prefix}_${uuidv7().replace(/-/g, '')}`;

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

describe('ensureBilling survives being called inside a transaction', () => {
  /**
   * The bug this pins is not hypothetical and not rare — it is EVERY payment
   * after an account's first.
   *
   * `ensureBilling` inserts and handles `23505` by reading the row back. In
   * Postgres a failed statement aborts the WHOLE transaction, so that recovery
   * read works on the root connection — where each statement is its own implicit
   * transaction — and dies with `25P02 current_transaction_is_aborted` inside
   * one. `creditCheckoutSession` opens a transaction (the claim and the credit
   * must commit together) and calls it, so without a SAVEPOINT the second
   * payment by any existing subscriber 500s.
   *
   * `inSavepoint` is what makes the conflict unwind only to the savepoint. The
   * assertion is that the transaction is still USABLE afterwards, not merely
   * that `ensureBilling` returned.
   */
  it('leaves the caller transaction usable after a conflicting insert', async () => {
    const oxyUserId = account();
    const first = await ensureBilling(oxyUserId);

    const [again, stillWorks] = await db.transaction(async (tx) => {
      const row = await ensureBilling(oxyUserId, tx);
      // A statement AFTER the conflict. On an aborted transaction this raises
      // `25P02`, which is the whole failure mode.
      const [probe] = await tx
        .select({ id: billing.id })
        .from(billing)
        .where(eq(billing.oxyUserId, oxyUserId));
      return [row, probe] as const;
    });

    expect(again.id).toBe(first.id);
    expect(stillWorks.id).toBe(first.id);
  });
});

describe('creditCheckoutSession applies a session exactly once', () => {
  it('grants a file credit, then treats the redelivery as a no-op', async () => {
    const oxyUserId = account();
    const sessionId = stripeId('cs');

    expect(await creditCheckoutSession({ oxyUserId, sessionId, product: 'file' })).toBe(true);
    expect((await findBillingByOxyUserId(oxyUserId))?.fileCredits).toBe(1);

    expect(await creditCheckoutSession({ oxyUserId, sessionId, product: 'file' })).toBe(false);
    expect((await findBillingByOxyUserId(oxyUserId))?.fileCredits).toBe(1);
  });

  /**
   * Two deliveries arriving AT ONCE, which is the case the Mongo
   * read-modify-write of `processedSessions[]` could not survive: both read an
   * array without the session, both appended, both saved, and the account was
   * credited twice for one payment.
   */
  it('credits once when two deliveries race', async () => {
    const oxyUserId = account();
    const sessionId = stripeId('cs');

    const results = await Promise.all([
      creditCheckoutSession({ oxyUserId, sessionId, product: 'file' }),
      creditCheckoutSession({ oxyUserId, sessionId, product: 'file' }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await findBillingByOxyUserId(oxyUserId))?.fileCredits).toBe(1);
  });

  /**
   * The claim and the credit are in ONE transaction, so a session that was NOT
   * claimed must leave the balance untouched. A fixture crediting a fresh
   * account could not tell "skipped" from "applied to a zero balance", so this
   * one already holds a credit from a DIFFERENT session.
   */
  it('leaves the balance alone when the session was already spent', async () => {
    const oxyUserId = account();
    const spent = stripeId('cs');
    await creditCheckoutSession({ oxyUserId, sessionId: spent, product: 'file' });
    await creditCheckoutSession({ oxyUserId, sessionId: stripeId('cs'), product: 'file' });
    expect((await findBillingByOxyUserId(oxyUserId))?.fileCredits).toBe(2);

    expect(await creditCheckoutSession({ oxyUserId, sessionId: spent, product: 'file' })).toBe(
      false,
    );
    expect((await findBillingByOxyUserId(oxyUserId))?.fileCredits).toBe(2);
  });

  it('activates Plus and records the Stripe subscription id', async () => {
    const oxyUserId = account();
    const subscriptionId = stripeId('sub');

    await creditCheckoutSession({
      oxyUserId,
      sessionId: stripeId('cs'),
      product: 'plus',
      stripeSubscriptionId: subscriptionId,
    });

    const record = await findBillingByOxyUserId(oxyUserId);
    expect(record?.plusActive).toBe(true);
    expect(record?.plusStripeSubscriptionId).toBe(subscriptionId);
    expect(record?.fileCredits).toBe(0);
  });

  /**
   * The manual-activation fallback carries no Stripe evidence, so it credits
   * `plus` with no subscription id — and must not ERASE the one a real delivery
   * recorded. A fixture that never set an id first could not tell "left alone"
   * from "written NULL".
   */
  it('does not erase a recorded subscription id when a later credit carries none', async () => {
    const oxyUserId = account();
    const subscriptionId = stripeId('sub');
    await creditCheckoutSession({
      oxyUserId,
      sessionId: stripeId('cs'),
      product: 'plus',
      stripeSubscriptionId: subscriptionId,
    });

    await creditCheckoutSession({ oxyUserId, sessionId: stripeId('cs'), product: 'plus' });

    expect((await findBillingByOxyUserId(oxyUserId))?.plusStripeSubscriptionId).toBe(
      subscriptionId,
    );
  });

  it('founder sets the supporter flag without touching Plus or credits', async () => {
    const oxyUserId = account();
    await creditCheckoutSession({ oxyUserId, sessionId: stripeId('cs'), product: 'founder' });

    const record = await findBillingByOxyUserId(oxyUserId);
    expect(record?.founderSupporter).toBe(true);
    expect(record?.founderSince).toBeInstanceOf(Date);
    expect(record?.plusActive).toBe(false);
    expect(record?.fileCredits).toBe(0);
  });

  /**
   * The credit must not land without its claim either. Asserted through the row
   * version: a second call writes NOTHING at all — no tuple version, no
   * timestamp — which is what `ON CONFLICT DO NOTHING` buys and what `DO UPDATE`
   * would silently take away.
   */
  it('writes no new row version on a redelivery', async () => {
    const oxyUserId = account();
    const sessionId = stripeId('cs');
    await creditCheckoutSession({ oxyUserId, sessionId, product: 'file' });

    const [before] = await db
      .select({ updatedAt: billing.updatedAt, xmin: sql<string>`xmin::text` })
      .from(billing)
      .where(eq(billing.oxyUserId, oxyUserId));

    // Long enough that a timestamp rewrite is unambiguously visible.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await creditCheckoutSession({ oxyUserId, sessionId, product: 'file' });

    const [after] = await db
      .select({ updatedAt: billing.updatedAt, xmin: sql<string>`xmin::text` })
      .from(billing)
      .where(eq(billing.oxyUserId, oxyUserId));

    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.xmin).toBe(before.xmin);
  });
});

describe('the two webhook lookups by Stripe id', () => {
  it('deactivates the record holding that subscription, keeping the id', async () => {
    const oxyUserId = account();
    const subscriptionId = stripeId('sub');
    await creditCheckoutSession({
      oxyUserId,
      sessionId: stripeId('cs'),
      product: 'plus',
      stripeSubscriptionId: subscriptionId,
    });

    const canceledAt = new Date();
    expect(await deactivateSubscriptionByStripeId(subscriptionId, canceledAt)).toBe(1);

    const record = await findBillingByOxyUserId(oxyUserId);
    expect(record?.plusActive).toBe(false);
    expect(record?.plusCanceledAt?.getTime()).toBe(canceledAt.getTime());
    // The id SURVIVES: sync and reactivate both look the subscription up by it.
    expect(record?.plusStripeSubscriptionId).toBe(subscriptionId);
  });

  it('reports zero for a subscription this deployment does not hold', async () => {
    expect(await deactivateSubscriptionByStripeId(stripeId('sub'), new Date())).toBe(0);
  });

  /**
   * `recordSubscriptionPayment` is scoped to ACTIVE records: an invoice paid
   * against a subscription Homiio believes is cancelled must not silently revive
   * it.
   *
   * The fixture has to sit on the side of the distinction — a CANCELLED record
   * is what makes a scoped and an unscoped statement disagree. A suite testing
   * only the active case would pass with the `plus_active` predicate deleted.
   */
  it('stamps an ACTIVE subscription and leaves a cancelled one alone', async () => {
    const activeUser = account();
    const activeSub = stripeId('sub');
    await creditCheckoutSession({
      oxyUserId: activeUser,
      sessionId: stripeId('cs'),
      product: 'plus',
      stripeSubscriptionId: activeSub,
    });

    const cancelledUser = account();
    const cancelledSub = stripeId('sub');
    await creditCheckoutSession({
      oxyUserId: cancelledUser,
      sessionId: stripeId('cs'),
      product: 'plus',
      stripeSubscriptionId: cancelledSub,
    });
    await deactivateSubscriptionByStripeId(cancelledSub, new Date());
    const cancelledBefore = await findBillingByOxyUserId(cancelledUser);

    const paidAt = new Date();
    expect(await recordSubscriptionPayment(activeSub, paidAt)).toBe(1);
    expect(await recordSubscriptionPayment(cancelledSub, paidAt)).toBe(0);

    expect((await findBillingByOxyUserId(activeUser))?.lastPaymentAt?.getTime()).toBe(
      paidAt.getTime(),
    );
    expect((await findBillingByOxyUserId(cancelledUser))?.lastPaymentAt?.getTime()).toBe(
      cancelledBefore?.lastPaymentAt?.getTime(),
    );
  });
});

describe('readEntitlements', () => {
  it('answers null for an account that has never paid, and creates nothing', async () => {
    const oxyUserId = account();
    expect(await readEntitlements(oxyUserId)).toBeNull();
    expect(await findBillingByOxyUserId(oxyUserId)).toBeNull();
  });

  /**
   * The ORDER BY, pinned against a fixture that can actually fail without it.
   *
   * Crediting three sessions in sequence would NOT do it: the rows are inserted
   * in the order they are read back anyway, so a query with no `ORDER BY` — which
   * returns physical order on a small table — agrees with the sorted answer and
   * the check is vacuous. Worse, three credits can land in the same millisecond
   * (`processed_at` is truncated to millisecond precision), and then the tie is
   * broken by the random `session_id` rather than by insertion order, so the
   * naive version is flaky in BOTH directions.
   *
   * So the rows are written directly with explicit, well-separated timestamps in
   * REVERSE order: physical order is now the opposite of `processed_at` order,
   * which is exactly the shape that makes an unordered read, a `DESC` read and
   * the correct read three different answers.
   */
  it('lists the processed sessions oldest first', async () => {
    const oxyUserId = account();
    const record = await ensureBilling(oxyUserId);
    const oldest = stripeId('cs');
    const middle = stripeId('cs');
    const newest = stripeId('cs');

    await db.insert(billingProcessedSessions).values([
      { billingId: record.id, sessionId: newest, processedAt: new Date(3_000_000) },
      { billingId: record.id, sessionId: middle, processedAt: new Date(2_000_000) },
      { billingId: record.id, sessionId: oldest, processedAt: new Date(1_000_000) },
    ]);

    const entitlements = await readEntitlements(oxyUserId);
    expect(entitlements?.processedSessions).toEqual([oldest, middle, newest]);
  });

  it('reports the credits alongside the sessions', async () => {
    const oxyUserId = account();
    await creditCheckoutSession({ oxyUserId, sessionId: stripeId('cs'), product: 'file' });
    await creditCheckoutSession({ oxyUserId, sessionId: stripeId('cs'), product: 'file' });

    const entitlements = await readEntitlements(oxyUserId);
    expect(entitlements?.fileCredits).toBe(2);
    expect(entitlements?.processedSessions).toHaveLength(2);
  });

  it('carries no Mongo baggage', async () => {
    const oxyUserId = account();
    await ensureBilling(oxyUserId);

    const entitlements = await readEntitlements(oxyUserId);
    expect(entitlements).not.toHaveProperty('_id');
    expect(entitlements).not.toHaveProperty('__v');
    expect(entitlements?.id).toEqual(expect.any(String));
  });
});
