/**
 * The billing repository, against a REAL Postgres.
 *
 * ## What this suite is FOR
 *
 * `BillingSchema` carried a `pre('save')` hook and six instance methods. A
 * Mongoose hook has no Postgres counterpart and vanishes silently — invisible
 * in a schema diff, to `tsc`, and to any suite that only supplies valid input,
 * because a rule that refuses bad input is unseen by every test that supplies
 * good input. So each case below is written against the RULE the hook enforced,
 * not against the happy path:
 *
 *  - the hook refused a second record per user → asserted by racing two
 *    creates, not by creating one;
 *  - `consumeFileCredit` refused to spend what was not there → asserted by
 *    spending concurrently, which is the case a read-then-write loses;
 *  - `addProcessedSession` was idempotent → asserted by claiming twice AND by
 *    checking the row did not move.
 *
 * A mocked drizzle cannot reproduce any of them: there is no unique index to
 * violate, no predicate for a concurrent update to lose against, and no `xmin`.
 */

import { eq, sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { billing, billingProcessedSessions } from '../../db/schema';
import {
  addFileCredits,
  claimStripeSession,
  consumeFileCredit,
  ensureBilling,
  findBillingByOxyUserId,
  findBillingByStripeSubscriptionId,
  isStripeSessionProcessed,
  listActiveSubscriptions,
  listProcessedSessions,
  setPlusActive,
} from '../../db/billing/billingRepository';

const OXY_USER = 'oxy-billing-subject';

beforeEach(async () => {
  await getDb().delete(billingProcessedSessions);
  await getDb().delete(billing);
});

describe('billing repository', () => {
  it('creates a record on first sight and returns the same one afterwards', async () => {
    const first = await ensureBilling(OXY_USER);
    const second = await ensureBilling(OXY_USER);

    expect(second.id).toBe(first.id);
    expect(first.plusActive).toBe(false);
    expect(first.fileCredits).toBe(0);

    const rows = await getDb().select({ id: billing.id }).from(billing);
    expect(rows).toHaveLength(1);
  });

  it('keeps ONE record when two creates race', async () => {
    // The `pre('save')` hook did `findOne` then threw — a check with a window
    // between it and the insert, so two concurrent first payments could both
    // pass it. `billing_oxy_user_id_key` closes that window; this is the case
    // that tells the index from the check.
    const [a, b] = await Promise.all([ensureBilling(OXY_USER), ensureBilling(OXY_USER)]);

    expect(a.id).toBe(b.id);
    const rows = await getDb().select({ id: billing.id }).from(billing);
    expect(rows).toHaveLength(1);
  });

  it('spends a credit once, even when two requests spend at the same time', async () => {
    // The defect a read-modify-write has: both readers see 1, both write 0, and
    // one credit pays for two files. The guarded UPDATE cannot do that.
    await ensureBilling(OXY_USER);
    await addFileCredits(OXY_USER, 1);

    const [first, second] = await Promise.all([
      consumeFileCredit(OXY_USER),
      consumeFileCredit(OXY_USER),
    ]);

    const consumed = [first, second].filter((result) => result.consumed);
    expect(consumed).toHaveLength(1);

    const record = await findBillingByOxyUserId(OXY_USER);
    expect(record?.fileCredits).toBe(0);
  });

  it('refuses to spend when there are no credits', async () => {
    await ensureBilling(OXY_USER);

    const result = await consumeFileCredit(OXY_USER);

    expect(result).toEqual({ consumed: false, remaining: 0, reason: 'no_credits' });
    // And never below zero — `billing_file_credits_non_negative_check` is the
    // backstop, but the predicate is what stops it being reached.
    expect((await findBillingByOxyUserId(OXY_USER))?.fileCredits).toBe(0);
  });

  it('spends nothing for a Plus member', async () => {
    await ensureBilling(OXY_USER);
    await addFileCredits(OXY_USER, 3);
    await setPlusActive(OXY_USER, { active: true });

    expect(await consumeFileCredit(OXY_USER)).toEqual({ consumed: false, remaining: 'unlimited' });
    // The credits are untouched, not merely unreported.
    expect((await findBillingByOxyUserId(OXY_USER))?.fileCredits).toBe(3);
  });

  it('records and clears a subscription across the Plus lifecycle', async () => {
    await ensureBilling(OXY_USER);

    await setPlusActive(OXY_USER, { active: true, stripeSubscriptionId: 'sub_123' });
    const active = await findBillingByOxyUserId(OXY_USER);
    expect(active?.plusActive).toBe(true);
    expect(active?.plusStripeSubscriptionId).toBe('sub_123');
    expect(active?.plusSince).toBeInstanceOf(Date);
    expect(await findBillingByStripeSubscriptionId('sub_123')).not.toBeNull();
    expect(await listActiveSubscriptions()).toHaveLength(1);

    await setPlusActive(OXY_USER, { active: false });
    const cancelled = await findBillingByOxyUserId(OXY_USER);
    expect(cancelled?.plusActive).toBe(false);
    // The id is CLEARED, not left behind: a stale subscription id is what makes
    // a webhook for somebody else's subscription land on this record.
    expect(cancelled?.plusStripeSubscriptionId).toBeNull();
    expect(cancelled?.plusCanceledAt).toBeInstanceOf(Date);
    expect(await findBillingByStripeSubscriptionId('sub_123')).toBeNull();
    expect(await listActiveSubscriptions()).toHaveLength(0);
  });

  it('claims a Stripe session exactly once', async () => {
    const record = await ensureBilling(OXY_USER);

    expect(await claimStripeSession(record.id, 'cs_1')).toBe(true);
    expect(await claimStripeSession(record.id, 'cs_1')).toBe(false);
    expect(await isStripeSessionProcessed(record.id, 'cs_1')).toBe(true);
    expect(await listProcessedSessions(record.id)).toEqual(['cs_1']);
  });

  it('writes NOTHING on a repeat claim, not merely the same values', async () => {
    // Stripe retries deliveries by design, so a repeat is ordinary rather than
    // exceptional. `ON CONFLICT DO NOTHING` is a structural no-op: no tuple
    // version, no timestamp, no lock. `xmin` is what tells that apart from a
    // `DO UPDATE` careful enough to write the same values back — which WOULD
    // move it, and would take a row lock the dedupe store does not need.
    const record = await ensureBilling(OXY_USER);
    await claimStripeSession(record.id, 'cs_retry');

    const [before] = await getDb()
      .select({ xmin: sql<string>`xmin::text` })
      .from(billingProcessedSessions)
      .where(eq(billingProcessedSessions.sessionId, 'cs_retry'));

    expect(await claimStripeSession(record.id, 'cs_retry')).toBe(false);

    const [after] = await getDb()
      .select({ xmin: sql<string>`xmin::text` })
      .from(billingProcessedSessions)
      .where(eq(billingProcessedSessions.sessionId, 'cs_retry'));

    expect(after.xmin).toBe(before.xmin);
  });

  it('scopes a claim to its own record', async () => {
    // `UNIQUE(billing_id, session_id)`, not `UNIQUE(session_id)` — the same
    // session id under a different record is a different claim, and a repository
    // that keyed on the session alone would silently drop the second person's.
    const mine = await ensureBilling(OXY_USER);
    const theirs = await ensureBilling('oxy-someone-else');

    expect(await claimStripeSession(mine.id, 'cs_shared')).toBe(true);
    expect(await claimStripeSession(theirs.id, 'cs_shared')).toBe(true);
    expect(await isStripeSessionProcessed(mine.id, 'cs_shared')).toBe(true);
    expect(await isStripeSessionProcessed(theirs.id, 'cs_shared')).toBe(true);
  });

  it('answers null for a person who has never paid', async () => {
    expect(await findBillingByOxyUserId('oxy-never-paid')).toBeNull();
  });
});
