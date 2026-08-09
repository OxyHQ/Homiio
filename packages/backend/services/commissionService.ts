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
  commissionAmount,
  type Commission as ApiCommission,
  type CommissionBasis,
  type CommissionOffering,
} from '@homiio/shared-types';
import { OfferingType, PropertyStatus } from '@homiio/shared-types';

import { eq, sql } from 'drizzle-orm';

import { getDb } from '../db/postgres';
import { commissions, partners } from '../db/schema';
import { logger } from '../middlewares/logging';

/**
 * A persisted Commission document, narrowed to the surface the trigger's
 * callers consume (the Mongoose model adds the rest). `toJSON()` yields the
 * API-shaped {@link Commission}.
 */
/**
 * A persisted commission, in the shape callers put on the wire.
 *
 * `toJSON()` is kept because `markPropertyTransacted` calls it, and it returns
 * the API shape rather than the ROW — the four flattened `basis_*` columns are
 * re-nested into the `basis` sub-object the contract declares, the same way
 * `db/properties/propertySerializer` re-nests the twelve property subdocuments.
 * Returning the row here was a real wire regression: `commission.basis` came
 * back `undefined` on `POST /properties/:id/mark-transacted`.
 */
export interface CommissionDocument extends ApiCommission {
  toJSON(): ApiCommission;
}

/** Result of computing a partner payout for a single closed deal. */
export interface ComputedCommission {
  /** Partner payout, in major currency units (rounded to 2 dp). */
  amount: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Audit breakdown of how the payout was derived (shared with the API shape). */
  basis: CommissionBasis;
}

type CommissionRow = typeof commissions.$inferSelect;

/** Build the API representation of one commission, plus the `toJSON` callers use. */
export function toCommissionDocument(row: CommissionRow): CommissionDocument {
  const body: ApiCommission = {
    id: row.id,
    partnerId: row.partnerId,
    propertyId: row.propertyId,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    // ISO strings, which is what the contract declares. The Mongo path emitted
    // `Date` objects and let `res.json` stringify them — same bytes on the
    // wire, but a type that was never true.
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    basis:
      row.basisKind === 'percentOfMonthlyRent'
        ? {
            offering: row.basisOffering,
            dealValue: row.basisDealValue,
            kind: row.basisKind,
            rate: row.basisRate ?? 0,
          }
        : {
            offering: row.basisOffering,
            dealValue: row.basisDealValue,
            kind: row.basisKind,
            flat: row.basisFlat ?? 0,
          },
  };
  return { ...body, toJSON: () => body };
}

