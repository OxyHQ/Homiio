/**
 * Partner Controller
 *
 * The Partner (agent) referral program: a signed-in user opts in to become a
 * Partner, receives a unique referral link, sources property listings through
 * it, and earns commissions when those deals close.
 *
 *   POST /api/partners/join          — idempotent opt-in; mints a referral code.
 *   GET  /api/partners/me            — partner profile + referral link + stats.
 *   GET  /api/partners/me/referrals  — properties sourced by the partner.
 *   GET  /api/partners/me/earnings   — the partner's commission ledger.
 *
 * Marketing copy says "Agent"; the data term is "Partner".
 */

import {
  COMMISSION_CONFIG,
  PropertyStatus,
  type Commission as ApiCommission,
  type PartnerMeResponse,
  type PartnerStats,
} from '@homiio/shared-types';
import { generateReferralCode } from '../services/commissionService';
import config from '../config';

import { Partner, Property, Commission } from '../models';
import { logger } from '../middlewares/logging';
import { AppError, successResponse } from '../middlewares/errorHandler';

/** Statuses that count a sourced listing as an "active listing" in the stats. */
const ACTIVE_LISTING_STATUSES: ReadonlyArray<string> = [
  PropertyStatus.PUBLISHED,
  PropertyStatus.RESERVED,
];
/** Commission statuses whose amounts roll up into "pending" earnings. */
const PENDING_COMMISSION_STATUSES: ReadonlyArray<string> = ['pending', 'approved'];

/**
 * A lean Commission row: the persisted fields plus Mongoose's `_id`/`__v`. The
 * model's `toJSON` only adds an `id` alias (no field is stripped or reshaped), so
 * `{ ...doc, id }` reproduces the exact same response shape without hydrating a
 * full document — see {@link toApiCommission}.
 */
type LeanCommissionDoc = Omit<ApiCommission, 'id'> & { _id: unknown };

/**
 * Map a lean Commission row to the API shape, mirroring the model's `toJSON`
 * transform (`ret.id = ret._id`) so the `.lean()` ledger response is byte-for-
 * byte identical to the hydrated `.toJSON()` one.
 */
function toApiCommission(doc: LeanCommissionDoc): ApiCommission {
  return { ...doc, id: String(doc._id) };
}

/** Extract the authenticated Oxy user id from a request, or null. */
function getOxyUserId(req: any): string | null {
  const id = req.user?.id || req.user?._id || req.userId;
  return id ? String(id) : null;
}

/** Best-effort display name/username for seeding a partner's referral slug. */
function getDisplayName(req: any): string | undefined {
  const user = req.user;
  if (!user) return undefined;
  const full = user.name?.full;
  if (typeof full === 'string' && full.trim()) return full;
  const first = user.name?.first;
  if (typeof first === 'string' && first.trim()) return first;
  if (typeof user.username === 'string' && user.username.trim()) return user.username;
  return undefined;
}

/** Build the public referral link for a partner from the configured web base URL. */
function buildReferralLink(referralCode: string): string {
  const base = config.web.baseUrl.replace(/\/+$/, '');
  return `${base}/properties/create?ref=${encodeURIComponent(referralCode)}`;
}

/** Zeroed stats for a user who has not joined (or has no activity yet). */
function emptyStats(): PartnerStats {
  return {
    referredCount: 0,
    activeListings: 0,
    pendingEarnings: 0,
    paidEarnings: 0,
    currency: COMMISSION_CONFIG.currency,
  };
}

/** Compute live dashboard stats for a partner from their properties + commissions. */
async function computeStats(partnerId: unknown): Promise<PartnerStats> {
  const [referredCount, activeListings, commissionAgg] = await Promise.all([
    Property.countDocuments({ sourcedByPartner: partnerId }),
    Property.countDocuments({
      sourcedByPartner: partnerId,
      status: { $in: ACTIVE_LISTING_STATUSES },
    }),
    Commission.aggregate([
      { $match: { partnerId } },
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' },
        },
      },
    ]),
  ]);

  let pendingEarnings = 0;
  let paidEarnings = 0;
  for (const row of commissionAgg as Array<{ _id: string; total: number }>) {
    if (PENDING_COMMISSION_STATUSES.includes(row._id)) {
      pendingEarnings += row.total;
    } else if (row._id === 'paid') {
      paidEarnings += row.total;
    }
  }

  return {
    referredCount,
    activeListings,
    pendingEarnings,
    paidEarnings,
    currency: COMMISSION_CONFIG.currency,
  };
}

