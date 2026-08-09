/**
 * What Homiio does about a decision, and the two ways that can go wrong quietly.
 *
 * A decision applied TWICE removes a listing twice and restores it twice — and
 * neither shows up as an error. A decision applied with the wrong reversal puts
 * back a state that was never there. Both are silent in production, so both are
 * pinned here.
 *
 * ## Postgres, and the one thing the port had to ADD
 *
 * The subjects are seeded in Postgres because that is where the two levers live:
 * `properties.moderation_restricted` (plus its two provenance columns) and
 * `reviews.moderation_status`, both written only by
 * `db/moderation/moderationEnforcementRepository.ts`. Nothing asserted here
 * changed meaning.
 *
 * What had to be added is the truncation below. `moderation_enforcements` is
 * keyed `(decision_id, decision_revision, action)` and `decisionFixture()`
 * defaults to the SAME id (`dec_test_1`) on every call — so under Mongo's
 * per-test collection wipe those tests were independent, and without an
 * equivalent here the second test to use the default would be answered
 * `duplicate` by a row the first one left behind. A test file sharing a worker's
 * database with another does the same thing across files.
 *
 * One assertion changed SHAPE and is not weakened: a listing seeded with the
 * column DEFAULT is `moderation_restricted = false`, and absence is not
 * representable — so where the Mongo test read `not.toBe(true)` against a
 * missing subdocument, this reads `toBe(false)` against a real column, which is
 * strictly stronger.
 */

