/**
 * Carrying out a decision, exactly once.
 *
 * Two guarantees, and everything here exists for one of them.
 *
 * **Once.** The idempotency key is `decisionId + revision + action`, and the
 * unique index on `ModerationEnforcement` IS that key. Each action CLAIMS its
 * row before doing anything; a second attempt — a redelivered webhook, a
 * reclaimed outbox lease, a manual replay — loses the insert and does nothing.
 * Reading "have I done this?" and then acting would leave the gap between the
 * two, which is exactly when a redelivery arrives.
 *
 * **Reversibly.** Every action that changes state records what the state WAS,
 * and a reversal puts that back. So a correction does not clear a review's
 * `under_review` that the community's own report counter set, and a restore
 * returns an object to the state it actually had rather than to a guess at one.
 *
 * `observe` mode runs all of this except the effect. That is deliberate: the
 * plan, the claim and the record are identical to production, so what the mode
 * proves is exactly what will happen when it is switched off — and the audit
 * trail is real rather than a log line saying a decision was seen.
 */

import mongoose from 'mongoose';
import type { Decision } from '@oxyhq/crowdsource-contracts';
import {
  ModerationReportedType,
  ReviewModerationStatus,
  type ModerationEnforcementAction,
  type ModerationEnforcementMode,
} from '@homiio/shared-types';
import ModerationEnforcement, {
  type IModerationEnforcement,
} from '../../models/ModerationEnforcement';
import { Property, Review } from '../../models';
import config from '../../config';
import { logger } from '../../middlewares/logging';
import { planEnforcement, type PlannedEnforcementAction } from './enforcementPlan';

export interface EnforcementSubject {
  /** Homiio's own noun (`property`, `review`, …). */
  type: string;
  id: string;
}

export interface EnforcementOutcome {
  action: ModerationEnforcementAction;
  /**
   * `applied` — the effect happened. `recorded` — claimed and deliberately not
   * carried out (observe/manual mode, no such effect for this noun, or nothing
   * to undo). `duplicate` — another delivery of this same decision revision
   * already handled it.
   */
  result: 'applied' | 'recorded' | 'duplicate';
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    Number((error as { code?: unknown }).code) === 11000
  );
}

/** What was there before, so a reversal can put it back. */
type PreviousState = IModerationEnforcement['previousState'];

type EffectResult =
  | { changed: true; previousState?: PreviousState }
  | { changed: false; reason: string };

interface PropertyState {
  moderation?: { restricted?: boolean };
}

interface ReviewState {
  moderationStatus?: string;
}

/**
 * Whether an earlier APPLIED enforcement of this action is on record for this
 * object.
 *
 * The question a reversal has to answer: did MODERATION do this, or was it
 * already true for some other reason? A review sitting at `under_review` because
 * three users reported it is the community's own state, and lifting it because a
 * jury said "no violation" about something else would undo a signal moderation
 * never set.
 */
async function hasAppliedEnforcement(
  subject: EnforcementSubject,
  action: ModerationEnforcementAction,
): Promise<boolean> {
  const record = await ModerationEnforcement.findOne({
    subjectType: subject.type,
    subjectId: subject.id,
    action,
    applied: true,
  })
    .sort({ createdAt: -1 })
    .select('_id')
    .lean<{ _id: mongoose.Types.ObjectId } | null>();
  return record !== null;
}

/**
 * The effect on a property listing.
 *
 * `restrict` writes the server-only `moderation.restricted` flag that every
 * public read excludes. It is deliberately NOT a `status` value: `status` is
 * user-editable, so a restricted listing's owner could clear the restriction
 * themselves.
 *
 * A property has no "contested" mark, so `flag_for_review` and `unflag` are
 * recorded with the reason and change nothing. That is the honest answer —
 * Homiio has no content warning and no distribution dial, and writing a row that
 * claimed an effect which does not exist would make the audit trail a fiction.
 */
async function applyToProperty(
  action: ModerationEnforcementAction,
  subject: EnforcementSubject,
  decision: Decision,
): Promise<EffectResult> {
  if (!mongoose.isValidObjectId(subject.id)) {
    return { changed: false, reason: 'The reported listing id is not a valid identifier' };
  }
  const current = await Property.findById(subject.id)
    .select('moderation.restricted')
    .lean<PropertyState | null>();
  if (!current) return { changed: false, reason: 'The reported listing no longer exists' };

  switch (action) {
    case 'restrict': {
      if (current.moderation?.restricted === true) {
        return { changed: false, reason: 'The listing was already restricted' };
      }
      await Property.updateOne(
        { _id: subject.id },
        {
          $set: {
            'moderation.restricted': true,
            'moderation.restrictedAt': new Date(),
            'moderation.restrictedByDecisionId': decision.id,
          },
        },
      );
      return { changed: true, previousState: { propertyModerationRestricted: false } };
    }

    case 'restore': {
      if (current.moderation?.restricted !== true) {
        return { changed: false, reason: 'The listing was not restricted' };
      }
      await Property.updateOne(
        { _id: subject.id },
        {
          $set: { 'moderation.restricted': false },
          $unset: { 'moderation.restrictedAt': '', 'moderation.restrictedByDecisionId': '' },
        },
      );
      return { changed: true, previousState: { propertyModerationRestricted: true } };
    }

    case 'flag_for_review':
    case 'unflag':
      return {
        changed: false,
        reason: `Homiio has no '${action}' effect for a listing`,
      };

    case 'none':
    case 'manual_review':
      return { changed: false, reason: `Action '${action}' has no effect by definition` };
  }
}

