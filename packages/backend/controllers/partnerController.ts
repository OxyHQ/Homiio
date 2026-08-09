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
  type Partner as ApiPartner,
  type PartnerMeResponse,
  type PartnerStats,
} from '@homiio/shared-types';
import { generateReferralCode, toCommissionDocument } from '../services/commissionService';
import config from '../config';

import { desc, eq, inArray, sql } from 'drizzle-orm';

import { getDb } from '../db/postgres';
import { commissions, partners, properties } from '../db/schema';
import { allOf, findProperties, NEWEST_FIRST, propertyOrderBy } from '../db/properties/propertyReads';
import { serializeProperty } from '../db/properties/propertySerializer';
import { logger } from '../middlewares/logging';
import { AppError, successResponse } from '../middlewares/errorHandler';

/** Statuses that count a sourced listing as an "active listing" in the stats. */
const ACTIVE_LISTING_STATUSES: ReadonlyArray<string> = [
  PropertyStatus.PUBLISHED,
  PropertyStatus.RESERVED,
];
/** Commission statuses whose amounts roll up into "pending" earnings. */
const PENDING_COMMISSION_STATUSES: ReadonlyArray<string> = ['pending', 'approved'];

type PartnerRow = typeof partners.$inferSelect;

/**
 * Map a `partners` row to the API shape.
 *
 * `oxy_user_id` is emitted as `userId`, which the `Partner` contract declares
 * and the frontend reads. The COLUMN was renamed in the port (every foreign
 * service's primary key on this schema is spelled `oxy_user_id`, and a column
 * no gate can see is one that ships unconstrained); the WIRE was not, because a
 * shipped client cannot be recalled.
 */
function toApiPartner(row: PartnerRow): ApiPartner {
  return {
    id: row.id,
    userId: row.oxyUserId,
    referralCode: row.referralCode,
    status: row.status,
    points: row.points,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The caller's partner row, or null when they have not joined. */
async function findPartnerByOxyUserId(oxyUserId: string): Promise<PartnerRow | null> {
  const [row] = await getDb()
    .select()
    .from(partners)
    .where(eq(partners.oxyUserId, oxyUserId))
    .limit(1);
  return row ?? null;
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
async function computeStats(partnerId: string): Promise<PartnerStats> {
  const db = getDb();
  const [listingCounts, commissionTotals] = await Promise.all([
    // Both listing counts in ONE pass. The Mongo version issued two
    // `countDocuments` over the same index; a filtered aggregate reads the rows
    // once and cannot report an `activeListings` from a different instant than
    // its own `referredCount`.
    db
      .select({
        referredCount: sql<number>`count(*)::int`,
        activeListings: sql<number>`count(*) filter (
          where ${inArray(properties.status, [...ACTIVE_LISTING_STATUSES] as 'published'[])}
        )::int`,
      })
      .from(properties)
      .where(eq(properties.sourcedByPartnerId, partnerId)),
    db
      .select({ status: commissions.status, total: sql<number>`sum(${commissions.amount})` })
      .from(commissions)
      .where(eq(commissions.partnerId, partnerId))
      .groupBy(commissions.status),
  ]);

  const referredCount = listingCounts[0]?.referredCount ?? 0;
  const activeListings = listingCounts[0]?.activeListings ?? 0;

  let pendingEarnings = 0;
  let paidEarnings = 0;
  for (const row of commissionTotals) {
    const total = Number(row.total ?? 0);
    if (PENDING_COMMISSION_STATUSES.includes(row.status)) {
      pendingEarnings += total;
    } else if (row.status === 'paid') {
      paidEarnings += total;
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

/** Assemble the full `PartnerMeResponse` for a (possibly absent) partner row. */
async function buildMeResponse(partner: PartnerRow | null): Promise<PartnerMeResponse> {
  if (!partner) {
    return { partner: null, link: null, stats: emptyStats() };
  }
  const stats = await computeStats(partner.id);
  return {
    partner: toApiPartner(partner),
    link: buildReferralLink(partner.referralCode),
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

      const existing = await findPartnerByOxyUserId(oxyUserId);
      if (existing) {
        // Re-activate a dormant partner; otherwise this is a pure no-op.
        const partner =
          existing.status === 'active'
            ? existing
            : ((
                await getDb()
                  .update(partners)
                  .set({ status: 'active' })
                  .where(eq(partners.id, existing.id))
                  .returning()
              )[0] ?? existing);
        const payload = await buildMeResponse(partner);
        return res.status(200).json(successResponse(payload, 'Already a partner'));
      }

      const referralCode = await generateReferralCode(getDisplayName(req));
      const [partner] = await getDb()
        .insert(partners)
        .values({ oxyUserId, referralCode, status: 'active', points: 0 })
        .returning();

      logger.info('Partner joined', {
        partnerId: partner.id,
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
      const partner = await findPartnerByOxyUserId(oxyUserId);
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
      const partner = await findPartnerByOxyUserId(oxyUserId);
      if (!partner) {
        return res.json(successResponse({ properties: [] }, 'No referrals'));
      }
      // Through the shared read repository, so a partner's referral list is the
      // same listing shape (address join, photos, calendar) every other feed
      // serves — the Mongo version's `.populate('addressId')` produced a
      // different body from `GET /properties`.
      const sourced = await findProperties({
        where: allOf([eq(properties.sourcedByPartnerId, partner.id)]),
        orderBy: propertyOrderBy(NEWEST_FIRST),
      });
      const payload = { properties: sourced.map(serializeProperty) };
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
      const partner = await findPartnerByOxyUserId(oxyUserId);
      if (!partner) {
        return res.json(successResponse({ commissions: [] }, 'No earnings'));
      }
      const rows = await getDb()
        .select()
        .from(commissions)
        .where(eq(commissions.partnerId, partner.id))
        .orderBy(desc(commissions.createdAt));
      const payload = { commissions: rows.map(toCommissionDocument) };
      return res.json(successResponse(payload, 'Partner earnings'));
    } catch (error) {
      next(error);
    }
  }
}

export default new PartnerController();
