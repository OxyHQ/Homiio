/**
 * `partners` and `commissions` — the referral programme.
 *
 * Ported from `models/schemas/PartnerSchema.ts` and
 * `models/schemas/CommissionSchema.ts`. Both are EMPTY in production; the
 * constraints below are therefore written from the schema and the service that
 * writes it, with nothing to reject mid-copy.
 *
 * A partner sources a listing through a referral link
 * (`properties.sourced_by_partner_id`) and earns one commission when that
 * listing's deal closes.
 */

import { bigint, check, doublePrecision, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, updatedAt } from '@oxyhq/db';
import type {
  CommissionKind,
  CommissionOffering,
  CommissionStatus,
  PartnerStatus,
} from '@homiio/shared-types';
import { properties } from './properties';

export const PARTNER_STATUSES = ['active', 'inactive'] as const satisfies readonly PartnerStatus[];

export const COMMISSION_STATUSES = [
  'pending',
  'approved',
  'paid',
  'cancelled',
] as const satisfies readonly CommissionStatus[];

export const COMMISSION_OFFERINGS = [
  'rent',
  'sale',
  'exchange',
] as const satisfies readonly CommissionOffering[];

export const COMMISSION_KINDS = [
  'percentOfMonthlyRent',
  'flat',
] as const satisfies readonly CommissionKind[];

export const partners = pgTable(
  'partners',
  {
    id: generatedId(),

    /**
     * The Oxy account. One partner per account.
     *
     * Mongo named this `userId`; it is renamed here because the column holds an
     * OXY account id and `deferredForeignKeys.isOxyAccountColumn` is what stops
     * an id-shaped column shipping unclassified — a column named `user_id` would
     * fall through that predicate and read as a missing foreign key into a table
     * that does not exist. The collection is empty, so the rename costs the
     * backfill one mapping entry and nothing else.
     */
    oxyUserId: text().notNull(),
    /** The short slug carried on the referral link (`nate-7f3a`). Lowercased at the call site. */
    referralCode: text().notNull(),
    status: text({ enum: PARTNER_STATUSES }).notNull().default('active'),
    /**
     * Running gamification total.
     *
     * `bigint({ mode: 'number' })` rather than `double precision`: unlike a
     * portal-supplied `Number`, this one is generated entirely by
     * `POINTS_CONFIG` inside this package and is only ever incremented by whole
     * awards. It is the same exception `properties.rating_count` and
     * `property_images.order` take.
     *
     * The reward TIER is deliberately absent — `tierForPoints` derives it, and
     * storing it would create a second representation of one fact that can
     * disagree with the first.
     */
    points: bigint({ mode: 'number' }).notNull().default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('partners_oxy_user_id_key').on(table.oxyUserId),
    uniqueIndex('partners_referral_code_key').on(table.referralCode),
    // Mongo's standalone `{ status: 1 }`. Ported: `partnerController` lists
    // active partners, and the column has two values, so this earns its keep
    // only once the table is large. Kept because it is Mongo's, and dropping an
    // index on an empty table is a decision better taken with rows in it.
    index('partners_status_idx').on(table.status),
    check('partners_status_check', sql`${table.status} in (${sql.raw(inList(PARTNER_STATUSES))})`),
  ],
);

/**
 * `commissions` — one partner payout per closed deal.
 *
 * ## `basis` is flattened, and `rate`/`flat` stay nullable
 *
 * The `commissionBasisSchema` subdocument is `required: true`, so unlike every
 * optional block in `properties` its four columns are NOT nullable-by-absence —
 * `offering`, `deal_value` and `kind` are `NOT NULL`. `rate` and `flat` are the
 * exception WITHIN it: each belongs to one `kind` and is absent for the other,
 * which the CHECK below states rather than leaving to the service.
 */