/** Assemble the full `PartnerMeResponse` for a (possibly absent) partner doc. */
async function buildMeResponse(partnerDoc: any): Promise<PartnerMeResponse> {
  if (!partnerDoc) {
    return { partner: null, link: null, stats: emptyStats() };
  }
  const stats = await computeStats(partnerDoc._id);
  return {
    partner: partnerDoc.toJSON(),
    link: buildReferralLink(partnerDoc.referralCode),
    stats,
  };
}

class PartnerController {
  /**
   * POST /api/partners/join
   *
   * Idempotent opt-in: returns the existing Partner if the user already joined
   * (re-activating it if it was inactive), otherwise creates one with a freshly
   * minted unique referral code. Always responds with the full
   * `PartnerMeResponse`.
   */
  async join(req: any, res: any, next: any) {
    try {
      const oxyUserId = getOxyUserId(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      let partner = await Partner.findOne({ userId: oxyUserId });
      if (partner) {
        // Re-activate a dormant partner; otherwise this is a pure no-op.
        if (partner.status !== 'active') {
          partner.status = 'active';
          await partner.save();
        }
        const payload = await buildMeResponse(partner);
        return res.status(200).json(successResponse(payload, 'Already a partner'));
      }

      const referralCode = await generateReferralCode(getDisplayName(req));
      partner = await Partner.create({
        userId: oxyUserId,
        referralCode,
        status: 'active',
        points: 0,
      });

      logger.info('Partner joined', {
        partnerId: String(partner._id),
        userId: oxyUserId,
        referralCode,
      });

      const payload = await buildMeResponse(partner);
      return res.status(201).json(successResponse(payload, 'Welcome to the Homiio partner program'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/partners/me
   *
   * Returns the caller's partner profile, referral link and live stats. When
   * the user has not joined, `partner`/`link` are null and `stats` is zeroed.
   */
  async me(req: any, res: any, next: any) {
    try {
      const oxyUserId = getOxyUserId(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }
      const partner = await Partner.findOne({ userId: oxyUserId });
      const payload = await buildMeResponse(partner);
      return res.json(successResponse(payload, 'Partner profile'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/partners/me/referrals
   *
   * The properties sourced by the caller's referral link, newest first. Returns
   * an empty list when the user has not joined.
   */
  async referrals(req: any, res: any, next: any) {
    try {
      const oxyUserId = getOxyUserId(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }
      const partner = await Partner.findOne({ userId: oxyUserId });
      if (!partner) {
        return res.json(successResponse({ properties: [] }, 'No referrals'));
      }
      const properties = await Property.find({ sourcedByPartner: partner._id })
        .populate('addressId')
        .sort({ createdAt: -1 });
      const payload = {
        properties: properties.map((property: any) => property.toJSON()),
      };
      return res.json(successResponse(payload, 'Partner referrals'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/partners/me/earnings
   *
   * The caller's commission ledger, newest first. Returns an empty list when
   * the user has not joined.
   */
  async earnings(req: any, res: any, next: any) {
    try {
      const oxyUserId = getOxyUserId(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }
      const partner = await Partner.findOne({ userId: oxyUserId });
      if (!partner) {
        return res.json(successResponse({ commissions: [] }, 'No earnings'));
      }
      // Lean read: the Commission model's `toJSON` only aliases `_id`→`id`, so we
      // reproduce that shape from plain rows (no full-document hydration).
      const rows = await Commission.find({ partnerId: partner._id })
        .sort({ createdAt: -1 })
        .lean<LeanCommissionDoc[]>();
      const payload = { commissions: rows.map(toApiCommission) };
      return res.json(successResponse(payload, 'Partner earnings'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new PartnerController();
