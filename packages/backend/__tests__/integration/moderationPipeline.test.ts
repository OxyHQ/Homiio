/**
 * The rest of the loop: delivery, decisions coming back, and the sweep that
 * notices when the two have drifted apart.
 *
 * ## Postgres, and what moved in the port
 *
 * `claimModerationOutboxEvent` and the `ModerationOutboxEvent` type now come
 * from `db/moderation/moderationOutboxRepository`; what stays in
 * `ModerationOutboxService` is the POLICY half — the backoff curve, the
 * retryability verdict and the bounded drain. The event's identifier is `id`,
 * not `_id`, and the reporter column is `reporter_oxy_user_id`.
 *
 * Nothing asserted here changed meaning. The one thing that had to be ADDED is
 * the truncation below: Mongo's `jest.setup.ts` wiped every collection after
 * each test, and the reconciliation counters (`awaitingDecision`, `localOnly`)
 * are whole-table counts — a row left by an earlier test, or by an earlier FILE
 * sharing this worker's database, would make them measure history instead of
 * the sweep.
 */

import { decisionFixture } from '@oxyhq/crowdsource-testing';
import type { Decision } from '@oxyhq/crowdsource-contracts';
import { count, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';
import {
  ModerationReportedType,
  ListingReportReason,
  PropertyStatus,
  PropertyType,
  OfferingType,
} from '@homiio/shared-types';

import {
  applyDecisionOutboxEvent,
  ModerationDecisionDeferredError,
  ModerationDecisionRejectedError,
} from '../../services/moderation/ModerationDecisionWorker';
import {
  CrowdSourceUnavailableError,
  deliverReportOutboxEvent,
  ModerationDeliveryRejectedError,
} from '../../services/moderation/ModerationDeliveryWorker';
import {
  dispatchModerationOutbox,
  failModerationOutboxEvent,
  isRetryableDeliveryError,
  reportSubmitEventId,
} from '../../services/moderation/ModerationOutboxService';
import {
  claimModerationOutboxEvent,
  type ModerationOutboxEvent,
} from '../../db/moderation/moderationOutboxRepository';
import {
  createModerationReport,
  withReportIntakeTransaction,
} from '../../services/moderation/ReportIntakeService';
import { reconcileModerationReports } from '../../services/moderation/ModerationReconciliation';
import { getDb } from '../../db/postgres';
import {
  listingReports,
  moderationEnforcements,
  moderationOutbox,
  moderationReports,
} from '../../db/schema';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
} from '../helpers/postgresGeoFixtures';

/** Distinguishes the geo chains one test seeds; `countries_code_key` is UNIQUE. */
let nextChain = 0;

