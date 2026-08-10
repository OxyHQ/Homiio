/**
 * Who may read a case's EXACT location, for how long, and what they did with it.
 *
 * ADR 0003 §10 in code. The five properties it requires are each a line here
 * rather than a convention:
 *
 *  1. **Relationship-derived.** Only the case's organiser can grant, and the
 *     organiser is resolved from the session, never from the body.
 *  2. **Purpose-bound.** A grant names one of three concrete purposes. There is
 *     no "other".
 *  3. **Time-bound.** `expires_at` is `NOT NULL` and clamped to
 *     {@link MAX_GRANT_HOURS}; there is no non-expiring shape to express.
 *  4. **Revocable.** `revoked_at` frees the partial unique so a fresh grant can
 *     be issued, and a revoked grant is never resurrected.
 *  5. **Audited.** {@link resolveExactLocation} writes a row for every outcome,
 *     including every REFUSAL — an audit that only records successes cannot
 *     answer the question anybody actually asks it.
 *
 * ## The refusal path is audited, and that is the half people leave out
 *
 * A `denied` row with a reason is what turns "did anybody try to look at this?"
 * into a question with an answer. Without it the log shows a quiet gap that
 * reads identically whether nobody tried or the guard silently swallowed the
 * attempt — the same "a check that cannot distinguish success from failure"
 * shape this repository avoids everywhere else.
 *
 * ## The exact location is never disclosed just because it exists
 *
 * Two independent gates, and both must pass: the affected household must have
 * authorised exact disclosure AT ALL (`location_household_authorized_at`), and
 * this caller must hold a live grant. A case with a stored exact point and no
 * grant discloses nothing; a grant on a case the household never authorised
 * discloses nothing either.
 */

import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  EvictionLocationAccessPurpose,
  type EvictionLocationPrivate,
} from '@homiio/shared-types';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import {
  evictionCases,
  evictionLocationAccessAudit,
  evictionLocationGrants,
} from '../schema/evictions';
import { readExactLocation } from './evictionRepository';

export type EvictionLocationGrantRow = typeof evictionLocationGrants.$inferSelect;
export type EvictionLocationAuditRow = typeof evictionLocationAccessAudit.$inferSelect;

/**
 * The longest a single grant may last.
 *
 * 72 hours covers the days around a scheduled eviction, which is the whole
 * window any of the three purposes needs. A grant that outlives the event it
 * was issued for is standing access wearing an expiry date.
 */
export const MAX_GRANT_HOURS = 72;

/**
 * The column value → enum member map.
 *
 * The column's type is the string-literal union its CHECK is built from and the
 * wire type is a TypeScript enum; a literal is not assignable to one. An
 * exhaustive record is how that conversion stays compiler-checked — adding a
 * purpose fails to compile here until it is mapped, rather than being cast past
 * the type system with an `as`.
 */
const PURPOSE_BY_COLUMN_VALUE: Readonly<
  Record<EvictionLocationGrantRow['purpose'], EvictionLocationAccessPurpose>
> = {
  legal_representation: EvictionLocationAccessPurpose.LEGAL_REPRESENTATION,
  accompaniment: EvictionLocationAccessPurpose.ACCOMPANIMENT,
  emergency_housing: EvictionLocationAccessPurpose.EMERGENCY_HOUSING,
};

/** Append one audit row. Every path through this module calls it. */
async function appendAudit(
  entry: {
    readonly caseId: string;
    readonly actorOxyUserId: string;
    readonly action: EvictionLocationAuditRow['action'];
    readonly purpose?: EvictionLocationAccessPurpose;
    readonly denialReason?: NonNullable<EvictionLocationAuditRow['denialReason']>;
  },
  db: DatabaseOrTransaction,
): Promise<void> {
  await db.insert(evictionLocationAccessAudit).values({
    caseId: entry.caseId,
    actorOxyUserId: entry.actorOxyUserId,
    action: entry.action,
    purpose: entry.purpose ?? null,
    denialReason: entry.denialReason ?? null,
  });
}

