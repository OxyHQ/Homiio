/**
 * `billing` and `billing_processed_sessions` — the Homiio Plus subscription
 * record.
 *
 * Ported from `models/schemas/BillingSchema.ts`. Empty in production.
 *
 * Singular table name, deliberately, and the one exception to
 * `CONVENTIONS.md`'s "plural" rule: `billing` is a mass noun, `billings` is not
 * a word anybody uses, and the Mongo collection is already `billings` only
 * because `pluralize()` said so — which the naming section names as an artifact
 * rather than a design. The child table is plural because its rows are countable.
 */

import { bigint, boolean, check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, timestamptz, updatedAt } from '@oxyhq/db';

export const billing = pgTable(
  'billing',
  {
    id: generatedId(),

    /** The Oxy account this record belongs to. One record per account. */
    oxyUserId: text().notNull(),

    plusActive: boolean().notNull().default(false),
    plusSince: timestamptz(),
    plusCanceledAt: timestamptz(),
    /**
     * Stripe's subscription id.
     *
     * A foreign SERVICE's primary key, and a plain indexed column rather than
     * anything structural — Stripe's key space differs between test and live
     * mode, so it must never become part of a Homiio key.
     *
     * NOT `_id`-suffixed, so it is outside `idShapedColumns`' reach; it is named
     * in `ID_COLUMNS_WITHOUT_FOREIGN_KEY` anyway, because a reader looking for
     * "which columns hold somebody else's id" should find it in one place.
     */
    plusStripeSubscriptionId: text(),

    /**
     * Remaining one-off file credits for a non-subscriber.
     *
     * `bigint({ mode: 'number' })`: application-generated, incremented and
     * decremented by whole units in `addFileCredit` / `consumeFileCredit`, never
     * portal-supplied. Same exception as `partners.points`.
     */
    fileCredits: bigint({ mode: 'number' }).notNull().default(0),
    lastPaymentAt: timestamptz(),

    founderSupporter: boolean().notNull().default(false),
    founderSince: timestamptz(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * Mongo declared this unique AND guarded it a second time with a
     * `pre('save')` read ("Billing record already exists for Oxy user"). The
     * read is the window a concurrent second checkout arrives in; the index is
     * what actually closes it, which is why only the index is ported.
     */
    uniqueIndex('billing_oxy_user_id_key').on(table.oxyUserId),
    // `findActiveSubscriptions` filters on this alone.
    index('billing_plus_active_idx').on(table.plusActive).where(sql`${table.plusActive}`),
    /**
     * `findByStripeSubscriptionId` is the webhook's lookup, and it is a
     * one-row-or-none query on a value Stripe guarantees unique. Partial, so the
     * index holds only the subscribers rather than a NULL for every free account.
     */
    uniqueIndex('billing_plus_stripe_subscription_id_key')
      .on(table.plusStripeSubscriptionId)
      .where(sql`${table.plusStripeSubscriptionId} is not null`),
    /**
     * Mongo declared `min: 0` nowhere on `fileCredits`, and `consumeFileCredit`
     * throws before decrementing past zero — so a negative balance is
     * unreachable through the application and this rejects nothing that exists.
     * It is expressed because the ported form of that method is
     * `UPDATE … SET file_credits = file_credits - 1`, which has no such guard
     * unless the database carries it.
     */
    check('billing_file_credits_non_negative_check', sql`${table.fileCredits} >= 0`),
  ],
);

/**
 * `processedSessions[]` — the Stripe Checkout session ids already credited.
 *
 * A child table rather than the `text[]` `preferences.preferred_amenities` gets,
 * and the difference is what the set is FOR: this one is queried BY ELEMENT
 * (`isSessionProcessed`) and appended to on every payment, and it is the entire
 * idempotency mechanism for crediting a checkout. As an array, "have I already
 * credited this session?" is a read-modify-write of the whole profile document
 * with a race in the middle — which is exactly how a webhook redelivery double-
 * credits an account.
 *
 * As a row with `UNIQUE(billing_id, session_id)`, the second credit attempt
 * fails on the insert. That is the same shape the moderation tables use for the
 * same reason, and it is strictly stronger than what Mongo could express.
 */
export const billingProcessedSessions = pgTable(
  'billing_processed_sessions',
  {
    id: generatedId(),
    billingId: text()
      .notNull()
      .references(() => billing.id, { onDelete: 'cascade' }),
    /** Stripe's Checkout session id. A foreign service's key; see `plus_stripe_subscription_id`. */
    sessionId: text().notNull(),
    processedAt: createdAt(),
  },
  (table) => [uniqueIndex('billing_processed_sessions_key').on(table.billingId, table.sessionId)],
);