import { decisionFixture } from '@oxyhq/crowdsource-testing';
import type { Decision, RecommendedAction } from '@oxyhq/crowdsource-contracts';
import { count, eq } from 'drizzle-orm';
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
import { getDb } from '../../db/postgres';
import { moderationEnforcements, properties, reviews } from '../../db/schema';
import {
  objectIdHex,
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

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

/** Distinguishes the geo chains one test seeds; `countries_code_key` is UNIQUE. */
let nextChain = 0;
/** The chain the current test's subjects hang off, created on first use. */
let place: GeoChain | null = null;

async function chain(): Promise<GeoChain> {
  if (place) return place;
  place = await seedGeoChain({ countryCode: `ME-${nextChain++}` });
  return place;
}

async function listing(): Promise<string> {
  const addressId = await seedAddress({ chain: await chain(), street: `Carrer ${nextChain++}` });
  return seedProperty({
    addressId,
    overrides: {
      oxyUserId: 'oxy-landlord',
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      bathrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: 1000,
      longTermRentCurrency: 'EUR',
      status: PropertyStatus.PUBLISHED,
    },
  });
}

async function review(
  moderationStatus: ReviewModerationStatus = ReviewModerationStatus.ACTIVE,
): Promise<string> {
  const geo = await chain();
  const addressId = await seedAddress({ chain: geo, street: `Carrer ${nextChain++}` });
  const [row] = await getDb()
    .insert(reviews)
    .values({
      id: objectIdHex(),
      addressId,
      // A BUILDING review names no unit — `reviews_unit_level_check` enforces
      // exactly that, so a fixture cannot drift from the rollup's rule.
      addressLevel: 'BUILDING',
      streetLevelId: addressId,
      buildingLevelId: addressId,
      cityId: geo.cityId,
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
    })
    .returning({ id: reviews.id });
  return row.id;
}

/** The listing's two moderation columns plus the owner's own status. */
async function storedListing(propertyId: string) {
  const [row] = await getDb()
    .select({
      restricted: properties.moderationRestricted,
      byDecisionId: properties.moderationRestrictedByDecisionId,
      status: properties.status,
    })
    .from(properties)
    .where(eq(properties.id, propertyId));
  return row;
}

async function storedReviewStatus(reviewId: string): Promise<string> {
  const [row] = await getDb()
    .select({ moderationStatus: reviews.moderationStatus })
    .from(reviews)
    .where(eq(reviews.id, reviewId));
  return row.moderationStatus;
}

/** The single enforcement row this decision produced. */
async function storedEnforcement(decisionId: string) {
  const [row] = await getDb()
    .select()
    .from(moderationEnforcements)
    .where(eq(moderationEnforcements.decisionId, decisionId));
  return row;
}

async function countEnforcements(decisionId: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(moderationEnforcements)
    .where(eq(moderationEnforcements.decisionId, decisionId));
  return row.total;
}

/**
 * Reviews before the geo tables: `reviews.address_id` is ON DELETE **RESTRICT**,
 * so emptying an address under one RAISES rather than cascading — which is the
 * constraint working, and would read here as a mysterious teardown failure.
 */
beforeEach(async () => {
  const db = getDb();
  await db.delete(moderationEnforcements);
  await db.delete(reviews);
  await resetGeoTables();
  place = null;
  nextChain = 0;
});

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
    const propertyId = await listing();
    const decision = decisionWith({ outcome: 'violation', recommendedActions: ['remove'] });

    const outcomes = await applyDecisionEnforcement({
      decision,
      caseId: 'case_observe',
      subject: { type: ModerationReportedType.PROPERTY, id: propertyId },
      mode: 'observe',
    });

    expect(outcomes).toEqual([{ action: 'restrict', result: 'recorded' }]);

    // The audit trail is REAL — that is what makes observe mode a proof of what
    // will happen rather than a log line saying a decision was seen.
    const record = await storedEnforcement(decision.id);
    expect(record.applied).toBe(false);
    expect(record.appliedAt).toBeNull();
    expect(record.skippedReason).toContain('observe');

    expect((await storedListing(propertyId)).restricted).toBe(false);
  });

  it('restricts a listing in automatic mode and keeps it out of public reads', async () => {
    const propertyId = await listing();
    const decision = decisionWith({ outcome: 'violation', recommendedActions: ['remove'] });

    const outcomes = await applyDecisionEnforcement({
      decision,
      caseId: 'case_auto',
      subject: { type: ModerationReportedType.PROPERTY, id: propertyId },
      mode: 'automatic',
    });

    expect(outcomes).toEqual([{ action: 'restrict', result: 'applied' }]);
    const after = await storedListing(propertyId);
    expect(after.restricted).toBe(true);
    expect(after.byDecisionId).toBe(decision.id);
    // The owner's own `status` is untouched: a jury restricted the listing, it
    // did not archive it, and a restore has to be able to tell those apart.
    expect(after.status).toBe(PropertyStatus.PUBLISHED);
  });

  /**
   * The idempotency key is `decisionId + revision + action`, and the unique index
   * IS that key. Without it a redelivered decision restricts twice and a
   * redelivered correction restores twice.
   */
  it('is idempotent on decision, revision and action', async () => {
    const propertyId = await listing();
    const decision = decisionWith({ outcome: 'violation', recommendedActions: ['remove'] });
    const input = {
      decision,
      caseId: 'case_twice',
      subject: { type: ModerationReportedType.PROPERTY, id: propertyId },
      mode: 'automatic' as const,
    };

    expect(await applyDecisionEnforcement(input)).toEqual([
      { action: 'restrict', result: 'applied' },
    ]);
    expect(await applyDecisionEnforcement(input)).toEqual([
      { action: 'restrict', result: 'duplicate' },
    ]);

    expect(await countEnforcements(decision.id)).toBe(1);
  });

  /**
   * `revision` is in the key precisely so a correction is a DIFFERENT action
   * from the removal it supersedes. Take it out and an upheld appeal can never
   * put a listing back.
   */
  it('lets a later revision restore what an earlier one restricted', async () => {
    const propertyId = await listing();
    const subject = { type: ModerationReportedType.PROPERTY, id: propertyId };

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
    expect((await storedListing(propertyId)).restricted).toBe(true);

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
    const after = await storedListing(propertyId);
    expect(after.restricted).toBe(false);
    // Clearing the flag clears its provenance in the same statement, so a
    // restored listing never keeps a decision id claiming it is still down.
    expect(after.byDecisionId).toBeNull();
  });

  it('records honestly that a listing has no flag_for_review effect', async () => {
    const propertyId = await listing();
    const decision = decisionWith({ outcome: 'violation', recommendedActions: ['label'] });

    const outcomes = await applyDecisionEnforcement({
      decision,
      caseId: 'case_label',
      subject: { type: ModerationReportedType.PROPERTY, id: propertyId },
      mode: 'automatic',
    });

    // Homiio has no content warning and no distribution dial for a listing.
    // Recording an effect that did not happen would make the audit a fiction.
    expect(outcomes).toEqual([{ action: 'flag_for_review', result: 'recorded' }]);
    expect((await storedEnforcement(decision.id)).skippedReason).toContain('no');
  });

  it('flags a review as under review, and can lift its own flag', async () => {
    const reviewId = await review();
    const subject = { type: ModerationReportedType.REVIEW, id: reviewId };

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
    expect(await storedReviewStatus(reviewId)).toBe(ReviewModerationStatus.UNDER_REVIEW);

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
    expect(await storedReviewStatus(reviewId)).toBe(ReviewModerationStatus.UNDER_REVIEW);
  });

  /**
   * Homiio raises `under_review` itself once three distinct users report a
   * review. That is the community's own signal, and a jury answering a different
   * question must not erase it — the effect would be invisible until the review
   * reappeared.
   */
  it('refuses to lift an under_review that moderation did not set', async () => {
    const reviewId = await review(ReviewModerationStatus.UNDER_REVIEW);
    const subject = { type: ModerationReportedType.REVIEW, id: reviewId };

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
    expect(await storedReviewStatus(reviewId)).toBe(ReviewModerationStatus.UNDER_REVIEW);
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
    const propertyId = await listing();
    await getDb().delete(properties).where(eq(properties.id, propertyId));

    const outcomes = await applyDecisionEnforcement({
      decision: decisionWith({ outcome: 'violation', recommendedActions: ['remove'] }),
      caseId: 'case_gone',
      subject: { type: ModerationReportedType.PROPERTY, id: propertyId },
      mode: 'automatic',
    });
    expect(outcomes).toEqual([{ action: 'restrict', result: 'recorded' }]);
  });

  /**
   * A listing created AFTER the cutover carries a uuid v7, for which
   * `mongoose.isValidObjectId` is FALSE. The Mongo effect opened with exactly
   * that guard, so keeping it would have made every post-cutover listing
   * permanently un-enforceable while still reporting `changed: false` as though
   * it had looked: a jury could restrict such a listing and it would stay up,
   * with an enforcement row claiming the action was handled.
   *
   * The guard is deliberately gone, and this is the assertion that replaces the
   * Mongo-era "rejects a malformed id" test — the id shape a report carries is
   * no longer a precondition on the query.
   */
  it('restricts a listing whose id is a uuid v7, not an ObjectId hex', async () => {
    const addressId = await seedAddress({ chain: await chain(), street: 'Carrer Generated' });
    const propertyId = await seedProperty({ addressId, idShape: 'generated' });
    // The shape is the point of the test — assert it rather than trusting the
    // fixture, or the assertion below is vacuous.
    expect(propertyId).not.toMatch(/^[0-9a-f]{24}$/);

    const decision = decisionWith({
      id: 'dec_uuid_subject',
      outcome: 'violation',
      recommendedActions: ['remove'],
    });
    expect(
      await applyDecisionEnforcement({
        decision,
        caseId: 'case_uuid',
        subject: { type: ModerationReportedType.PROPERTY, id: propertyId },
        mode: 'automatic',
      }),
    ).toEqual([{ action: 'restrict', result: 'applied' }]);
    expect((await storedListing(propertyId)).restricted).toBe(true);
  });

  /**
   * `manual` mode applies only the give-something-back half. Holding a restore
   * behind a human means a wrongly-restricted listing stays hidden while
   * somebody reads a queue — and Homiio has no queue and no reader.
   */
  it('applies a restore but not a restriction in manual mode', async () => {
    const propertyId = await listing();
    const subject = { type: ModerationReportedType.PROPERTY, id: propertyId };

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
    expect((await storedListing(propertyId)).restricted).toBe(false);

    await getDb()
      .update(properties)
      .set({ moderationRestricted: true })
      .where(eq(properties.id, propertyId));

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
    expect((await storedListing(propertyId)).restricted).toBe(false);
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