/**
 * Issue or extend one actor's grant.
 *
 * `ON CONFLICT … DO UPDATE` against the PARTIAL unique index, and the arbiter
 * predicate (`targetWhere`) is mandatory rather than decorative: omitting it on
 * a partial unique is `42P10` at runtime with a clean `tsc` and a passing mock.
 *
 * Re-granting EXTENDS rather than duplicates, so the audit reads as one
 * relationship with a moving deadline instead of a pile of overlapping rows
 * nobody can reconcile.
 */
export async function grantLocationAccess(
  input: {
    readonly caseId: string;
    readonly granteeOxyUserId: string;
    readonly grantedByOxyUserId: string;
    readonly purpose: EvictionLocationAccessPurpose;
    readonly hours: number;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionLocationGrantRow> {
  const hours = Math.min(Math.max(1, Math.floor(input.hours)), MAX_GRANT_HOURS);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const [row] = await db
    .insert(evictionLocationGrants)
    .values({
      caseId: input.caseId,
      granteeOxyUserId: input.granteeOxyUserId,
      grantedByOxyUserId: input.grantedByOxyUserId,
      purpose: input.purpose,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [evictionLocationGrants.caseId, evictionLocationGrants.granteeOxyUserId],
      targetWhere: isNull(evictionLocationGrants.revokedAt),
      set: { expiresAt, purpose: input.purpose, grantedByOxyUserId: input.grantedByOxyUserId },
    })
    .returning();

  await appendAudit(
    {
      caseId: input.caseId,
      actorOxyUserId: input.grantedByOxyUserId,
      action: 'granted',
      purpose: input.purpose,
    },
    db,
  );
  return row;
}

/** Withdraw one actor's grant. Idempotent by predicate, not by a preceding read. */
export async function revokeLocationAccess(
  input: {
    readonly caseId: string;
    readonly granteeOxyUserId: string;
    readonly revokedByOxyUserId: string;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const revoked = await db
    .update(evictionLocationGrants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(evictionLocationGrants.caseId, input.caseId),
        eq(evictionLocationGrants.granteeOxyUserId, input.granteeOxyUserId),
        isNull(evictionLocationGrants.revokedAt),
      ),
    )
    .returning({ id: evictionLocationGrants.id });

  if (revoked.length === 1) {
    await appendAudit(
      {
        caseId: input.caseId,
        actorOxyUserId: input.revokedByOxyUserId,
        action: 'revoked',
      },
      db,
    );
  }
  return revoked.length === 1;
}

/** The live (unrevoked, unexpired) grant this actor holds, if any. */
export async function findLiveGrant(
  caseId: string,
  granteeOxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionLocationGrantRow | undefined> {
  const [row] = await db
    .select()
    .from(evictionLocationGrants)
    .where(
      and(
        eq(evictionLocationGrants.caseId, caseId),
        eq(evictionLocationGrants.granteeOxyUserId, granteeOxyUserId),
        isNull(evictionLocationGrants.revokedAt),
        // `now()` in the predicate rather than a JS `Date`: a clock skew between
        // the API task and the database would otherwise decide whether a grant
        // is live, and the database is the one holding the deadline.
        gt(evictionLocationGrants.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return row;
}

/** Why an exact-location read was refused, or the private location it returned. */
export type ExactLocationOutcome =
  | { readonly outcome: 'granted'; readonly location: EvictionLocationPrivate }
  | {
      readonly outcome: 'denied';
      readonly reason: NonNullable<EvictionLocationAuditRow['denialReason']>;
    };

/**
 * Serve the exact location to a caller, or refuse — auditing either way.
 *
 * The ONLY function in this package that returns an exact eviction coordinate.
 * Everything upstream of it deals in the published disc, which is why the
 * refusal reasons are distinguishable: `not_authorized_by_household` and
 * `no_grant` are different facts and a caller told only "denied" cannot know
 * whether asking the organiser would help.
 */
export async function resolveExactLocation(
  input: {
    readonly caseId: string;
    readonly requesterOxyUserId: string;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<ExactLocationOutcome> {
  const stored = await readExactLocation(input.caseId, db);

  const deny = async (
    reason: NonNullable<EvictionLocationAuditRow['denialReason']>,
  ): Promise<ExactLocationOutcome> => {
    await appendAudit(
      {
        caseId: input.caseId,
        actorOxyUserId: input.requesterOxyUserId,
        action: 'denied',
        denialReason: reason,
      },
      db,
    );
    return { outcome: 'denied', reason };
  };

  if (!stored || stored.householdAuthorizedAt === null) {
    return deny('not_authorized_by_household');
  }

  const grant = await findLiveGrant(input.caseId, input.requesterOxyUserId, db);
  if (!grant) {
    // A revoked or expired grant is a DIFFERENT fact from never having had one,
    // and the audit has to say which — so the reason comes from the row's own
    // state rather than from the absence of a live one.
    const [any] = await db
      .select({ revokedAt: evictionLocationGrants.revokedAt, expiresAt: evictionLocationGrants.expiresAt })
      .from(evictionLocationGrants)
      .where(
        and(
          eq(evictionLocationGrants.caseId, input.caseId),
          eq(evictionLocationGrants.granteeOxyUserId, input.requesterOxyUserId),
        ),
      )
      .orderBy(desc(evictionLocationGrants.grantedAt))
      .limit(1);
    if (!any) return deny('no_grant');
    return deny(any.revokedAt !== null ? 'revoked' : 'expired');
  }

  await appendAudit(
    {
      caseId: input.caseId,
      actorOxyUserId: input.requesterOxyUserId,
      action: 'read',
      purpose: PURPOSE_BY_COLUMN_VALUE[grant.purpose],
    },
    db,
  );

  return {
    outcome: 'granted',
    location: {
      exactCoordinates:
        stored.longitude !== null && stored.latitude !== null
          ? [stored.longitude, stored.latitude]
          : undefined,
      exactAddress: stored.address ?? undefined,
      accessPolicy: {
        householdAuthorizedExact: true,
        householdAuthorizedAt: stored.householdAuthorizedAt.toISOString(),
        maxGrantHours: MAX_GRANT_HOURS,
      },
    },
  };
}

/**
 * Every access decision on one case, newest first.
 *
 * Readable by the organiser, who is the accountable party — ADR 0003 §10.6 puts
 * the audit in the hands of whoever has the strongest interest in noticing an
 * improper access, and the affected household is deliberately not a stored
 * actor, so there is nobody else it can be handed to. Callers enforce that;
 * this function performs no authorisation, exactly like `readExactLocation`.
 */
export async function listAccessAudit(
  caseId: string,
  limit: number,
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly EvictionLocationAuditRow[]> {
  return db
    .select()
    .from(evictionLocationAccessAudit)
    .where(eq(evictionLocationAccessAudit.caseId, caseId))
    .orderBy(desc(evictionLocationAccessAudit.createdAt), desc(evictionLocationAccessAudit.id))
    .limit(limit);
}

/** The live grants on one case, for the organiser's own management screen. */
export async function listLiveGrants(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly EvictionLocationGrantRow[]> {
  return db
    .select()
    .from(evictionLocationGrants)
    .where(
      and(
        eq(evictionLocationGrants.caseId, caseId),
        isNull(evictionLocationGrants.revokedAt),
        gt(evictionLocationGrants.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(evictionLocationGrants.grantedAt));
}

/** Whether a case's household authorised exact disclosure at all. */
export async function isHouseholdAuthorized(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const [row] = await db
    .select({ authorizedAt: evictionCases.locationHouseholdAuthorizedAt })
    .from(evictionCases)
    .where(eq(evictionCases.id, caseId))
    .limit(1);
  return row?.authorizedAt !== null && row?.authorizedAt !== undefined;
}
