/**
 * The rest of the loop: delivery, decisions coming back, and the sweep that
 * notices when the two have drifted apart.
 */

import mongoose from 'mongoose';
import { decisionFixture } from '@oxyhq/crowdsource-testing';
import type { Decision } from '@oxyhq/crowdsource-contracts';
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
  claimModerationOutboxEvent,
  dispatchModerationOutbox,
  failModerationOutboxEvent,
  isRetryableDeliveryError,
  reportSubmitEventId,
  type ModerationOutboxEvent,
} from '../../services/moderation/ModerationOutboxService';
import {
  createModerationReport,
  withReportIntakeSession,
} from '../../services/moderation/ReportIntakeService';
import { reconcileModerationReports } from '../../services/moderation/ModerationReconciliation';
import ModerationOutbox from '../../models/ModerationOutbox';
import ModerationReport from '../../models/ModerationReport';
import { createAddress, models } from '../helpers/factories';

const { Property } = models;

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

async function storedReport(reportedId: string): Promise<string> {
  const result = await withReportIntakeSession((session) =>
    createModerationReport(
      {
        reportedType: ModerationReportedType.PROPERTY,
        reportedId,
        reporter: `oxy-${Math.random().toString(36).slice(2)}`,
        reason: ListingReportReason.SCAM,
      },
      session,
    ),
  );
  return result.report.id;
}

