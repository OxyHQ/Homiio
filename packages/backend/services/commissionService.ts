/**
 * Commission Service
 *
 * Owns the Partner (agent) referral-commission lifecycle:
 *  - `computeCommission` turns a closed deal (offering + value) into a partner
 *    payout using the shared {@link COMMISSION_CONFIG} (single source of truth).
 *  - `onPropertyTransacted` is the idempotent trigger run when a sourced
 *    property closes (rented / sold / exchanged): it creates exactly one
 *    Commission and awards gamification points to the sourcing partner.
 *  - `generateReferralCode` mints a unique short slug for a new partner.
 *
 * All money is in major units; rates/values come from `COMMISSION_CONFIG` so no
 * magic numbers live here.
 */

import {
  COMMISSION_CONFIG,
  POINTS_CONFIG,
  type CommissionKind,
  type CommissionOffering,
} from '@homiio/shared-types';
import { OfferingType, PropertyStatus } from '@homiio/shared-types';

const { Partner, Commission } = require('../models');
const { logger } = require('../middlewares/logging');

/**
 * A persisted Commission document, narrowed to the surface the trigger's
 * callers consume (the Mongoose model adds the rest). `toJSON()` yields the
 * API-shaped {@link Commission}.
 */
export interface CommissionDocument {
  _id: unknown;
  toJSON(): unknown;
}

/** Result of computing a partner payout for a single closed deal. */
export interface ComputedCommission {
  /** Partner payout, in major currency units (rounded to 2 dp). */
  amount: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Audit breakdown of how the payout was derived. */
  basis: {
    offering: CommissionOffering;
    /** Monthly rent (rent) or sale price (sale) the payout was derived from; 0 for exchange. */
    dealValue: number;
    /** Whether the payout is a percentage of monthly rent or a flat reward. */
    kind: CommissionKind;
    /** Fraction of monthly rent paid out, when `kind` is `percentOfMonthlyRent`. */
    rate?: number;
    /** Flat payout amount, in major units, when `kind` is `flat`. */
    flat?: number;
  };
}

/** Minimal shape of a property document this service reads. */
export interface TransactableProperty {
  _id: unknown;
  id?: unknown;
  status?: string;
  offerings?: unknown;
  sourcedByPartner?: unknown;
  longTermRent?: { monthlyAmount?: unknown } | null;
  shortTermRent?: { nightlyRate?: unknown } | null;
  sale?: { price?: unknown } | null;
  exchange?: { mode?: unknown } | null;
}

/** The offering + monetary value a closed deal is priced from. */
interface DealBasis {
  offering: CommissionOffering;
  dealValue: number;
}

const CENTS_PER_UNIT = 100;
/** Major-unit step the per-1,000 points bonus accrues on. */
const POINTS_EARNED_STEP = 1000;
/** Length of the random alphanumeric suffix appended to a referral code. */
const REFERRAL_SUFFIX_LENGTH = 4;
/** Max characters kept from the user's name when building a referral slug. */
const REFERRAL_SLUG_MAX = 18;
/** Fallback slug base when a user has no usable display name/username. */
const REFERRAL_FALLBACK_BASE = 'partner';
/** Attempts to find a collision-free referral code before giving up. */
const REFERRAL_MAX_ATTEMPTS = 10;

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Round a major-unit money amount to 2 decimal places. */
function roundMoney(amount: number): number {
  return Math.round(amount * CENTS_PER_UNIT) / CENTS_PER_UNIT;
}

/**
 * Compute the partner payout for a closed deal. Homiio is a very low-fee
 * platform, so payouts are small and mostly flat:
 *  - rent: 3% of the first month's rent (`dealValue` × payout.rent.value)
 *  - sale: flat reward (payout.sale.value), independent of the sale price
 *  - exchange: flat reward (payout.exchange.value), no monetary deal value
 */
export function computeCommission(
  offering: CommissionOffering,
  dealValue: number
): ComputedCommission {
  const { payout, currency } = COMMISSION_CONFIG;

  switch (offering) {
    case 'rent': {
      const safeValue = isPositiveNumber(dealValue) ? dealValue : 0;
      const rate = payout.rent.value;
      return {
        amount: roundMoney(safeValue * rate),
        currency,
        basis: { offering: 'rent', dealValue: safeValue, kind: 'percentOfMonthlyRent', rate },
      };
    }
    case 'sale': {
      const safeValue = isPositiveNumber(dealValue) ? dealValue : 0;
      const flat = payout.sale.value;
      return {
        amount: flat,
        currency,
        basis: { offering: 'sale', dealValue: safeValue, kind: 'flat', flat },
      };
    }
    case 'exchange': {
      const flat = payout.exchange.value;
      return {
        amount: flat,
        currency,
        basis: { offering: 'exchange', dealValue: 0, kind: 'flat', flat },
      };
    }
    default: {
      // Exhaustiveness guard: a new CommissionOffering must be handled above.
      const exhaustive: never = offering;
      throw new Error(`Unsupported commission offering: ${String(exhaustive)}`);
    }
  }
}

/**
 * Resolve which offering + monetary value a closed deal is priced from, given
 * the property's declared offerings, terminal status and per-offering pricing.
 *
 * A SOLD property prices off its sale block; a RENTED property prices off its
 * long-term (then short-term) rent block; otherwise an exchange listing prices
 * off the flat exchange fee. Returns null when no priced offering applies.
 */
