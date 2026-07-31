/**
 * The intake invariant: a report and its delivery event commit together, or
 * neither does.
 *
 * This is the file that has to fail when somebody "simplifies" the transaction
 * away, because nothing else would. A report stored with no outbox row is not an
 * error state — it is a normal-looking row that no worker will ever pick up, and
 * the only symptom is a case that never opens, weeks later, noticed by nobody.
 *
 * The mutation each assertion is guarding against is named in its own test.
 */

import mongoose from 'mongoose';
import express, { type Express } from 'express';
import request from 'supertest';
import { ListingReportReason, ModerationReportedType } from '@homiio/shared-types';

import {
  createModerationReport,
  DuplicateModerationReportError,
  withReportIntakeSession,
} from '../../services/moderation/ReportIntakeService';
import {
  enqueueModerationOutboxEvent,
  ModerationOutboxTransactionError,
  reportSubmitEventId,
} from '../../services/moderation/ModerationOutboxService';
import ModerationOutbox from '../../models/ModerationOutbox';
import ModerationReport from '../../models/ModerationReport';
import { createRentProperty, models } from '../helpers/factories';

import reportController from '../../controllers/reportController';
import { errorHandler } from '../../middlewares/errorHandler';
const { ListingReport } = models;

function buildApp(oxyUserId: string | null): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  });
  app.post('/properties/:propertyId/report', reportController.createListingReport);
  app.use(errorHandler);
  return app;
}