/** One commission by the property it closed, or null. */
export async function findCommissionByProperty(
  propertyId: string,
): Promise<CommissionDocument | null> {
  const [row] = await getDb()
    .select()
    .from(commissions)
    .where(eq(commissions.propertyId, propertyId))
    .limit(1);
  return row ? toCommissionDocument(row) : null;
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

/**
 * Compute the partner payout for a closed deal. The amount + rounding come from
 * the shared {@link commissionAmount} rule (single source of truth with the
 * calculator); the `basis` audit fields branch off the offering's payout `kind`:
 *  - `percentOfMonthlyRent` → `dealValue × rate` (e.g. 3% of the first month)
 *  - `flat`                 → a fixed reward, independent of the deal value
 *
 * The deal value is sanitised first (non-positive → 0), so exchange (which
 * carries no monetary value) records `dealValue: 0` and the flat reward stands.
 */
export function computeCommission(
  offering: CommissionOffering,
  dealValue: number
): ComputedCommission {
  const { payout, currency } = COMMISSION_CONFIG;
  const entry = payout[offering];
  const safeValue = isPositiveNumber(dealValue) ? dealValue : 0;
  const amount = commissionAmount(offering, safeValue);

  const basis: CommissionBasis =
    entry.kind === 'percentOfMonthlyRent'
      ? { offering, dealValue: safeValue, kind: entry.kind, rate: entry.value }
      : { offering, dealValue: safeValue, kind: entry.kind, flat: entry.value };

  return { amount, currency, basis };
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
    ? (property.offerings as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  const has = (offering: OfferingType): boolean => offerings.includes(offering);
  const status = property.status;

  // Each priced offering, as a basis when the listing carries it AND its price is
  // valid, else null. Defined once so the terminal-status branch and the
  // fallback below share the field access instead of repeating it.
  const saleBasis = (): DealBasis | null =>
    has(OfferingType.SALE) && isPositiveNumber(property.sale?.price)
      ? { offering: 'sale', dealValue: property.sale.price }
      : null;
  const longTermRentBasis = (): DealBasis | null =>
    has(OfferingType.LONG_TERM_RENT) && isPositiveNumber(property.longTermRent?.monthlyAmount)
      ? { offering: 'rent', dealValue: property.longTermRent.monthlyAmount }
      : null;
  const shortTermRentBasis = (): DealBasis | null =>
    has(OfferingType.SHORT_TERM_RENT) && isPositiveNumber(property.shortTermRent?.nightlyRate)
      ? { offering: 'rent', dealValue: property.shortTermRent.nightlyRate }
      : null;

  // Sale close → price off the sale block.
  if (status === PropertyStatus.SOLD) {
    const basis = saleBasis();
    if (basis) return basis;
  }

  // Rent close → price off monthly rent, then nightly rate as a fallback.
  if (status === PropertyStatus.RENTED) {
    const basis = longTermRentBasis() ?? shortTermRentBasis();
    if (basis) return basis;
  }

  // No terminal sale/rent match — fall back to the highest-value priced offering
  // the listing carries, so an inactive/closed listing still pays out correctly.
  // Exchange has no monetary deal value — a flat fee still earns a commission.
  return (
    saleBasis() ??
    longTermRentBasis() ??
    shortTermRentBasis() ??
    (has(OfferingType.EXCHANGE) ? { offering: 'exchange', dealValue: 0 } : null)
  );
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

  // Idempotency: one commission per property. `commissions_property_id_key`
  // is what actually guarantees it — this read only avoids the round trip and
  // returns the existing row rather than raising on the second close.
  const existing = await findCommissionByProperty(String(propertyId));
  if (existing) {
    return existing;
  }

  const [partner] = await getDb()
    .select({ id: partners.id, points: partners.points })
    .from(partners)
    .where(eq(partners.id, String(property.sourcedByPartner)))
    .limit(1);
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

  const earnedBonus = Math.floor(computed.amount / POINTS_EARNED_STEP) * POINTS_CONFIG.perThousandEarned;
  const pointsAwarded = POINTS_CONFIG.perClosedDeal + earnedBonus;

  // The commission row and the points award in ONE transaction. They are one
  // fact — a partner is awarded points BECAUSE a deal closed — and committing
  // them separately would let a crash between the two leave a commission whose
  // points were never granted, with nothing to detect it.
  const commission = await getDb().transaction(async (tx) => {
    // Closed deals create the commission as `approved` (payout is Phase 2).
    const [row] = await tx
      .insert(commissions)
      .values({
        partnerId: partner.id,
        propertyId: String(propertyId),
        amount: computed.amount,
        currency: computed.currency as 'EUR',
        basisOffering: computed.basis.offering,
        basisDealValue: computed.basis.dealValue,
        basisKind: computed.basis.kind,
        basisRate: computed.basis.kind === 'percentOfMonthlyRent' ? computed.basis.rate : null,
        basisFlat: computed.basis.kind === 'flat' ? computed.basis.flat : null,
        status: 'approved',
      })
      .returning();

    // Award gamification points: a flat per-deal base plus a per-1,000-earned
    // bonus. Incremented IN SQL rather than read-modify-written, so two closes
    // landing together cannot lose one partner's award.
    await tx
      .update(partners)
      .set({ points: sql`${partners.points} + ${pointsAwarded}` })
      .where(eq(partners.id, partner.id));

    return toCommissionDocument(row);
  });

  logger.info('Commission created on property close', {
    commissionId: commission.id,
    propertyId: String(propertyId),
    partnerId: partner.id,
    offering: basis.offering,
    amount: computed.amount,
    pointsAwarded,
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
    const clash = await getDb()
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.referralCode, candidate))
      .limit(1);
    if (clash.length === 0) {
      return candidate;
    }
  }

  // Astronomically unlikely after 10 attempts; widen the entropy deterministically.
  return `${base}-${randomSuffix()}${randomSuffix()}`;
}
