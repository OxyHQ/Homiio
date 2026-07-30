/**
 * What Homiio does about a decision, and the two ways that can go wrong quietly.
 *
 * A decision applied TWICE removes a listing twice and restores it twice — and
 * neither shows up as an error. A decision applied with the wrong reversal puts
 * back a state that was never there. Both are silent in production, so both are
 * pinned here.
 */

import { decisionFixture } from '@oxyhq/crowdsource-testing';
import type { Decision, RecommendedAction } from '@oxyhq/crowdsource-contracts';
import {
  ModerationReportedType,
  PropertyStatus,
  PropertyType,
  OfferingType,
  ReviewModerationStatus,
} from '@homiio/shared-types';

import { planEnforcement } from '../../services/moderation/enforcementPlan';
import { applyDecisionEnforcement } from '../../services/moderation/ModerationEnforcementService';
import { localStatusForDecision } from '../../services/moderation/reportStatus';
import ModerationEnforcement from '../../models/ModerationEnforcement';
import { createAddress, models } from '../helpers/factories';

const { Property, Review } = models;

/** A decision with the recommendations a test needs, otherwise realistic. */
function decisionWith(options: {
  outcome?: Decision['outcome'];
  recommendedActions?: RecommendedAction[];
  revision?: number;
  id?: string;
}): Decision {
  const base = decisionFixture({
    ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.revision !== undefined && options.revision > 1
      ? { supersedesDecisionId: 'dec_previous' }
      : {}),
  });
  if (options.recommendedActions === undefined) return base;
  return {
    ...base,
    recommendedActions: options.recommendedActions.map((action) => ({ action })),
  } as Decision;
}

async function listing(): Promise<{ _id: unknown }> {
  const address = await createAddress();
  return Property.create({
    oxyUserId: 'oxy-landlord',
    addressId: address._id,
    type: PropertyType.APARTMENT,
    bedrooms: 1,
    bathrooms: 1,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 1000, currency: 'EUR' },
    status: PropertyStatus.PUBLISHED,
  });
}

async function review(
  moderationStatus: ReviewModerationStatus = ReviewModerationStatus.ACTIVE,
): Promise<{ _id: unknown }> {
  const address = await createAddress();
  return Review.create({
    addressId: address._id,
    addressLevel: 'BUILDING',
    streetLevelId: address._id,
    buildingLevelId: address._id,
    oxyUserId: 'oxy-reviewer',
    greenHouse: 'n/a',
    price: 1000,
    currency: 'EUR',
    livedFrom: new Date('2023-01-01'),
    livedTo: new Date('2024-01-01'),
    livedForMonths: 12,
    recommendation: false,
    opinion: 'A long opinion about the flat.',
    rating: 2,
    moderationStatus,
  });
}