export const commissions = pgTable(
  'commissions',
  {
    id: generatedId(),

    /**
     * RESTRICT: a partner with earned commissions must not be deletable. A
     * payout with no partner is not a payout with a missing name, it is an
     * unattributable financial record.
     */
    partnerId: text()
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),

    /**
     * RESTRICT, and it cannot collide with the `properties` expiry sweep.
     *
     * That is worth stating because the sweep hard-deletes and a RESTRICT would
     * abort it. It cannot happen, for a structural reason rather than a hopeful
     * one: `expires_at` is set ONLY by `PropertySchema`'s `pre('save')` hook for
     * `isExternal` listings, and that same hook strips `oxy_user_id` from them —
     * while `markPropertyTransacted` refuses any listing whose `oxy_user_id` is
     * not the caller's. So a property that can carry a commission never carries a
     * deadline, and the two sets are disjoint by construction.
     *
     * CASCADE would be wrong for the ordinary reason: deleting a listing must not
     * delete the payout it earned.
     */
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),

    /** Partner payout, in MAJOR currency units. */
    amount: doublePrecision().notNull(),
    /**
     * Three-letter code, uppercased at the call site.
     *
     * NO CHECK against `LISTING_CURRENCIES`: Mongoose declared `minlength: 3`
     * and `maxlength: 3` with no `enum`, so the vocabulary was never enforced and
     * deriving one here is the deferred-validator case `CONVENTIONS.md` states.
     * The length rule is not ported either, for the same reason.
     */
    currency: text().notNull().default('EUR'),

    // ── basis, flattened ──
    /** Which offering closed. */
    basisOffering: text({ enum: COMMISSION_OFFERINGS }).notNull(),
    /** Monthly rent (rent) or sale price (sale); 0 for an exchange. */
    basisDealValue: doublePrecision().notNull(),
    basisKind: text({ enum: COMMISSION_KINDS }).notNull(),
    /** Fraction of monthly rent, when `basis_kind` is `percentOfMonthlyRent`. */
    basisRate: doublePrecision(),
    /** Flat payout in major units, when `basis_kind` is `flat`. */
    basisFlat: doublePrecision(),

    status: text({ enum: COMMISSION_STATUSES }).notNull().default('pending'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * One commission per property, ever.
     *
     * This is the close trigger's idempotency, and Mongo already declared it
     * unique — `onPropertyTransacted` also guards with a read, which is the
     * window a concurrent second close arrives in. The index is what actually
     * closes it.
     */
    uniqueIndex('commissions_property_id_key').on(table.propertyId),
    // The partner earnings ledger, newest first.
    index('commissions_partner_created_idx').on(table.partnerId, sql`${table.createdAt} desc`),
    // Mongo's standalone `{ partnerId: 1 }` is the leading prefix of the index
    // above and is not ported. `{ status: 1 }` is: an operator listing
    // `approved` payouts to pay filters on it alone.
    index('commissions_status_idx').on(table.status),
    check(
      'commissions_status_check',
      sql`${table.status} in (${sql.raw(inList(COMMISSION_STATUSES))})`,
    ),
    check(
      'commissions_basis_offering_check',
      sql`${table.basisOffering} in (${sql.raw(inList(COMMISSION_OFFERINGS))})`,
    ),
    check(
      'commissions_basis_kind_check',
      sql`${table.basisKind} in (${sql.raw(inList(COMMISSION_KINDS))})`,
    ),
    /**
     * The payout component matches the payout kind, in BOTH directions.
     *
     * `computeCommission` sets exactly one of the two and Mongo enforced
     * neither, so a `flat` basis carrying a `rate` was representable and would
     * make an audit of how a payout was derived ambiguous — which is the only
     * thing `basis` exists for.
     */
    check(
      'commissions_basis_components_check',
      sql`(
        ${table.basisKind} = 'percentOfMonthlyRent'
          and ${table.basisRate} is not null and ${table.basisFlat} is null
      ) or (
        ${table.basisKind} = 'flat'
          and ${table.basisFlat} is not null and ${table.basisRate} is null
      )`,
    ),
  ],
);
