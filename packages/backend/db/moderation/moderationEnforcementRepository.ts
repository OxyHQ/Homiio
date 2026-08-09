/**
 * `moderation_enforcements` — what Homiio did about a decision, one row per
 * action, and the two subject levers those actions pull.
 *
 * ## The claim is the UNIQUE INDEX, and `revision` is in it
 *
 * `moderation_enforcements_decision_action_key` covers
 * `(decision_id, decision_revision, action)`, and {@link claimEnforcement}
 * inserts against it with `ON CONFLICT DO NOTHING`. That IS the idempotency: a
 * redelivered webhook, a reclaimed outbox lease and a manual replay all try to
 * insert the same row and only the first gets one back. Checking "have I done
 * this?" with a read before the write would leave the window between them, which
 * is precisely the window a redelivery arrives in.
 *
 * `revision` is in the key for a reason of its own. A correction is a NEW
 * revision that supersedes the old one, so the `restore` it asks for is a
 * DIFFERENT action from the `restrict` that came before and must be allowed to
 * happen — while still being impossible to apply twice itself. Drop `revision`
 * and an upheld appeal can never put a listing back.
 *
 * ## Two `isValidObjectId` guards are deliberately NOT ported
 *
 * The Mongo effects opened with `if (!mongoose.isValidObjectId(subject.id))
 * return { changed: false }`. `db/ids.ts` states the rule that retires them: a
 * shape guard is for a 400 at an API boundary and is NEVER a precondition on a
 * query. Post-cutover every id minted by `generatedId()` is a uuid v7, for which
 * `isValidObjectId` is FALSE — so keeping the guard would silently make every
 * listing and review created after the cutover permanently un-enforceable, while
 * still reporting `changed: false` as though it had looked. The query already
 * answers "no such row" for free, and for every id shape.
 *
 * ## `previousState` is what makes reversibility real
 *
 * A restore returns the object to what it WAS, read off the enforcement row that
 * removed it — not to a hardcoded `active`. A review that was already
 * `under_review` from Homiio's own report counter must come back to
 * `under_review`, not have that signal quietly cleared by a correction.
 */

import { and, desc, eq } from 'drizzle-orm';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import { moderationEnforcements } from '../schema/moderation';
import { properties } from '../schema/properties';
import { reviews } from '../schema/reviews';

export type ModerationEnforcementRow = typeof moderationEnforcements.$inferSelect;
export type ModerationEnforcementInsert = typeof moderationEnforcements.$inferInsert;

/**
 * Take the claim for one planned action.
 *
 * @returns The claimed row, or `undefined` when another delivery already holds
 *   this `(decisionId, revision, action)` — which is an ANSWER, not an error.
 */
export async function claimEnforcement(
  values: ModerationEnforcementInsert,
  db: DatabaseOrTransaction = getDb(),
): Promise<ModerationEnforcementRow | undefined> {
  const [row] = await db
    .insert(moderationEnforcements)
    .values(values)
    .onConflictDoNothing({
      target: [
        moderationEnforcements.decisionId,
        moderationEnforcements.decisionRevision,
        moderationEnforcements.action,
      ],
    })
    .returning();
  return row;
}

/** Record that a claimed action was deliberately not carried out. */
export async function markEnforcementSkipped(
  enforcementId: string,
  skippedReason: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db
    .update(moderationEnforcements)
    .set({ skippedReason })
    .where(eq(moderationEnforcements.id, enforcementId));
}

/**
 * Record that a claimed action WAS carried out, with what it replaced.
 *
 * `applied` and `applied_at` are written in one statement because
 * `moderation_enforcements_applied_at_check` enforces the biconditional between
 * them: the distinction this table exists to preserve is between a plan that was
 * RECORDED and one that was EXECUTED, and either column without the other erases
 * exactly that.
 */