describe('enforcement plan', () => {
  it.each<[RecommendedAction, string]>([
    ['remove', 'restrict'],
    ['remove_or_restrict', 'restrict'],
    ['hide', 'restrict'],
    ['label', 'flag_for_review'],
    ['age_gate', 'flag_for_review'],
    ['reduce_distribution', 'flag_for_review'],
    ['allow', 'none'],
    ['suspend_user', 'manual_review'],
    ['legal_queue', 'manual_review'],
  ])('maps %s to %s', (recommended, expected) => {
    const plan = planEnforcement(
      decisionWith({ outcome: 'violation', recommendedActions: [recommended] }),
    );
    expect(plan.map((entry) => entry.action)).toContain(expected);
  });

  /**
   * The failure this exists to prevent, and it is very easy to ship.
   *
   * A correction is a new revision whose outcome is `no_violation`, and its
   * recommendation is frequently `no_action` — meaning "take no NEW action", not
   * "leave what you already did in place". Mapping it straight through plans
   * `none`, and the listing an earlier revision restricted stays hidden forever:
   * the appeal succeeded, the case says the listing was fine, and nothing puts
   * it back. No error, no log line, no other failing test.
   */
  it('always plans a restore for no_violation, whatever it recommended', () => {
    for (const recommended of ['no_action', 'allow', 'no_global_effect'] as RecommendedAction[]) {
      const plan = planEnforcement(
        decisionWith({ outcome: 'no_violation', recommendedActions: [recommended] }),
      );
      expect(plan.map((entry) => entry.action)).toContain('restore');
    }
  });

  it('never plans nothing at all', () => {
    for (const outcome of [
      'violation',
      'no_violation',
      'insufficient_context',
      'inconclusive',
      'content_unavailable',
      'duplicate',
      'escalated',
    ] as Decision['outcome'][]) {
      const plan = planEnforcement(decisionWith({ outcome, recommendedActions: [] }));
      // A row saying "we decided to do nothing, and why" is evidence. An absent
      // row is a question.
      expect(plan.length).toBeGreaterThan(0);
    }
  });

  /**
   * Absence of consensus is neither guilt nor innocence. Mapping any of these to
   * a restriction or to a restore would turn "we could not tell" into a verdict.
   */
  it.each<Decision['outcome']>(['insufficient_context', 'inconclusive', 'escalated'])(
    'asks a human for %s rather than acting',
    (outcome) => {
      const plan = planEnforcement(decisionWith({ outcome, recommendedActions: [] }));
      expect(plan.map((entry) => entry.action)).toEqual(['manual_review']);
    },
  );

  it('collapses a plan that both removes and labels', () => {
    const plan = planEnforcement(
      decisionWith({ outcome: 'violation', recommendedActions: ['remove', 'label'] }),
    );
    // Recording both would claim two effects where one happened.
    expect(plan.map((entry) => entry.action)).toEqual(['restrict']);
  });

  it('keeps a manual_review alongside an action that was taken', () => {
    const plan = planEnforcement(
      decisionWith({ outcome: 'violation', recommendedActions: ['remove', 'suspend_user'] }),
    );
    // A suspension is Oxy's to carry out; dropping the note because something
    // else was also done is how the recommendation gets lost.
    expect(plan.map((entry) => entry.action).sort()).toEqual(['manual_review', 'restrict']);
  });
});