async function listing(): Promise<string> {
  const chain = await seedGeoChain({ countryCode: `MP-${nextChain++}` });
  const addressId = await seedAddress({ chain });
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

async function storedReport(reportedId: string): Promise<string> {
  const result = await withReportIntakeTransaction((tx) =>
    createModerationReport(
      {
        reportedType: ModerationReportedType.PROPERTY,
        reportedId,
        reporter: `oxy-${uuidv7()}`,
        reason: ListingReportReason.SCAM,
      },
      tx,
    ),
  );
  return result.report.id;
}

function outboxEvent(overrides: Partial<ModerationOutboxEvent>): ModerationOutboxEvent {
  return {
    id: 'evt',
    kind: 'report.submit',
    payload: {},
    attempts: 1,
    availableAt: new Date(),
    expiresAt: new Date(Date.now() + 1_000),
    createdAt: new Date(),
    ...overrides,
  };
}

/** The stored outbox row, including the columns the reassembled payload drops. */
async function storedOutbox(eventId: string) {
  const [row] = await getDb()
    .select()
    .from(moderationOutbox)
    .where(eq(moderationOutbox.id, eventId));
  return row;
}

async function storedReportRow(reportId: string) {
  const [row] = await getDb()
    .select()
    .from(moderationReports)
    .where(eq(moderationReports.id, reportId));
  return row;
}

async function countOutbox(): Promise<number> {
  const [row] = await getDb().select({ total: count() }).from(moderationOutbox);
  return row.total;
}

/**
 * Empty everything this file counts, before each test.
 *
 * The reconciliation counters are whole-table counts and the enforcement claim
 * is unique on `(decision_id, revision, action)` — both of which read a row left
 * by an earlier test, or by an earlier FILE that shared this worker's database,
 * as part of the result. Order: the outbox CASCADEs from `moderation_reports`,
 * `listing_reports` from `properties`.
 */
beforeEach(async () => {
  const db = getDb();
  await db.delete(moderationOutbox);
  await db.delete(moderationReports);
  await db.delete(moderationEnforcements);
  await db.delete(listingReports);
  await resetGeoTables();
  nextChain = 0;
});

describe('delivery worker', () => {
  /**
   * The integration is off in tests, so there is nowhere to deliver. That is a
   * DELAY, not a loss: the error is retryable, the event stays pending, and the
   * backlog delivers when the flag is switched on.
   */
  it('treats an unconfigured integration as retryable', async () => {
    const reportId = await storedReport(await listing());

    await expect(
      deliverReportOutboxEvent(outboxEvent({ payload: { reportId } })),
    ).rejects.toBeInstanceOf(CrowdSourceUnavailableError);

    expect(isRetryableDeliveryError(new CrowdSourceUnavailableError())).toBe(true);
    // Untouched: nothing failed, so nothing is marked failed.
    expect((await storedReportRow(reportId)).localStatus).toBe('queued');
  });

  it('refuses an event with no report id, permanently', async () => {
    const error = await deliverReportOutboxEvent(outboxEvent({ payload: {} })).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ModerationDeliveryRejectedError);
    expect(isRetryableDeliveryError(error)).toBe(false);
  });

  it('completes an event whose report has been deleted', async () => {
    // Nothing to deliver and nothing to fix: retrying would keep looking for a
    // row that no longer exists.
    await expect(
      deliverReportOutboxEvent(outboxEvent({ payload: { reportId: uuidv7() } })),
    ).resolves.toBeUndefined();
  });

  /**
   * An unknown failure is retryable. Assuming a defect is permanent is how a
   * recoverable outage becomes lost moderation work.
   */
  it('defaults an unclassified error to retryable', () => {
    expect(isRetryableDeliveryError(new Error('connection reset'))).toBe(true);
    expect(isRetryableDeliveryError({ retryable: false })).toBe(false);
    expect(isRetryableDeliveryError({ retryable: 'no' })).toBe(true);
  });
});

