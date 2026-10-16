/**
 * The Partner (agent) referral program, as use cases: a signed-in person opts
 * in, receives a referral link, sources listings through it and earns
 * commissions when those deals close.
 *
 * Every function is scoped to the `oxyUserId` it is given — the Express
 * session on `/api/partners/*`, the effective account on the capability lane —
 * and the partner row is looked up BY that id, so nobody reads another
 * person's dashboard. Marketing copy says "Agent"; the data term is "Partner".
 */

import {
  COMMISSION_CONFIG,
  PropertyStatus,
  type Partner as ApiPartner,
  type PartnerMeResponse,
  type PartnerStats,
} from '@homiio/shared-types';
import { desc, eq, inArray, sql } from 'drizzle-orm';

import config from '../config';
import { getDb } from '../db/postgres';
import {
  allOf,
  findProperties,
  NEWEST_FIRST,
  propertyOrderBy,
} from '../db/properties/propertyReads';
import { serializeProperty } from '../db/properties/propertySerializer';
import { commissions, partners, properties } from '../db/schema';
import { logger } from '../middlewares/logging';
import { generateReferralCode, toCommissionDocument } from '../services/commissionService';

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
    // Both listing counts in ONE pass: a filtered aggregate reads the rows
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

/** What joining answers: the dashboard, and whether this call created the partner. */
export interface JoinPartnerResult {
  readonly created: boolean;
  readonly payload: PartnerMeResponse;
}

/**
 * Idempotent opt-in: the existing Partner if the person already joined
 * (re-activated if it was inactive), otherwise a new one with a freshly minted
 * unique referral code. `displayName` only seeds the code's slug.
 */
export async function joinPartnerProgram(
  oxyUserId: string,
  input: { displayName?: string } = {},
): Promise<JoinPartnerResult> {
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
    return { created: false, payload: await buildMeResponse(partner) };
  }

  const referralCode = await generateReferralCode(input.displayName);
  const [partner] = await getDb()
    .insert(partners)
    .values({ oxyUserId, referralCode, status: 'active', points: 0 })
    .returning();

  logger.info('Partner joined', { partnerId: partner.id, userId: oxyUserId, referralCode });
  return { created: true, payload: await buildMeResponse(partner) };
}

/** The person's partner profile, referral link and live stats (zeroed when not joined). */
export async function getMyPartnerStatus(oxyUserId: string): Promise<PartnerMeResponse> {
  return buildMeResponse(await findPartnerByOxyUserId(oxyUserId));
}

/** The properties sourced by the person's referral link, newest first. */
export async function listMyReferrals(
  oxyUserId: string,
): Promise<{ joined: boolean; properties: ReturnType<typeof serializeProperty>[] }> {
  const partner = await findPartnerByOxyUserId(oxyUserId);
  if (!partner) return { joined: false, properties: [] };
  // Through the shared read repository, so a partner's referral list is the
  // same listing shape (address join, photos, calendar) every other feed
  // serves, the same body as `GET /properties`.
  const sourced = await findProperties({
    where: allOf([eq(properties.sourcedByPartnerId, partner.id)]),
    orderBy: propertyOrderBy(NEWEST_FIRST),
  });
  return {
    joined: true,
    properties: sourced.map((listing) => serializeProperty(listing, 'public')),
  };
}

/** The person's commission ledger, newest first. */
export async function getMyPartnerEarnings(
  oxyUserId: string,
): Promise<{ joined: boolean; commissions: ReturnType<typeof toCommissionDocument>[] }> {
  const partner = await findPartnerByOxyUserId(oxyUserId);
  if (!partner) return { joined: false, commissions: [] };
  const rows = await getDb()
    .select()
    .from(commissions)
    .where(eq(commissions.partnerId, partner.id))
    .orderBy(desc(commissions.createdAt));
  return { joined: true, commissions: rows.map(toCommissionDocument) };
}