function outboxEvent(overrides: Partial<ModerationOutboxEvent>): ModerationOutboxEvent {
  return {
    _id: 'evt',
    kind: 'report.submit',
    payload: {},
    attempts: 1,
    availableAt: new Date(),
    expiresAt: new Date(Date.now() + 1_000),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('delivery worker', () => {
  /**
   * The integration is off in tests, so there is nowhere to deliver. That is a
   * DELAY, not a loss: the error is retryable, the event stays pending, and the
   * backlog delivers when the flag is switched on.
   */
  it('treats an unconfigured integration as retryable', async () => {
    const property = await listing();
    const reportId = await storedReport(String(property._id));

    await expect(
      deliverReportOutboxEvent(outboxEvent({ payload: { reportId } })),
    ).rejects.toBeInstanceOf(CrowdSourceUnavailableError);

    expect(isRetryableDeliveryError(new CrowdSourceUnavailableError())).toBe(true);
    // Untouched: nothing failed, so nothing is marked failed.
    expect((await ModerationReport.findById(reportId).lean())?.localStatus).toBe('queued');
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
      deliverReportOutboxEvent(
        outboxEvent({ payload: { reportId: String(new mongoose.Types.ObjectId()) } }),
      ),
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
    const property = await listing();
    const reportId = await storedReport(String(property._id));
    const eventId = reportSubmitEventId(reportId);

    const claimed = await claimModerationOutboxEvent({ leaseOwner: 'owner-1' });
    expect(claimed?._id).toBe(eventId);

    const outcome = await failModerationOutboxEvent(
      { _id: eventId, attempts: 1 },
      'owner-1',
      new ModerationDeliveryRejectedError('the envelope is not processable'),
    );

    expect(outcome).toEqual({ released: true, deadLettered: true });
    const stored = await ModerationOutbox.findById(eventId).lean();
    expect(stored?.status).toBe('dead_letter');
    expect(stored?.lastError).toContain('not processable');
  });

  it('backs off a retryable failure and keeps the event', async () => {
    const property = await listing();
    const reportId = await storedReport(String(property._id));
    const eventId = reportSubmitEventId(reportId);

    await claimModerationOutboxEvent({ leaseOwner: 'owner-1' });
    const outcome = await failModerationOutboxEvent(
      { _id: eventId, attempts: 1 },
      'owner-1',
      new CrowdSourceUnavailableError(),
    );

    expect(outcome).toEqual({ released: true, deadLettered: false });
    const stored = await ModerationOutbox.findById(eventId).lean();
    expect(stored?.status).toBe('pending');
    expect(stored?.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  /**
   * A completion must not be able to land on a lease this worker no longer
   * owns — that is what lets two tasks drain one queue safely.
   */
  it('refuses to release a lease another owner holds', async () => {
    const property = await listing();
    const reportId = await storedReport(String(property._id));
    const eventId = reportSubmitEventId(reportId);

    await claimModerationOutboxEvent({ leaseOwner: 'owner-1' });
    const outcome = await failModerationOutboxEvent(
      { _id: eventId, attempts: 1 },
      'owner-2',
      new Error('not mine'),
    );
    expect(outcome.released).toBe(false);
  });

  it('drains a batch and reports what happened', async () => {
    const property = await listing();
    await storedReport(String(property._id));
    await storedReport(String(property._id));

    const handled: string[] = [];
    const result = await dispatchModerationOutbox({
      handler: async (event) => {
        handled.push(event._id);
      },
    });

    expect(result).toEqual({ processed: 2, failed: 0, deadLettered: 0 });
    expect(handled).toHaveLength(2);
    expect(await ModerationOutbox.countDocuments({ status: 'processed' })).toBe(2);
  });

  it('stops claiming new work once aborted', async () => {
    const property = await listing();
    await storedReport(String(property._id));
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
    const property = await listing();
    const first = await storedReport(String(property._id));
    const second = await storedReport(String(property._id));
    await ModerationReport.updateMany(
      { _id: { $in: [first, second] } },
      { $set: { crowdSourceCaseId: 'case_shared', localStatus: 'submitted' } },
    );

    const decision = decisionFor('case_shared', { status: 'final' });
    await applyDecisionOutboxEvent(
      outboxEvent({
        kind: 'decision.apply',
        payload: { caseId: 'case_shared', decision },
      }),
    );

    for (const id of [first, second]) {
      const stored = await ModerationReport.findById(id).lean();
      expect(stored?.decisionId).toBe(decision.id);
      expect(stored?.decisionRevision).toBe(decision.revision);
      expect(stored?.localStatus).toBe('closed');
      expect(stored?.enforcedAction).toBeDefined();
    }
  });

  /**
   * The revision guard is in the FILTER, so it is the database that refuses a
   * stale write. Deliveries overlap, and an older revision landing last would
   * otherwise overwrite the current answer.
   */
  it('refuses to overwrite a newer revision with an older one', async () => {
    const property = await listing();
    const reportId = await storedReport(String(property._id));
    await ModerationReport.updateOne(
      { _id: reportId },
      { $set: { crowdSourceCaseId: 'case_rev', localStatus: 'submitted' } },
    );

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
    expect((await ModerationReport.findById(reportId).lean())?.decisionRevision).toBe(3);

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

    const stored = await ModerationReport.findById(reportId).lean();
    expect(stored?.decisionRevision).toBe(3);
    expect(stored?.decisionOutcome).toBe('no_violation');
  });
});

describe('reconciliation', () => {
  it('re-derives a delivery event a report lost', async () => {
    const property = await listing();
    const reportId = await storedReport(String(property._id));
    await ModerationOutbox.deleteMany({});

    const result = await reconcileModerationReports();

    expect(result.requeued).toBe(1);
    // The SAME deterministic id, so a report that did have an event is never
    // delivered twice.
    expect(await ModerationOutbox.findById(reportSubmitEventId(reportId)).lean()).not.toBeNull();
  });

  it('leaves an existing delivery event alone', async () => {
    const property = await listing();
    await storedReport(String(property._id));
    const result = await reconcileModerationReports();
    expect(result.requeued).toBe(0);
  });

  /**
   * Counted, never re-queued. Something about the payload has to change first,
   * and re-queueing it would spin — so the count is the alert.
   */
  it('counts a dead-lettered delivery instead of retrying it', async () => {
    const property = await listing();
    const reportId = await storedReport(String(property._id));
    await ModerationOutbox.updateOne(
      { _id: reportSubmitEventId(reportId) },
      { $set: { status: 'dead_letter' } },
    );

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
   * the sweep's `$in` is the mutation this test exists to catch.
   */
  it('never re-queues a report that was never going anywhere', async () => {
    await withReportIntakeSession((session) =>
      createModerationReport(
        {
          reportedType: ModerationReportedType.EVICTION_CASE,
          reportedId: String(new mongoose.Types.ObjectId()),
          reporter: 'oxy-reporter',
          reason: ListingReportReason.OTHER,
        },
        session,
      ),
    );

    const result = await reconcileModerationReports();

    expect(result.requeued).toBe(0);
    expect(result.localOnly).toBe(1);
    // Counting it is the only thing that makes "reports no jury will ever see" a
    // visible number rather than a quiet one.
    expect(await ModerationOutbox.countDocuments({})).toBe(0);
  });

  it('counts a case that has gone quiet', async () => {
    const property = await listing();
    const reportId = await storedReport(String(property._id));
    await ModerationReport.updateOne(
      { _id: reportId },
      {
        $set: {
          localStatus: 'submitted',
          submittedAt: new Date(Date.now() - 96 * 60 * 60 * 1_000),
        },
      },
    );

    const result = await reconcileModerationReports();
    expect(result.awaitingDecision).toBe(1);
  });
});