describe('outbox dispatch', () => {
  it('dead-letters a non-retryable failure instead of backing off', async () => {
    const reportId = await storedReport(await listing());
    const eventId = reportSubmitEventId(reportId);

    const claimed = await claimModerationOutboxEvent({ leaseOwner: 'owner-1' });
    expect(claimed?.id).toBe(eventId);

    const outcome = await failModerationOutboxEvent(
      { id: eventId, attempts: 1 },
      'owner-1',
      new ModerationDeliveryRejectedError('the envelope is not processable'),
    );

    expect(outcome).toEqual({ released: true, deadLettered: true });
    const stored = await storedOutbox(eventId);
    expect(stored.status).toBe('dead_letter');
    expect(stored.lastError).toContain('not processable');
  });

  it('backs off a retryable failure and keeps the event', async () => {
    const reportId = await storedReport(await listing());
    const eventId = reportSubmitEventId(reportId);

    await claimModerationOutboxEvent({ leaseOwner: 'owner-1' });
    const outcome = await failModerationOutboxEvent(
      { id: eventId, attempts: 1 },
      'owner-1',
      new CrowdSourceUnavailableError(),
    );

    expect(outcome).toEqual({ released: true, deadLettered: false });
    const stored = await storedOutbox(eventId);
    expect(stored.status).toBe('pending');
    expect(stored.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  /**
   * A completion must not be able to land on a lease this worker no longer
   * owns — that is what lets two tasks drain one queue safely.
   */
  it('refuses to release a lease another owner holds', async () => {
    const reportId = await storedReport(await listing());
    const eventId = reportSubmitEventId(reportId);

    await claimModerationOutboxEvent({ leaseOwner: 'owner-1' });
    const outcome = await failModerationOutboxEvent(
      { id: eventId, attempts: 1 },
      'owner-2',
      new Error('not mine'),
    );
    expect(outcome.released).toBe(false);
  });

  it('drains a batch and reports what happened', async () => {
    const propertyId = await listing();
    await storedReport(propertyId);
    await storedReport(propertyId);

    const handled: string[] = [];
    const result = await dispatchModerationOutbox({
      handler: async (event) => {
        handled.push(event.id);
      },
    });

    expect(result).toEqual({ processed: 2, failed: 0, deadLettered: 0 });
    expect(handled).toHaveLength(2);

    const [processed] = await getDb()
      .select({ total: count() })
      .from(moderationOutbox)
      .where(eq(moderationOutbox.status, 'processed'));
    expect(processed.total).toBe(2);
  });

  it('stops claiming new work once aborted', async () => {
    await storedReport(await listing());
    const controller = new AbortController();
    controller.abort();

    const result = await dispatchModerationOutbox({
      handler: async () => {
        throw new Error('should never run');
      },
      signal: controller.signal,
    });

    expect(result).toEqual({ processed: 0, failed: 0, deadLettered: 0 });
  });
});

describe('decision worker', () => {
  function decisionFor(caseId: string, overrides: Partial<Decision> = {}): Decision {
    return { ...decisionFixture({ caseId }), ...overrides } as Decision;
  }

  it('refuses an event with no case id, permanently', async () => {
    const error = await applyDecisionOutboxEvent(
      outboxEvent({ kind: 'decision.apply', payload: {} }),
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ModerationDecisionRejectedError);
    expect(isRetryableDeliveryError(error)).toBe(false);
  });

  /**
   * Parsed at the point of USE, not at the door. A shape this deployment cannot
   * read waits in the outbox until the code catches up; refusing it at the
   * webhook would put a real decision on a retry schedule until it expired.
   */
  it('dead-letters a decision that does not match the contract', async () => {
    const error = await applyDecisionOutboxEvent(
      outboxEvent({
        kind: 'decision.apply',
        payload: { caseId: 'case_x', decision: { not: 'a decision' } },
      }),
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ModerationDecisionRejectedError);
  });

  /**
   * A real race: CrowdSource can decide a case and deliver the webhook while the
   * response carrying the case id back is still being written. Backing off is
   * correct; dead-lettering would throw the decision away.
   */
  it('defers when no local report is linked to the case yet', async () => {
    const error = await applyDecisionOutboxEvent(
      outboxEvent({
        kind: 'decision.apply',
        payload: { caseId: 'case_unknown', decision: decisionFor('case_unknown') },
      }),
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ModerationDecisionDeferredError);
    expect(isRetryableDeliveryError(error)).toBe(true);
  });

  it('writes the decision onto every report that joined the case', async () => {
    const propertyId = await listing();
    const first = await storedReport(propertyId);
    const second = await storedReport(propertyId);
    await getDb()
      .update(moderationReports)
      .set({ crowdSourceCaseId: 'case_shared', localStatus: 'submitted' })
      .where(inArray(moderationReports.id, [first, second]));

    const decision = decisionFor('case_shared', { status: 'final' });
    await applyDecisionOutboxEvent(
      outboxEvent({
        kind: 'decision.apply',
        payload: { caseId: 'case_shared', decision },
      }),
    );

    for (const id of [first, second]) {
      const stored = await storedReportRow(id);
      expect(stored.decisionId).toBe(decision.id);
      expect(stored.decisionRevision).toBe(decision.revision);
      expect(stored.localStatus).toBe('closed');
      expect(stored.enforcedAction).not.toBeNull();
    }
  });

  /**
   * The revision guard is in the FILTER, so it is the database that refuses a
   * stale write. Deliveries overlap, and an older revision landing last would
   * otherwise overwrite the current answer.
   */
  it('refuses to overwrite a newer revision with an older one', async () => {
    const reportId = await storedReport(await listing());
    await getDb()
      .update(moderationReports)
      .set({ crowdSourceCaseId: 'case_rev', localStatus: 'submitted' })
      .where(eq(moderationReports.id, reportId));

    const newer = decisionFor('case_rev', {
      id: 'dec_rev',
      revision: 3,
      status: 'final',
      supersedesDecisionId: 'dec_old',
      outcome: 'no_violation',
    });
    await applyDecisionOutboxEvent(
      outboxEvent({ kind: 'decision.apply', payload: { caseId: 'case_rev', decision: newer } }),
    );
    expect((await storedReportRow(reportId)).decisionRevision).toBe(3);

    const older = decisionFor('case_rev', {
      id: 'dec_rev',
      revision: 2,
      status: 'final',
      supersedesDecisionId: 'dec_older',
      outcome: 'violation',
    });
    await applyDecisionOutboxEvent(
      outboxEvent({ kind: 'decision.apply', payload: { caseId: 'case_rev', decision: older } }),
    );

    const stored = await storedReportRow(reportId);
    expect(stored.decisionRevision).toBe(3);
    expect(stored.decisionOutcome).toBe('no_violation');
  });
});

describe('reconciliation', () => {
  it('re-derives a delivery event a report lost', async () => {
    const reportId = await storedReport(await listing());
    await getDb().delete(moderationOutbox);

    const result = await reconcileModerationReports();

    expect(result.requeued).toBe(1);
    // The SAME deterministic id, so a report that did have an event is never
    // delivered twice.
    expect(await storedOutbox(reportSubmitEventId(reportId))).toBeDefined();
  });

  it('leaves an existing delivery event alone', async () => {
    await storedReport(await listing());
    const result = await reconcileModerationReports();
    expect(result.requeued).toBe(0);
  });

  /**
   * Counted, never re-queued. Something about the payload has to change first,
   * and re-queueing it would spin — so the count is the alert.
   */
  it('counts a dead-lettered delivery instead of retrying it', async () => {
    const reportId = await storedReport(await listing());
    await getDb()
      .update(moderationOutbox)
      .set({ status: 'dead_letter' })
      .where(eq(moderationOutbox.id, reportSubmitEventId(reportId)));

    const result = await reconcileModerationReports();
    expect(result.deadLettered).toBe(1);
    expect(result.requeued).toBe(0);
  });

  /**
   * THE omission that is the safety property.
   *
   * A `received` report has no subject provider, so an event re-derived for it
   * would fail as unsupported on its first attempt and dead-letter — turning a
   * deliberate local-only report into a recurring alert. Adding 'received' to
   * `RECONCILABLE_LOCAL_STATUSES` is the mutation this test exists to catch.
   */
  it('never re-queues a report that was never going anywhere', async () => {
    await withReportIntakeTransaction((tx) =>
      createModerationReport(
        {
          reportedType: ModerationReportedType.EVICTION_CASE,
          reportedId: uuidv7(),
          reporter: 'oxy-reporter',
          reason: ListingReportReason.OTHER,
        },
        tx,
      ),
    );

    const result = await reconcileModerationReports();

    expect(result.requeued).toBe(0);
    expect(result.localOnly).toBe(1);
    // Counting it is the only thing that makes "reports no jury will ever see" a
    // visible number rather than a quiet one.
    expect(await countOutbox()).toBe(0);
  });

  it('counts a case that has gone quiet', async () => {
    const reportId = await storedReport(await listing());
    await getDb()
      .update(moderationReports)
      .set({
        localStatus: 'submitted',
        submittedAt: new Date(Date.now() - 96 * 60 * 60 * 1_000),
      })
      .where(eq(moderationReports.id, reportId));

    const result = await reconcileModerationReports();
    expect(result.awaitingDecision).toBe(1);
  });
});