export async function markEnforcementApplied(
  input: {
    readonly enforcementId: string;
    readonly appliedAt?: Date;
    readonly previousState?: {
      readonly propertyModerationRestricted?: boolean;
      readonly reviewModerationStatus?: (typeof reviews.$inferSelect)['moderationStatus'];
    };
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db
    .update(moderationEnforcements)
    .set({
      applied: true,
      appliedAt: input.appliedAt ?? new Date(),
      ...(input.previousState?.propertyModerationRestricted === undefined
        ? {}
        : {
            previousStatePropertyModerationRestricted:
              input.previousState.propertyModerationRestricted,
          }),
      ...(input.previousState?.reviewModerationStatus === undefined
        ? {}
        : { previousStateReviewModerationStatus: input.previousState.reviewModerationStatus }),
    })
    .where(eq(moderationEnforcements.id, input.enforcementId));
}

/**
 * Give a claim back after the effect failed.
 *
 * Keeping it would make a transient failure permanent: the action would be
 * deduplicated away forever and the decision would silently never be carried
 * out.
 */
export async function releaseEnforcementClaim(
  enforcementId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db.delete(moderationEnforcements).where(eq(moderationEnforcements.id, enforcementId));
}

/**
 * Whether an earlier APPLIED enforcement of THIS action is on record for this
 * subject.
 *
 * The action is part of the question, not a detail: what a reversal needs to
 * know is whether MODERATION produced the current state, or whether it was
 * already true for some other reason. A review sitting at `under_review` because
 * three users reported it is the community's own state, and lifting it because a
 * jury said "no violation" about something else would undo a signal moderation
 * never set.
 */
export async function hasAppliedEnforcement(
  subject: { readonly type: string; readonly id: string },
  action: ModerationEnforcementRow['action'],
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const [row] = await db
    .select({ id: moderationEnforcements.id })
    .from(moderationEnforcements)
    .where(
      and(
        eq(moderationEnforcements.subjectType, subject.type),
        eq(moderationEnforcements.subjectId, subject.id),
        eq(moderationEnforcements.action, action),
        eq(moderationEnforcements.applied, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * The most recent APPLIED `restrict` on this subject — the row a `restore` reads
 * its target state from.
 */
export async function findLatestAppliedRestriction(
  subject: { readonly type: string; readonly id: string },
  db: DatabaseOrTransaction = getDb(),
): Promise<ModerationEnforcementRow | undefined> {
  const [row] = await db
    .select()
    .from(moderationEnforcements)
    .where(
      and(
        eq(moderationEnforcements.subjectType, subject.type),
        eq(moderationEnforcements.subjectId, subject.id),
        eq(moderationEnforcements.action, 'restrict'),
        eq(moderationEnforcements.applied, true),
      ),
    )
    .orderBy(desc(moderationEnforcements.createdAt))
    .limit(1);
  return row;
}

/** Every action taken about one subject, newest first. */
export async function listEnforcementsForSubject(
  subject: { readonly type: string; readonly id: string },
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly ModerationEnforcementRow[]> {
  return db
    .select()
    .from(moderationEnforcements)
    .where(
      and(
        eq(moderationEnforcements.subjectType, subject.type),
        eq(moderationEnforcements.subjectId, subject.id),
      ),
    )
    .orderBy(desc(moderationEnforcements.createdAt));
}

// ── The two subject levers ────────────────────────────────────────────────────
//
// These live here rather than in `db/properties/` or a reviews repository
// because `properties.moderation_restricted` and its two companions have exactly
// ONE writer, and it is the enforcement path. `db/MIGRATION-CONTRACT.md` records
// that as a fact about the data (99.99 % of production rows carry no moderation
// object at all, and re-ingesting does not add one); keeping the writer beside
// the audit row it commits with is what stops a second one appearing.

/** The current restriction flag of a listing, or `undefined` if it is gone. */
export async function findPropertyRestriction(
  propertyId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean | undefined> {
  const [row] = await db
    .select({ restricted: properties.moderationRestricted })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return row?.restricted;
}

/**
 * Set or clear a listing's restriction.
 *
 * `restricted` is deliberately NOT a `status` value: `status` is user-editable,
 * so a restricted listing's owner could otherwise clear the restriction
 * themselves. Clearing it nulls the two provenance columns in the same
 * statement, so a cleared row never keeps a stale decision id claiming it is
 * still restricted.
 */
export async function setPropertyRestriction(
  input: {
    readonly propertyId: string;
    readonly restricted: boolean;
    readonly decisionId?: string;
    readonly now?: Date;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const updated = await db
    .update(properties)
    .set(
      input.restricted
        ? {
            moderationRestricted: true,
            moderationRestrictedAt: input.now ?? new Date(),
            moderationRestrictedByDecisionId: input.decisionId ?? null,
          }
        : {
            moderationRestricted: false,
            moderationRestrictedAt: null,
            moderationRestrictedByDecisionId: null,
          },
    )
    .where(eq(properties.id, input.propertyId))
    .returning({ id: properties.id });
  return updated.length === 1;
}

/** The current moderation status of a review, or `undefined` if it is gone. */
export async function findReviewModerationStatus(
  reviewId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<(typeof reviews.$inferSelect)['moderationStatus'] | undefined> {
  const [row] = await db
    .select({ moderationStatus: reviews.moderationStatus })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);
  return row?.moderationStatus;
}

/** Set a review's moderation status. */
export async function setReviewModerationStatus(
  reviewId: string,
  moderationStatus: (typeof reviews.$inferSelect)['moderationStatus'],
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const updated = await db
    .update(reviews)
    .set({ moderationStatus })
    .where(eq(reviews.id, reviewId))
    .returning({ id: reviews.id });
  return updated.length === 1;
}
