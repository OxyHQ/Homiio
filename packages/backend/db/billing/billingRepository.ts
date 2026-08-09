/**
 * The billing repository — one row per Oxy user, plus the Stripe sessions
 * already applied to it.
 *
 * Ported from `models/schemas/BillingSchema.ts`, whose behaviour lived in six
 * instance methods, three statics and a `pre('save')` hook. Each is accounted
 * for below rather than left to be noticed missing: a Mongoose hook has no
 * Postgres counterpart and vanishes silently — invisible in a schema diff, to
 * `tsc`, and to any suite that only supplies valid input.
 *
 * | Mongoose | here |
 * |---|---|
 * | `pre('save')` refusing a second record per user | `billing_oxy_user_id_key`, and {@link ensureBilling} handles the violation |
 * | `findByOxyUserId` / `findByStripeSubscriptionId` / `findActiveSubscriptions` | the three finders below |
 * | `addFileCredit` | {@link addFileCredits}, incremented IN SQL |
 * | `consumeFileCredit` | {@link consumeFileCredit}, a guarded atomic decrement |
 * | `activatePlus` / `deactivatePlus` | {@link setPlusActive} |
 * | `addProcessedSession` / `isSessionProcessed` | {@link claimStripeSession} |
 *
 * ## The hook was a read-then-write, and the index is strictly stronger
 *
 * `pre('save')` did `findOne({ oxyUserId })` and threw if it found one — a
 * check with a window between it and the insert, so two concurrent first
 * payments for the same user could both pass it. `billing_oxy_user_id_key`
 * closes that window, and {@link ensureBilling} INSERTs and handles `23505`
 * rather than re-implementing the read. So the rule survives the port and gets
 * a guarantee it never had.
 *
 * ## Credits are changed IN SQL, never read-modify-written
 *
 * `addFileCredit`/`consumeFileCredit` mutated a loaded document and saved it.
 * Two concurrent consumes could each read `1` and each write `0`, spending one
 * credit twice. Both are single statements here, and the decrement carries its
 * own `file_credits > 0` predicate so the guard and the write cannot
 * interleave. `billing_file_credits_non_negative_check` is the backstop
 * underneath, not the mechanism.
 */

import { and, eq, gt, sql } from 'drizzle-orm';

import { getDb, inSavepoint } from '../postgres';
import { billing, billingProcessedSessions } from '../schema';
import { isUniqueViolation } from '../uniqueViolation';
import type { DatabaseOrTransaction } from '../postgres';

export type BillingRow = typeof billing.$inferSelect;

