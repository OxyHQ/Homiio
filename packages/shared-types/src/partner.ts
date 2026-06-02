/**
 * Partner (agent) referral-commission types shared across Homiio frontend and
 * backend.
 *
 * Homiio lets anyone act as a real estate agent: a "Partner" (marketed as
 * "Agent") brings a property owner to list on Homiio. When that property rents,
 * sells, or exchanges, the Partner earns a commission paid out of Homiio's
 * success fee. Partners also accrue gamification points that unlock tiered
 * perks.
 *
 * Naming: marketing copy says "Agent"; the product/data term is "Partner"
 * (avoids implying a licensed Agente de la Propiedad). Routes/models/types use
 * `partner`.
 */

/** Whether a Partner is currently enrolled and earning. */
export type PartnerStatus = 'active' | 'inactive';

export interface Partner {
  id: string;
  /** Oxy user id this Partner belongs to (one Partner per user). */
  userId: string;
  /** Unique short slug, e.g. "nate-7f3a", carried on the referral link. */
  referralCode: string;
  status: PartnerStatus;
  /** Gamification points (see {@link POINTS_CONFIG} / {@link REWARD_TIERS}). */
  points: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lifecycle of a commission. `pending` → `approved` (deal closed) →
 * `paid` (Phase 2, real payout rails) / `cancelled`.
 */
export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'cancelled';

/** Which offering closed the deal the commission is computed from. */
export type CommissionOffering = 'rent' | 'sale' | 'exchange';

/** How a partner payout was derived: a percentage of monthly rent, or a flat reward. */
export type CommissionKind = 'percentOfMonthlyRent' | 'flat';

/**
 * Audit breakdown of how a commission payout was derived — the inputs and rule
 * that produced `Commission.amount`. Shared by the API `Commission` shape and
 * the backend's `ComputedCommission` so the two never drift.
 */
export interface CommissionBasis {
  offering: CommissionOffering;
  /** Monthly rent (rent) or sale price (sale) the payout was derived from; 0 for exchange. */
  dealValue: number;
  /** Whether the payout is a percentage of monthly rent or a flat reward. */
  kind: CommissionKind;
  /** Fraction of monthly rent paid out, when `kind` is `percentOfMonthlyRent`. */
  rate?: number;
  /** Flat payout amount, in major units, when `kind` is `flat`. */
  flat?: number;
}

export interface Commission {
  id: string;
  partnerId: string;
  propertyId: string;
  /** Partner payout, in major currency units. */
  amount: number;
  /** ISO 4217 currency code. */
  currency: string;
  basis: CommissionBasis;
  status: CommissionStatus;
  createdAt: string;
  updatedAt: string;
}

/** Aggregate dashboard figures for a partner. */
export interface PartnerStats {
  /** Properties sourced by this partner. */
  referredCount: number;
  /** Sourced properties currently published/available. */
  activeListings: number;
  /** Sum of `pending` + `approved` commission amounts. */
  pendingEarnings: number;
  /** Sum of `paid` commission amounts. */
  paidEarnings: number;
  /** ISO 4217 currency the earnings are denominated in. */
  currency: string;
}

/**
 * Payload returned by `GET /api/partners/me` and `POST /api/partners/join`.
 * `partner`/`link` are null until the user joins; `stats` is always present
 * (zeroed before joining).
 */
export interface PartnerMeResponse {
  partner: Partner | null;
  /** Full referral link, null until joined. */
  link: string | null;
  stats: PartnerStats;
}

/**
 * Commission model — the single source of truth for how a Partner's payout is
 * computed. Homiio is a very low-fee platform, so partner payouts are small and
 * mostly flat — a direct reward to the partner (not a share of a platform fee):
 *  - rent: 3% of the first month's rent (e.g. €1,200/mo → €36)
 *  - sale: flat €150 (independent of the sale price)
 *  - exchange: flat €15
 */
export const COMMISSION_CONFIG = {
  /** ISO 4217 currency payouts are denominated in. */
  currency: 'EUR',
  payout: {
    rent: { kind: 'percentOfMonthlyRent', value: 0.03 },
    sale: { kind: 'flat', value: 150 },
    exchange: { kind: 'flat', value: 15 },
  },
} as const;

/** Money rounding granularity — 2 decimal places (cents). */
const COMMISSION_CENTS_PER_UNIT = 100;

/**
 * The single source of truth for the payout RULE: maps an offering + deal value
 * to the partner payout in major currency units, straight from
 * {@link COMMISSION_CONFIG}. Shared by the calculator (frontend preview) and the
 * close trigger (backend ledger) so the displayed estimate and the recorded
 * commission can never disagree.
 *
 *  - `percentOfMonthlyRent` → `dealValue × value` (e.g. €1,200 rent → €36)
 *  - `flat`                 → `value` (the deal value is ignored)
 *
 * Result is rounded to 2 decimal places.
 */
export function commissionAmount(offering: CommissionOffering, dealValue: number): number {
  const entry = COMMISSION_CONFIG.payout[offering];
  const raw = entry.kind === 'percentOfMonthlyRent' ? dealValue * entry.value : entry.value;
  return Math.round(raw * COMMISSION_CENTS_PER_UNIT) / COMMISSION_CENTS_PER_UNIT;
}

/**
 * Gamification points awarded when a sourced deal closes. Tier is derived from
 * the running points total via {@link tierForPoints} (never stored) so both
 * ends agree.
 */
export const POINTS_CONFIG = {
  /** Base points when a sourced deal closes. */
  perClosedDeal: 100,
  /** Additional points per 1,000 of partner payout. */
  perThousandEarned: 10,
} as const;

export type RewardTierKey = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface RewardTier {
  key: RewardTierKey;
  /** Minimum running points total to reach this tier. */
  minPoints: number;
  /** i18n keys under `agent.rewards.perks.*` unlocked at this tier. */
  perkKeys: string[];
}

/** Reward tiers in ascending `minPoints` order. */
export const REWARD_TIERS: RewardTier[] = [
  { key: 'bronze', minPoints: 0, perkKeys: ['profile'] },
  { key: 'silver', minPoints: 300, perkKeys: ['brandedPen', 'prioritySupport'] },
  { key: 'gold', minPoints: 1000, perkKeys: ['businessCards', 'featuredBadge'] },
  { key: 'platinum', minPoints: 3000, perkKeys: ['swagBox', 'higherShare'] },
];

/**
 * Resolve the highest reward tier whose `minPoints` is at or below `points`.
 * `REWARD_TIERS` is ascending, so the last qualifying tier wins. The first tier
 * (`minPoints: 0`) always qualifies, so this is total.
 */
export function tierForPoints(points: number): RewardTier {
  let current: RewardTier = REWARD_TIERS[0];
  for (const tier of REWARD_TIERS) {
    if (points >= tier.minPoints) {
      current = tier;
    }
  }
  return current;
}