/**
 * The effect on an address review.
 *
 * `restrict` sets `moderationStatus: 'removed'`, which hides the review from
 * every public read. **That status has been unreachable in Homiio until now, by
 * decision** — Homiio has no admin or moderator surfaces and the removal of a
 * review has deliberately never been anyone's to perform. A randomly drawn
 * community jury is arguably the one authority that fits, but making it
 * reachable is a product decision, not an engineering one, and it needs the
 * project owner's sign-off before `CROWDSOURCE_ENFORCEMENT_MODE` leaves
 * `observe`. Until then this branch is planned, recorded and never executed.
 *
 * `flag_for_review` maps onto `under_review`, which Homiio already sets itself
 * once three distinct users report a review. That overlap is why the reversal
 * below checks who set it.
 */
async function applyToReview(
  action: ModerationEnforcementAction,
  subject: EnforcementSubject,
): Promise<EffectResult> {
  if (!mongoose.isValidObjectId(subject.id)) {
    return { changed: false, reason: 'The reported review id is not a valid identifier' };
  }
  const current = await Review.findById(subject.id)
    .select('moderationStatus')
    .lean<ReviewState | null>();
  if (!current) return { changed: false, reason: 'The reported review no longer exists' };

  switch (action) {
    case 'restrict': {
      if (current.moderationStatus === ReviewModerationStatus.REMOVED) {
        return { changed: false, reason: 'The review was already removed' };
      }
      await Review.updateOne(
        { _id: subject.id },
        { $set: { moderationStatus: ReviewModerationStatus.REMOVED } },
      );
      return {
        changed: true,
        previousState: {
          reviewModerationStatus: current.moderationStatus ?? ReviewModerationStatus.ACTIVE,
        },
      };
    }

    case 'restore': {
      if (current.moderationStatus !== ReviewModerationStatus.REMOVED) {
        return { changed: false, reason: 'The review was not removed' };
      }
      /**
       * Restored to what it WAS, read off the enforcement row that removed it —
       * not to a hardcoded `active`. A review that was already `under_review`
       * from the community's own report counter must come back to
       * `under_review`, not have that signal quietly cleared by a correction.
       */
      const removal = await ModerationEnforcement.findOne({
        subjectType: subject.type,
        subjectId: subject.id,
        action: 'restrict',
        applied: true,
      })
        .sort({ createdAt: -1 })
        .lean<Pick<IModerationEnforcement, 'previousState'> | null>();
      const restoreTo =
        removal?.previousState?.reviewModerationStatus ?? ReviewModerationStatus.ACTIVE;
      await Review.updateOne({ _id: subject.id }, { $set: { moderationStatus: restoreTo } });
      return {
        changed: true,
        previousState: { reviewModerationStatus: ReviewModerationStatus.REMOVED },
      };
    }

    case 'flag_for_review': {
      if (current.moderationStatus !== ReviewModerationStatus.ACTIVE) {
        return { changed: false, reason: 'The review was not active' };
      }
      await Review.updateOne(
        { _id: subject.id },
        { $set: { moderationStatus: ReviewModerationStatus.UNDER_REVIEW } },
      );
      return {
        changed: true,
        previousState: { reviewModerationStatus: ReviewModerationStatus.ACTIVE },
      };
    }

    case 'unflag': {
      if (current.moderationStatus !== ReviewModerationStatus.UNDER_REVIEW) {
        return { changed: false, reason: 'The review was not under review' };
      }
      /**
       * Only lifted if MODERATION set it. Homiio raises `under_review` itself
       * once three distinct users report a review, and clearing that because a
       * jury answered a different question would erase a community signal nobody
       * asked us to touch — visible to no-one until the review reappeared.
       */
      if (!(await hasAppliedEnforcement(subject, 'flag_for_review'))) {
        return {
          changed: false,
          reason: 'The review was flagged by Homiio’s own report counter, not by moderation',
        };
      }
      await Review.updateOne(
        { _id: subject.id },
        { $set: { moderationStatus: ReviewModerationStatus.ACTIVE } },
      );
      return {
        changed: true,
        previousState: { reviewModerationStatus: ReviewModerationStatus.UNDER_REVIEW },
      };
    }

    case 'none':
    case 'manual_review':
      return { changed: false, reason: `Action '${action}' has no effect by definition` };
  }
}