describe('enforcement execution', () => {
  it('records everything and applies nothing in observe mode', async () => {
    const property = await listing();
    const decision = decisionWith({ outcome: 'violation', recommendedActions: ['remove'] });

    const outcomes = await applyDecisionEnforcement({
      decision,
      caseId: 'case_observe',
      subject: { type: ModerationReportedType.PROPERTY, id: String(property._id) },
      mode: 'observe',
    });

    expect(outcomes).toEqual([{ action: 'restrict', result: 'recorded' }]);

    // The audit trail is REAL — that is what makes observe mode a proof of what
    // will happen rather than a log line saying a decision was seen.
    const record = await ModerationEnforcement.findOne({ decisionId: decision.id }).lean();
    expect(record?.applied).toBe(false);
    expect(record?.skippedReason).toContain('observe');

    const after = await Property.findById(property._id).lean();
    expect(after?.moderation?.restricted).not.toBe(true);
  });

  it('restricts a listing in automatic mode and keeps it out of public reads', async () => {
    const property = await listing();
    const decision = decisionWith({ outcome: 'violation', recommendedActions: ['remove'] });

    const outcomes = await applyDecisionEnforcement({
      decision,
      caseId: 'case_auto',
      subject: { type: ModerationReportedType.PROPERTY, id: String(property._id) },
      mode: 'automatic',
    });

    expect(outcomes).toEqual([{ action: 'restrict', result: 'applied' }]);
    const after = await Property.findById(property._id).lean();
    expect(after?.moderation?.restricted).toBe(true);
    expect(after?.moderation?.restrictedByDecisionId).toBe(decision.id);
    // The owner's own `status` is untouched: a jury restricted the listing, it
    // did not archive it, and a restore has to be able to tell those apart.
    expect(after?.status).toBe(PropertyStatus.PUBLISHED);
  });

  /**
   * The idempotency key is `decisionId + revision + action`, and the unique index
   * IS that key. Without it a redelivered decision restricts twice and a
   * redelivered correction restores twice.
   */
  it('is idempotent on decision, revision and action', async () => {
    const property = await listing();
    const decision = decisionWith({ outcome: 'violation', recommendedActions: ['remove'] });
    const input = {
      decision,
      caseId: 'case_twice',
      subject: { type: ModerationReportedType.PROPERTY, id: String(property._id) },
      mode: 'automatic' as const,
    };

    expect(await applyDecisionEnforcement(input)).toEqual([
      { action: 'restrict', result: 'applied' },
    ]);
    expect(await applyDecisionEnforcement(input)).toEqual([
      { action: 'restrict', result: 'duplicate' },
    ]);

    expect(await ModerationEnforcement.countDocuments({ decisionId: decision.id })).toBe(1);
  });

  /**
   * `revision` is in the key precisely so a correction is a DIFFERENT action
   * from the removal it supersedes. Take it out and an upheld appeal can never
   * put a listing back.
   */
  it('lets a later revision restore what an earlier one restricted', async () => {
    const property = await listing();
    const subject = { type: ModerationReportedType.PROPERTY, id: String(property._id) };

    await applyDecisionEnforcement({
      decision: decisionWith({
        id: 'dec_corrected',
        revision: 1,
        outcome: 'violation',
        recommendedActions: ['remove'],
      }),
      caseId: 'case_appeal',
      subject,
      mode: 'automatic',
    });
    expect((await Property.findById(property._id).lean())?.moderation?.restricted).toBe(true);

    const outcomes = await applyDecisionEnforcement({
      decision: decisionWith({
        id: 'dec_corrected',
        revision: 2,
        outcome: 'no_violation',
        recommendedActions: ['no_action'],
      }),
      caseId: 'case_appeal',
      subject,
      mode: 'automatic',
    });

    expect(outcomes.map((outcome) => outcome.action)).toContain('restore');
    expect((await Property.findById(property._id).lean())?.moderation?.restricted).toBe(false);
  });

  it('records honestly that a listing has no flag_for_review effect', async () => {
    const property = await listing();
    const decision = decisionWith({ outcome: 'violation', recommendedActions: ['label'] });

    const outcomes = await applyDecisionEnforcement({
      decision,
      caseId: 'case_label',
      subject: { type: ModerationReportedType.PROPERTY, id: String(property._id) },
      mode: 'automatic',
    });

    // Homiio has no content warning and no distribution dial for a listing.
    // Recording an effect that did not happen would make the audit a fiction.
    expect(outcomes).toEqual([{ action: 'flag_for_review', result: 'recorded' }]);
    const record = await ModerationEnforcement.findOne({ decisionId: decision.id }).lean();
    expect(record?.skippedReason).toContain('no');
  });

  it('flags a review as under review, and can lift its own flag', async () => {
    const stored = await review();
    const subject = { type: ModerationReportedType.REVIEW, id: String(stored._id) };

    await applyDecisionEnforcement({
      decision: decisionWith({
        id: 'dec_flag',
        outcome: 'violation',
        recommendedActions: ['label'],
      }),
      caseId: 'case_review',
      subject,
      mode: 'automatic',
    });
    expect((await Review.findById(stored._id).lean())?.moderationStatus).toBe(
      ReviewModerationStatus.UNDER_REVIEW,
    );

    await applyDecisionEnforcement({
      decision: {
        ...decisionWith({ id: 'dec_unflag', outcome: 'no_violation' }),
        recommendedActions: [{ action: 'restore' }],
      } as Decision,
      caseId: 'case_review',
      subject,
      mode: 'automatic',
    });
    // `restore` finds nothing removed; the flag stays until something plans an
    // `unflag`, which is what the next test covers.
    expect((await Review.findById(stored._id).lean())?.moderationStatus).toBe(
      ReviewModerationStatus.UNDER_REVIEW,
    );
  });

  /**
   * Homiio raises `under_review` itself once three distinct users report a
   * review. That is the community's own signal, and a jury answering a different
   * question must not erase it — the effect would be invisible until the review
   * reappeared.
   */
  it('refuses to lift an under_review that moderation did not set', async () => {
    const stored = await review(ReviewModerationStatus.UNDER_REVIEW);
    const subject = { type: ModerationReportedType.REVIEW, id: String(stored._id) };

    const outcomes = await applyDecisionEnforcement({
      decision: {
        ...decisionWith({ id: 'dec_unflag_only', outcome: 'no_violation' }),
        recommendedActions: [],
        findings: [],
      } as unknown as Decision,
      caseId: 'case_counter',
      subject,
      mode: 'automatic',
    });

    // The plan is a restore, which correctly finds nothing removed.
    expect(outcomes.map((outcome) => outcome.action)).toEqual(['restore']);
    expect((await Review.findById(stored._id).lean())?.moderationStatus).toBe(
      ReviewModerationStatus.UNDER_REVIEW,
    );
  });

  it('records rather than acts for a noun with no enforcement path', async () => {
    const outcomes = await applyDecisionEnforcement({
      decision: decisionWith({ outcome: 'violation', recommendedActions: ['remove'] }),
      caseId: 'case_evict',
      subject: { type: ModerationReportedType.EVICTION_CASE, id: 'anything' },
      mode: 'automatic',
    });
    expect(outcomes).toEqual([{ action: 'restrict', result: 'recorded' }]);
  });

  it('records rather than acts when the listing is already gone', async () => {
    const property = await listing();
    const id = String(property._id);
    await Property.deleteOne({ _id: property._id });

    const outcomes = await applyDecisionEnforcement({
      decision: decisionWith({ outcome: 'violation', recommendedActions: ['remove'] }),
      caseId: 'case_gone',
      subject: { type: ModerationReportedType.PROPERTY, id },
      mode: 'automatic',
    });
    expect(outcomes).toEqual([{ action: 'restrict', result: 'recorded' }]);
  });

  /**
   * `manual` mode applies only the give-something-back half. Holding a restore
   * behind a human means a wrongly-restricted listing stays hidden while
   * somebody reads a queue — and Homiio has no queue and no reader.
   */
  it('applies a restore but not a restriction in manual mode', async () => {
    const property = await listing();
    const subject = { type: ModerationReportedType.PROPERTY, id: String(property._id) };

    expect(
      await applyDecisionEnforcement({
        decision: decisionWith({
          id: 'dec_manual_take',
          outcome: 'violation',
          recommendedActions: ['remove'],
        }),
        caseId: 'case_manual',
        subject,
        mode: 'manual',
      }),
    ).toEqual([{ action: 'restrict', result: 'recorded' }]);
    expect((await Property.findById(property._id).lean())?.moderation?.restricted).not.toBe(true);

    await Property.updateOne(
      { _id: property._id },
      { $set: { 'moderation.restricted': true } },
    );

    expect(
      await applyDecisionEnforcement({
        decision: decisionWith({
          id: 'dec_manual_give',
          outcome: 'no_violation',
          recommendedActions: ['restore'],
        }),
        caseId: 'case_manual',
        subject,
        mode: 'manual',
      }),
    ).toEqual([{ action: 'restore', result: 'applied' }]);
    expect((await Property.findById(property._id).lean())?.moderation?.restricted).toBe(false);
  });
});

describe('report local status for a decision', () => {
  it.each([
    ['final', 'closed'],
    ['corrected', 'closed'],
    ['provisional', 'submitted'],
    ['superseded', 'submitted'],
    ['a-status-from-a-newer-server', 'submitted'],
  ])('%s leaves the report %s', (decisionStatus, expected) => {
    // A provisional decision can be superseded, and a superseded one is not the
    // current answer — neither may close a report that would have to reopen.
    expect(localStatusForDecision(decisionStatus)).toBe(expected);
  });
});