/** One person's billing record, or null when they have never had one. */
export async function findBillingByOxyUserId(
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<BillingRow | null> {
  const [row] = await db.select().from(billing).where(eq(billing.oxyUserId, oxyUserId)).limit(1);
  return row ?? null;
}

/** The record a Stripe subscription belongs to — the webhook's entry point. */
export async function findBillingByStripeSubscriptionId(
  subscriptionId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<BillingRow | null> {
  const [row] = await db
    .select()
    .from(billing)
    .where(eq(billing.plusStripeSubscriptionId, subscriptionId))
    .limit(1);
  return row ?? null;
}

/** Every record currently on Plus. */
export async function listActiveSubscriptions(
  db: DatabaseOrTransaction = getDb(),
): Promise<BillingRow[]> {
  return db.select().from(billing).where(eq(billing.plusActive, true));
}

/**
 * The caller's record, created empty on first sight.
 *
 * INSERT-then-handle-`23505` rather than check-then-insert: the check is the
 * race the unique index exists to close, and re-implementing it here would
 * reintroduce it. A conflict means somebody else created the row a moment ago,
 * which is success — so the row is read back rather than raised.
 */
export async function ensureBilling(
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<BillingRow> {
  try {
    // The insert runs in a SAVEPOINT, and that is not defensive tidiness. In
    // Postgres a failed statement aborts the WHOLE transaction, so catching
    // `23505` and reading the row back works on the root connection — where each
    // statement is its own implicit transaction — and dies with `25P02
    // current_transaction_is_aborted` inside one. {@link creditCheckoutSession}
    // is the caller that made that real: it must claim the session and apply the
    // payment atomically, so it opens a transaction and this runs inside it.
    // `inSavepoint` issues a real SAVEPOINT / ROLLBACK TO SAVEPOINT on a
    // transaction handle and a plain BEGIN/COMMIT on the root connection, so ONE
    // spelling serves both callers — the same lesson `findOrCreateAgencyByName`
    // learned the moment it got a transactional caller.
    const [created] = await inSavepoint(db, (tx) =>
      tx.insert(billing).values({ oxyUserId }).returning(),
    );
    return created;
  } catch (error) {
    if (!isUniqueViolation(error, 'billing_oxy_user_id_key')) throw error;
    const existing = await findBillingByOxyUserId(oxyUserId, db);
    if (!existing) {
      // The insert was refused for a duplicate that is then not there: not a
      // race, a broken invariant, and it must surface rather than loop.
      throw new Error(`Billing row for ${oxyUserId} conflicted but could not be read back`);
    }
    return existing;
  }
}

/** Grant file credits and stamp the payment. Returns the updated record. */
export async function addFileCredits(
  oxyUserId: string,
  amount: number,
  db: DatabaseOrTransaction = getDb(),
): Promise<BillingRow | null> {
  const [row] = await db
    .update(billing)
    .set({
      fileCredits: sql`${billing.fileCredits} + ${amount}`,
      lastPaymentAt: new Date(),
    })
    .where(eq(billing.oxyUserId, oxyUserId))
    .returning();
  return row ?? null;
}

/** What a consume attempt did. `remaining` is `'unlimited'` for a Plus member. */
export type ConsumeResult =
  | { consumed: false; remaining: 'unlimited' }
  | { consumed: true; remaining: number }
  | { consumed: false; remaining: 0; reason: 'no_credits' };

/**
 * Spend one file credit.
 *
 * Plus members consume nothing — checked first, and read from the row rather
 * than trusted from the caller. Otherwise ONE statement decrements under a
 * `file_credits > 0` predicate: no row updated means there was nothing to
 * spend, which is how "out of credits" is detected without a separate read
 * that another request could invalidate in between.
 */
export async function consumeFileCredit(
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ConsumeResult> {
  const record = await findBillingByOxyUserId(oxyUserId, db);
  if (record?.plusActive) return { consumed: false, remaining: 'unlimited' };

  const [row] = await db
    .update(billing)
    .set({ fileCredits: sql`${billing.fileCredits} - 1` })
    .where(and(eq(billing.oxyUserId, oxyUserId), gt(billing.fileCredits, 0)))
    .returning({ fileCredits: billing.fileCredits });

  if (!row) return { consumed: false, remaining: 0, reason: 'no_credits' };
  return { consumed: true, remaining: row.fileCredits };
}

/**
 * Turn Plus on or off.
 *
 * Activating stamps `plus_since` and `last_payment_at` and records the
 * subscription id; deactivating clears the id and stamps `plus_canceled_at`.
 * One function rather than two, because they write the same set of columns and
 * splitting them is how the two halves drift into disagreeing about which
 * columns belong to the state.
 */
export async function setPlusActive(
  oxyUserId: string,
  input: { active: true; stripeSubscriptionId?: string } | { active: false },
  db: DatabaseOrTransaction = getDb(),
): Promise<BillingRow | null> {
  const now = new Date();
  const columns = input.active
    ? {
        plusActive: true,
        plusSince: now,
        lastPaymentAt: now,
        plusCanceledAt: null,
        ...(input.stripeSubscriptionId === undefined
          ? {}
          : { plusStripeSubscriptionId: input.stripeSubscriptionId }),
      }
    : {
        plusActive: false,
        plusStripeSubscriptionId: null,
        plusCanceledAt: now,
      };

  const [row] = await db
    .update(billing)
    .set(columns)
    .where(eq(billing.oxyUserId, oxyUserId))
    .returning();
  return row ?? null;
}

/**
 * Claim a Stripe session for this record, exactly once.
 *
 * The Stripe webhook dedupe store. `ON CONFLICT DO NOTHING` plus an empty vs
 * one-row `RETURNING` IS the answer — a repeat writes nothing at all: no tuple
 * version, no timestamp, no lock. That is a structural no-op rather than one
 * that depends on writing the same values back, which matters because a repeat
 * is ORDINARY here (Stripe retries deliveries by design).
 *
 * The conflict is deliberately not caught as an error: a real failure — a
 * dropped connection, an exhausted pool — still propagates instead of being
 * read as "already processed", which would silently drop a payment.
 *
 * @returns `true` when this call claimed it, `false` when it was already
 *   claimed. The caller applies the payment only on `true`.
 */
export async function claimStripeSession(
  billingId: string,
  sessionId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const claimed = await db
    .insert(billingProcessedSessions)
    .values({ billingId, sessionId })
    .onConflictDoNothing()
    .returning({ id: billingProcessedSessions.id });
  return claimed.length > 0;
}

/** Whether a session has already been applied to this record. */
export async function isStripeSessionProcessed(
  billingId: string,
  sessionId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const rows = await db
    .select({ id: billingProcessedSessions.id })
    .from(billingProcessedSessions)
    .where(
      and(
        eq(billingProcessedSessions.billingId, billingId),
        eq(billingProcessedSessions.sessionId, sessionId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Every session id applied to a record, for the entitlements projection.
 *
 * Ordered oldest first, so the field is stable between two reads of an unchanged
 * record: without an `ORDER BY` Postgres may return the rows in any order it
 * likes, which turns a cached client response into a spurious diff.
 */
export async function listProcessedSessions(
  billingId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<string[]> {
  const rows = await db
    .select({ sessionId: billingProcessedSessions.sessionId })
    .from(billingProcessedSessions)
    .where(eq(billingProcessedSessions.billingId, billingId))
    .orderBy(billingProcessedSessions.processedAt, billingProcessedSessions.sessionId);
  return rows.map((row) => row.sessionId);
}

/**
 * Mark a subscription cancelled, found by STRIPE's id.
 *
 * The webhook knows the subscription and not the account, and
 * `billing_plus_stripe_subscription_id_key` is unique so this matches at most
 * one row — written as a plain predicate rather than a single-row update, so the
 * statement does not depend on that being true.
 *
 * Deliberately NOT {@link setPlusActive}`(…, {active: false})`, which also
 * CLEARS `plus_stripe_subscription_id`: `syncSubscriptionStatus` and
 * `reactivateSubscription` both look the subscription up by that id afterwards,
 * so erasing it here would strand a cancelled subscriber with no way back.
 *
 * @returns How many records were affected, so a handler can tell "no such
 *   subscription here" from "done".
 */
export async function deactivateSubscriptionByStripeId(
  subscriptionId: string,
  canceledAt: Date,
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const rows = await db
    .update(billing)
    .set({ plusActive: false, plusCanceledAt: canceledAt })
    .where(eq(billing.plusStripeSubscriptionId, subscriptionId))
    .returning({ id: billing.id });
  return rows.length;
}

/**
 * Stamp a successful renewal, found by Stripe's id.
 *
 * Scoped to ACTIVE records verbatim from the Mongo handler: an invoice paid
 * against a subscription Homiio already believes is cancelled must not silently
 * revive it, and reconciling that disagreement is `syncSubscriptionStatus`'s
 * job, which reads Stripe rather than inferring from one event.
 *
 * The scope is IN the statement rather than a preceding read, so the check and
 * the write cannot interleave.
 */
export async function recordSubscriptionPayment(
  subscriptionId: string,
  paidAt: Date,
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const rows = await db
    .update(billing)
    .set({ lastPaymentAt: paidAt })
    .where(
      and(eq(billing.plusStripeSubscriptionId, subscriptionId), eq(billing.plusActive, true)),
    )
    .returning({ id: billing.id });
  return rows.length;
}

/** A billing record plus the sessions applied to it — the `entitlements` payload. */
export type BillingEntitlements = BillingRow & { processedSessions: string[] };

/**
 * The `entitlements` object every billing surface answers with.
 *
 * ONE projection, because there are nine handlers that return it — the profile
 * router, the confirm redirect, manual activate and cancel, sync, the Stripe
 * cancel and reactivate, and the debug endpoint. Under Mongo each assembled its
 * own (`toObject()`, a `.lean()` document, or a literal), which is how they
 * drifted apart.
 *
 * `null` when the account has never paid. A read never CREATES the row: the
 * record is minted by a payment, so answering a page view by writing one would
 * put a write on every load and make "has this account ever paid?" unanswerable.
 */
export async function readEntitlements(
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<BillingEntitlements | null> {
  const record = await findBillingByOxyUserId(oxyUserId, db);
  if (!record) return null;
  return { ...record, processedSessions: await listProcessedSessions(record.id, db) };
}

/** The three things a Homiio Checkout session can buy. */
export type CheckoutProduct = 'plus' | 'file' | 'founder';

/**
 * Apply one paid Checkout session, exactly once.
 *
 * The claim and the entitlement it buys commit TOGETHER, so a delivery that dies
 * between them credits nothing rather than crediting without recording that it
 * did. Every caller — the Stripe webhook, the post-redirect confirm endpoint and
 * the manual-activation fallback — routes through here, which is what makes
 * "Stripe delivered this twice" and "the user pressed the button twice" the same
 * question with the same answer. Under Mongo those were three independently
 * written copies of one guard.
 *
 * @param stripeSubscriptionId Passed through to {@link setPlusActive}, which
 *   leaves the stored id alone when this is absent — so the manual fallback,
 *   which has no Stripe evidence to carry, cannot erase what a real delivery
 *   recorded.
 * @returns `true` when this call applied the payment, `false` when the session
 *   had already been spent.
 */
export async function creditCheckoutSession(
  input: {
    oxyUserId: string;
    sessionId: string;
    product: CheckoutProduct;
    stripeSubscriptionId?: string;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const record = await ensureBilling(input.oxyUserId, tx);
    if (!(await claimStripeSession(record.id, input.sessionId, tx))) return false;

    switch (input.product) {
      case 'file':
        await addFileCredits(input.oxyUserId, 1, tx);
        return true;
      case 'plus':
        await setPlusActive(
          input.oxyUserId,
          {
            active: true,
            ...(input.stripeSubscriptionId === undefined
              ? {}
              : { stripeSubscriptionId: input.stripeSubscriptionId }),
          },
          tx,
        );
        return true;
      case 'founder': {
        const now = new Date();
        await updateBilling(
          input.oxyUserId,
          { founderSupporter: true, founderSince: now, lastPaymentAt: now },
          tx,
        );
        return true;
      }
    }
  });
}

/**
 * Apply an explicit column set to one record.
 *
 * The escape hatch for the handful of Stripe lifecycle writes that do not fit a
 * named operation above (recording a customer id, a period end, a cancellation
 * flag). Takes an explicit column object — never a request body — so it cannot
 * become a mass-assignment surface.
 */
export async function updateBilling(
  oxyUserId: string,
  columns: Partial<typeof billing.$inferInsert>,
  db: DatabaseOrTransaction = getDb(),
): Promise<BillingRow | null> {
  const [row] = await db
    .update(billing)
    .set(columns)
    .where(eq(billing.oxyUserId, oxyUserId))
    .returning();
  return row ?? null;
}