/**
 * The effect of one action, or why there was none.
 *
 * Returns the state that was replaced, so the record can reverse it later. A
 * `changed: false` result means the action was claimed and correctly did nothing
 * — the object is already gone, there was no restriction to undo, or Homiio has
 * no such lever for this noun. That is a different thing from a failure and is
 * recorded as such.
 */
async function applyEffect(
  action: ModerationEnforcementAction,
  subject: EnforcementSubject,
  decision: Decision,
): Promise<EffectResult> {
  switch (subject.type) {
    case ModerationReportedType.PROPERTY:
      return await applyToProperty(action, subject, decision);
    case ModerationReportedType.REVIEW:
      return await applyToReview(action, subject);
    default:
      /**
       * A reported noun with no enforcement path — an eviction case today.
       * Recorded for a human rather than silently dropped: a decision that
       * arrived and could not be carried out is a fact somebody needs.
       */
      return {
        changed: false,
        reason: `Homiio has no '${action}' effect for a reported ${subject.type}`,
      };
  }
}

/**
 * Whether the current mode allows this action to actually happen.
 *
 * `observe` allows nothing — that is the mode. `manual` allows the reversible,
 * give-something-back half (`restore`, `unflag`): holding those behind a human
 * means a wrongly-restricted listing stays hidden while somebody reads a queue,
 * and Homiio has no queue and no reader. Taking something down still waits for
 * `automatic`.
 */
function modeAllows(
  mode: ModerationEnforcementMode,
  action: ModerationEnforcementAction,
): boolean {
  switch (mode) {
    case 'observe':
      return false;
    case 'manual':
      return action === 'restore' || action === 'unflag';
    case 'automatic':
      return true;
  }
}

export interface ApplyDecisionEnforcementInput {
  decision: Decision;
  caseId: string;
  subject: EnforcementSubject;
  /** Defaults to the configured mode. Explicit in tests. */
  mode?: ModerationEnforcementMode;
}

/**
 * Plan and carry out everything this decision revision asks for.
 *
 * Returns one outcome per planned action, in plan order, so a caller can record
 * what happened without asking a second time.
 */
export async function applyDecisionEnforcement(
  input: ApplyDecisionEnforcementInput,
): Promise<EnforcementOutcome[]> {
  const mode = input.mode ?? config.crowdSource.enforcementMode;
  const plan = planEnforcement(input.decision);
  const outcomes: EnforcementOutcome[] = [];

  for (const planned of plan) {
    outcomes.push(await applyOne(planned, input, mode));
  }
  return outcomes;
}

async function applyOne(
  planned: PlannedEnforcementAction,
  input: ApplyDecisionEnforcementInput,
  mode: ModerationEnforcementMode,
): Promise<EnforcementOutcome> {
  const { decision, caseId, subject } = input;

  /**
   * The claim. The unique index refuses a second row for this
   * `decisionId + revision + action`, so losing this insert is the answer
   * "another delivery already handled it" and not an error.
   */
  let record: IModerationEnforcement;
  try {
    record = await ModerationEnforcement.create({
      decisionId: decision.id,
      decisionRevision: decision.revision,
      action: planned.action,
      caseId,
      subjectType: subject.type,
      subjectId: subject.id,
      outcome: decision.outcome,
      ...(planned.recommendedAction === undefined
        ? {}
        : { recommendedAction: planned.recommendedAction }),
      reason: planned.reason,
      mode,
      applied: false,
    });
  } catch (error: unknown) {
    if (isDuplicateKeyError(error)) {
      return { action: planned.action, result: 'duplicate' };
    }
    throw error;
  }

  if (!modeAllows(mode, planned.action)) {
    await ModerationEnforcement.updateOne(
      { _id: record._id },
      {
        $set: {
          skippedReason:
            mode === 'observe'
              ? 'observe mode: recorded, not applied'
              : `${mode} mode does not apply '${planned.action}' automatically`,
        },
      },
    );
    return { action: planned.action, result: 'recorded' };
  }

  try {
    const effect = await applyEffect(planned.action, subject, decision);
    if (!effect.changed) {
      await ModerationEnforcement.updateOne(
        { _id: record._id },
        { $set: { skippedReason: effect.reason } },
      );
      return { action: planned.action, result: 'recorded' };
    }

    await ModerationEnforcement.updateOne(
      { _id: record._id },
      {
        $set: {
          applied: true,
          appliedAt: new Date(),
          ...(effect.previousState === undefined
            ? {}
            : { previousState: effect.previousState }),
        },
      },
    );
    return { action: planned.action, result: 'applied' };
  } catch (error: unknown) {
    /**
     * The claim goes back so a retry can try again. Keeping it would make a
     * transient failure permanent: the action would be deduplicated away forever
     * and the decision would silently never be carried out.
     */
    await ModerationEnforcement.deleteOne({ _id: record._id });
    logger.error('[CrowdSource] enforcement effect failed, claim released', {
      decisionId: decision.id,
      revision: decision.revision,
      action: planned.action,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