describe('moderation report intake', () => {
  it('commits the report and its delivery event together', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });

    const res = await request(buildApp('oxy-reporter'))
      .post(`/properties/${property._id}/report`)
      .send({ reason: ListingReportReason.SCAM });

    expect(res.status).toBe(201);

    const moderationReport = await ModerationReport.findOne({
      reporter: 'oxy-reporter',
      reportedId: String(property._id),
    }).lean();
    expect(moderationReport).not.toBeNull();
    expect(moderationReport?.localStatus).toBe('queued');

    // The row IS the job. A queued report with no outbox event is moderation
    // work that exists and will never run.
    const event = await ModerationOutbox.findById(
      reportSubmitEventId(String(moderationReport?._id)),
    ).lean();
    expect(event).not.toBeNull();
    expect(event?.kind).toBe('report.submit');
    expect(event?.status).toBe('pending');
    expect(event?.payload?.reportId).toBe(String(moderationReport?._id));

    // The pre-existing local record is untouched by any of this.
    const listingReport = await ListingReport.findOne({
      propertyId: property._id,
      reporterOxyUserId: 'oxy-reporter',
    }).lean();
    expect(listingReport).not.toBeNull();
  });

  /**
   * MUTATION GUARD. Drop the `session` argument from either `create` call in
   * `reportController.createListingReport` — or replace `withReportIntakeSession`
   * with a bare `await` — and this test still needs to fail. It does, because a
   * rolled-back transaction leaves NEITHER row, and a non-transactional version
   * leaves the ListingReport behind.
   */
  it('leaves nothing behind when the transaction aborts', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });

    await expect(
      withReportIntakeSession(async (session) => {
        await ListingReport.create(
          [
            {
              propertyId: property._id,
              reporterOxyUserId: 'oxy-reporter',
              reason: ListingReportReason.SCAM,
              status: 'open',
            },
          ],
          { session },
        );
        await createModerationReport(
          {
            reportedType: ModerationReportedType.PROPERTY,
            reportedId: String(property._id),
            reporter: 'oxy-reporter',
            reason: ListingReportReason.SCAM,
          },
          session,
        );
        throw new Error('something downstream failed');
      }),
    ).rejects.toThrow('something downstream failed');

    expect(await ListingReport.countDocuments({})).toBe(0);
    expect(await ModerationReport.countDocuments({})).toBe(0);
    expect(await ModerationOutbox.countDocuments({})).toBe(0);
  });

  /**
   * MUTATION GUARD, and the sharper half of it.
   *
   * `enqueueModerationOutboxEvent` already REQUIRES a session in its type. That
   * is not enough: a bare `startSession()` with no transaction open satisfies
   * the parameter, type-checks, and commits the outbox row on its own — which is
   * precisely the "report answered 201, delivery event lost on the next restart"
   * failure. Only the runtime `inTransaction()` check catches it, so only this
   * test proves the check is there.
   */
  it('refuses to enqueue outside an open transaction', async () => {
    const session = await mongoose.startSession();
    try {
      await expect(
        enqueueModerationOutboxEvent(
          { eventId: 'moderation:report.submit:x', kind: 'report.submit', payload: { reportId: 'x' } },
          session,
        ),
      ).rejects.toBeInstanceOf(ModerationOutboxTransactionError);
    } finally {
      await session.endSession();
    }

    expect(await ModerationOutbox.countDocuments({})).toBe(0);
  });

  /**
   * A reported type with no subject provider is STORED, never refused.
   *
   * Gating the route on the registry breaks every report surface an application
   * has not yet wired up, on the day it adopts CrowdSource. The distinction
   * between "no route out of this application" and "delivery failed" has to be
   * visible on the row, because a missing outbox event is also what a lost write
   * looks like.
   */
  it('stores a report whose type has no provider, and creates no delivery event', async () => {
    const caseId = new mongoose.Types.ObjectId();

    const result = await withReportIntakeSession((session) =>
      createModerationReport(
        {
          reportedType: ModerationReportedType.EVICTION_CASE,
          reportedId: String(caseId),
          reporter: 'oxy-reporter',
          reason: ListingReportReason.INAPPROPRIATE,
        },
        session,
      ),
    );

    expect(result.outboxEventId).toBeUndefined();
    expect(result.report.localStatus).toBe('received');
    expect(result.report.localStatusReason).toContain('eviction_case');

    // Not a skipped event — no event at all. An event a worker skips would
    // dead-letter a report that is not defective.
    expect(await ModerationOutbox.countDocuments({})).toBe(0);
  });

  it('refuses a second report of the same object by the same reporter', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const input = {
      reportedType: ModerationReportedType.PROPERTY,
      reportedId: String(property._id),
      reporter: 'oxy-reporter',
      reason: ListingReportReason.SCAM,
    };

    await withReportIntakeSession((session) => createModerationReport(input, session));

    await expect(
      withReportIntakeSession((session) => createModerationReport(input, session)),
    ).rejects.toBeInstanceOf(DuplicateModerationReportError);

    expect(await ModerationReport.countDocuments({})).toBe(1);
  });

  /**
   * A truthy non-string identifier is a Mongo operator, and `findOne` handed
   * `{$ne: null}` matches an UNRELATED report — answering "you already reported
   * this" about somebody else's row, then storing an operator where an id
   * belongs.
   */
  it('refuses an identifier that is not a string', async () => {
    await expect(
      withReportIntakeSession((session) =>
        createModerationReport(
          {
            reportedType: ModerationReportedType.PROPERTY,
            reportedId: { $ne: null } as unknown as string,
            reporter: 'oxy-reporter',
            reason: ListingReportReason.SCAM,
          },
          session,
        ),
      ),
    ).rejects.toBeInstanceOf(TypeError);

    expect(await ModerationReport.countDocuments({})).toBe(0);
  });

  it('answers a re-file as already-submitted rather than 500', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const app = buildApp('oxy-reporter');

    const first = await request(app)
      .post(`/properties/${property._id}/report`)
      .send({ reason: ListingReportReason.SCAM });
    expect(first.status).toBe(201);

    // Resolve the local record so its own "one open per reporter" guard no
    // longer fires — leaving the moderation record as the only thing that knows.
    await ListingReport.updateMany({}, { $set: { status: 'resolved' } });

    const second = await request(app)
      .post(`/properties/${property._id}/report`)
      .send({ reason: ListingReportReason.SCAM });
    expect(second.status).toBe(200);
    expect(second.body.message).toBe('Report already submitted');
    expect(await ModerationReport.countDocuments({})).toBe(1);
  });
});