function resolveDealBasis(property: TransactableProperty): DealBasis | null {
  const offerings = Array.isArray(property.offerings)
    ? (property.offerings as unknown[]).filter((o): o is string => typeof o === 'string')
    : [];
  const has = (offering: OfferingType): boolean => offerings.includes(offering);
  const status = property.status;

  // Sale close → price off the sale block.
  if (status === PropertyStatus.SOLD && has(OfferingType.SALE) && isPositiveNumber(property.sale?.price)) {
    return { offering: 'sale', dealValue: property.sale.price };
  }

  // Rent close → price off monthly rent, then nightly rate as a fallback.
  if (status === PropertyStatus.RENTED) {
    if (has(OfferingType.LONG_TERM_RENT) && isPositiveNumber(property.longTermRent?.monthlyAmount)) {
      return { offering: 'rent', dealValue: property.longTermRent.monthlyAmount };
    }
    if (has(OfferingType.SHORT_TERM_RENT) && isPositiveNumber(property.shortTermRent?.nightlyRate)) {
      return { offering: 'rent', dealValue: property.shortTermRent.nightlyRate };
    }
  }

  // No terminal sale/rent match — fall back to the highest-value priced offering
  // the listing carries, so an inactive/closed listing still pays out correctly.
  if (has(OfferingType.SALE) && isPositiveNumber(property.sale?.price)) {
    return { offering: 'sale', dealValue: property.sale.price };
  }
  if (has(OfferingType.LONG_TERM_RENT) && isPositiveNumber(property.longTermRent?.monthlyAmount)) {
    return { offering: 'rent', dealValue: property.longTermRent.monthlyAmount };
  }
  if (has(OfferingType.SHORT_TERM_RENT) && isPositiveNumber(property.shortTermRent?.nightlyRate)) {
    return { offering: 'rent', dealValue: property.shortTermRent.nightlyRate };
  }
  // Exchange has no monetary deal value — a flat fee still earns a commission.
  if (has(OfferingType.EXCHANGE)) {
    return { offering: 'exchange', dealValue: 0 };
  }

  return null;
}

/**
 * Idempotent close trigger: when a sourced property is marked transacted,
 * create exactly one Commission and award the sourcing partner their points.
 *
 * Returns the existing or newly created Commission document, or null when there
 * is nothing to do (no sourcing partner, partner missing, or no priced
 * offering to compute against). A second call for the same property is a no-op.
 */
export async function onPropertyTransacted(
  property: TransactableProperty
): Promise<CommissionDocument | null> {
  if (!property?.sourcedByPartner) {
    return null;
  }

  const propertyId = property._id ?? property.id;
  if (!propertyId) {
    return null;
  }

  // Idempotency: one commission per property (also guarded by a unique index).
  const existing: CommissionDocument | null = await Commission.findOne({ propertyId });
  if (existing) {
    return existing;
  }

  const partner = await Partner.findById(property.sourcedByPartner);
  if (!partner) {
    logger.warn('onPropertyTransacted: sourcing partner not found', {
      propertyId: String(propertyId),
      sourcedByPartner: String(property.sourcedByPartner),
    });
    return null;
  }

  const basis = resolveDealBasis(property);
  if (!basis) {
    logger.warn('onPropertyTransacted: no priced offering to compute commission', {
      propertyId: String(propertyId),
      status: property.status,
    });
    return null;
  }

  const computed = computeCommission(basis.offering, basis.dealValue);

  // Closed deals create the commission as `approved` (payout is Phase 2).
  const commission: CommissionDocument = await Commission.create({
    partnerId: partner._id,
    propertyId,
    amount: computed.amount,
    currency: computed.currency,
    basis: computed.basis,
    status: 'approved',
  });

  // Award gamification points: a flat per-deal base plus a per-1,000-earned bonus.
  const earnedBonus = Math.floor(computed.amount / POINTS_EARNED_STEP) * POINTS_CONFIG.perThousandEarned;
  partner.points += POINTS_CONFIG.perClosedDeal + earnedBonus;
  await partner.save();

  logger.info('Commission created on property close', {
    commissionId: String(commission._id),
    propertyId: String(propertyId),
    partnerId: String(partner._id),
    offering: basis.offering,
    amount: computed.amount,
    pointsAwarded: POINTS_CONFIG.perClosedDeal + earnedBonus,
  });

  return commission;
}

/** Strip a display string down to a lowercase, hyphen-separated slug base. */
function slugifyBase(input: string): string {
  const slug = input
    .normalize('NFKD')
    // Strip combining diacritical marks (U+0300–U+036F) left by NFKD.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, REFERRAL_SLUG_MAX)
    .replace(/-+$/g, '');
  return slug || REFERRAL_FALLBACK_BASE;
}

/** Short random alphanumeric suffix to disambiguate referral codes. */
function randomSuffix(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < REFERRAL_SUFFIX_LENGTH; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Mint a referral code: a slug from the user's display name/username plus a
 * short random suffix, verified unique against the Partner collection. Falls
 * back to a generic base when no usable name is given.
 *
 * @param nameOrUsername the user's display name or username (best-effort)
 */
export async function generateReferralCode(nameOrUsername: string | undefined | null): Promise<string> {
  const base = slugifyBase(typeof nameOrUsername === 'string' ? nameOrUsername : '');

  for (let attempt = 0; attempt < REFERRAL_MAX_ATTEMPTS; attempt += 1) {
    const candidate = `${base}-${randomSuffix()}`;
    const clash = await Partner.exists({ referralCode: candidate });
    if (!clash) {
      return candidate;
    }
  }

  // Astronomically unlikely after 10 attempts; widen the entropy deterministically.
  return `${base}-${randomSuffix()}${randomSuffix()}`;
}
