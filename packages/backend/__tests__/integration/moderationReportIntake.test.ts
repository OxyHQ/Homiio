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
 *
 * ## Postgres, and what changed in the port
 *
 * `withReportIntakeSession` became {@link withReportIntakeTransaction} and hands
 * out a drizzle transaction handle rather than a mongoose `ClientSession`; the
 * three tables are read with drizzle rather than through models. Two assertions
 * changed SHAPE and neither was dropped:
 *
 *  - "refuses to enqueue outside an open transaction" used a bare
 *    `startSession()` — a session that satisfies the type with no transaction
 *    open. Postgres has no such object; the equivalent hole is the ROOT
 *    connection, which satisfies `DatabaseOrTransaction` exactly as a bare
 *    session satisfied `ClientSession`. So the same guard is asserted against
 *    `getDb()`.
 *  - "refuses an identifier that is not a string" was about a Mongo operator
 *    (`{$ne: null}`) reaching a `findOne` filter. Parameterised SQL has no
 *    counterpart to that particular hole, but `requireIdentifier` is still in
 *    the service and is still what stops a row keyed by `"[object Object]"` —
 *    so the `TypeError` is asserted, now with the reason stated in the test.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { count, eq } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';
import { ListingReportReason, ModerationReportedType } from '@homiio/shared-types';

import {
  createModerationReport,
  withReportIntakeTransaction,
} from '../../services/moderation/ReportIntakeService';
import { DuplicateModerationReportError } from '../../db/moderation/moderationReportRepository';
import {
  enqueueModerationOutboxEvent,
  findModerationOutboxEvent,
} from '../../db/moderation/moderationOutboxRepository';
import { MissingTransactionError } from '../../db/moderation/transactionGuard';
import { insertListingReport } from '../../db/moderation/listingReportRepository';
import { reportSubmitEventId } from '../../services/moderation/ModerationOutboxService';
import { getDb } from '../../db/postgres';
import { listingReports, moderationOutbox, moderationReports } from '../../db/schema';
import {
  objectIdHex,
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
} from '../helpers/postgresGeoFixtures';

import { createListingReport } from '../../controllers/reportController';
import { errorHandler } from '../../middlewares/errorHandler';

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
  app.post('/properties/:propertyId/report', createListingReport);
  app.use(errorHandler);
  return app;
}

/** A listing to report, on its own geo chain. */
async function listing(): Promise<string> {
  const chain = await seedGeoChain({ countryCode: `M${nextChain++}` });
  const addressId = await seedAddress({ chain });
  return seedProperty({ addressId, overrides: { oxyUserId: 'oxy-owner' } });
}

/** Distinguishes the geo chains one test seeds; `countries_code_key` is UNIQUE. */
let nextChain = 0;

async function countRows(
  table: typeof listingReports | typeof moderationOutbox | typeof moderationReports,
): Promise<number> {
  const [row] = await getDb().select({ total: count() }).from(table);
  return row.total;
}

/**
 * Every table this file counts, emptied before each test.
 *
 * The counts below are the assertions — "nothing was left behind" is
 * `countRows(...) === 0` — so a row a previous test wrote would make them
 * measure the file's history rather than the transaction under test. Mongo got
 * this from `jest.setup.ts`'s collection wipe; Postgres fixtures are not
 * truncated globally, so it is stated here.
 *
 * Order matters: `listing_reports.property_id` CASCADEs from `properties`, but
 * `moderation_outbox.report_id` CASCADEs from `moderation_reports`, so the
 * outbox goes first — a `decision.apply` row carries no `report_id` at all and
 * would otherwise survive.
 */
beforeEach(async () => {
  const db = getDb();
  await db.delete(moderationOutbox);
  await db.delete(moderationReports);
  await db.delete(listingReports);
  await resetGeoTables();
  nextChain = 0;
});

describe('moderation report intake', () => {
  it('commits the report and its delivery event together', async () => {
    const propertyId = await listing();

    const res = await request(buildApp('oxy-reporter'))
      .post(`/properties/${propertyId}/report`)
      .send({ reason: ListingReportReason.SCAM });

    expect(res.status).toBe(201);

    const [moderationReport] = await getDb()
      .select()
      .from(moderationReports)
      .where(eq(moderationReports.reporterOxyUserId, 'oxy-reporter'));
    expect(moderationReport).toBeDefined();
    expect(moderationReport.reportedId).toBe(propertyId);
    expect(moderationReport.localStatus).toBe('queued');

    // The row IS the job. A queued report with no outbox event is moderation
    // work that exists and will never run.
    const event = await findModerationOutboxEvent(reportSubmitEventId(moderationReport.id));
    expect(event).toBeDefined();
    expect(event?.kind).toBe('report.submit');
    expect(event?.payload.reportId).toBe(moderationReport.id);

    // The status lives in a column the reassembled payload does not carry, so it
    // is read off the row itself.
    const [storedEvent] = await getDb()
      .select({ status: moderationOutbox.status })
      .from(moderationOutbox)
      .where(eq(moderationOutbox.id, reportSubmitEventId(moderationReport.id)));
    expect(storedEvent.status).toBe('pending');

    // The pre-existing local record is untouched by any of this.
    const [listingReport] = await getDb()
      .select()
      .from(listingReports)
      .where(eq(listingReports.propertyId, propertyId));
    expect(listingReport).toBeDefined();
    expect(listingReport.reporterOxyUserId).toBe('oxy-reporter');
  });

  /**
   * MUTATION GUARD. Drop the `tx` argument from either insert in
   * `createListingReport` — or replace `withReportIntakeTransaction` with a bare
   * `await` — and this test still needs to fail. It does, because a rolled-back
   * transaction leaves NEITHER row, and a non-transactional version leaves the
   * `listing_reports` row behind.
   */
  it('leaves nothing behind when the transaction aborts', async () => {
    const propertyId = await listing();

    await expect(
      withReportIntakeTransaction(async (tx) => {
        await insertListingReport(tx, {
          propertyId,
          reporterOxyUserId: 'oxy-reporter',
          reason: ListingReportReason.SCAM,
          status: 'open',
        });
        await createModerationReport(
          {
            reportedType: ModerationReportedType.PROPERTY,
            reportedId: propertyId,
            reporter: 'oxy-reporter',
            reason: ListingReportReason.SCAM,
          },
          tx,
        );
        throw new Error('something downstream failed');
      }),
    ).rejects.toThrow('something downstream failed');

    expect(await countRows(listingReports)).toBe(0);
    expect(await countRows(moderationReports)).toBe(0);
    expect(await countRows(moderationOutbox)).toBe(0);
  });

  /**
   * MUTATION GUARD, and the sharper half of it.
   *
   * `enqueueModerationOutboxEvent` already REQUIRES a `DatabaseOrTransaction` in
   * its type. That is not enough: the ROOT `Database` satisfies that type, so
   * `enqueueModerationOutboxEvent(input, getDb())` type-checks, commits the
   * outbox row on its own, and passes any test that only asserts the row exists
   * — which is precisely the "report answered 201, delivery event lost on the
   * next restart" failure. Only the runtime check in `transactionGuard.ts`
   * catches it, so only this test proves the check is there.
   *
   * `__tests__/db/moderationWrites.test.ts` asserts the same guard from the
   * repository's side, including the nested-transaction case. It is repeated
   * here because this is where the guard's PURPOSE lives: the intake path is the
   * one whose 201 would become a lie.
   */
  it('refuses to enqueue outside an open transaction', async () => {
    const eventId = `moderation:report.submit:${uuidv7()}`;

    await expect(
      enqueueModerationOutboxEvent(
        { eventId, kind: 'report.submit', payload: { reportId: 'x' } },
        getDb(),
      ),
    ).rejects.toBeInstanceOf(MissingTransactionError);

    expect(await countRows(moderationOutbox)).toBe(0);
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
    const caseId = objectIdHex();

    const result = await withReportIntakeTransaction((tx) =>
      createModerationReport(
        {
          reportedType: ModerationReportedType.EVICTION_CASE,
          reportedId: caseId,
          reporter: 'oxy-reporter',
          reason: ListingReportReason.INAPPROPRIATE,
        },
        tx,
      ),
    );

    expect(result.outboxEventId).toBeUndefined();
    expect(result.report.localStatus).toBe('received');
    expect(result.report.localStatusReason).toContain('eviction_case');

    // Not a skipped event — no event at all. An event a worker skips would
    // dead-letter a report that is not defective.
    expect(await countRows(moderationOutbox)).toBe(0);
  });

  /**
   * The duplicate is refused BY THE INDEX, and the caller still learns which row
   * it collided with.
   *
   * Both halves are the assertion, and the second half is the one a Postgres
   * port can lose without noticing. `insertModerationReport` converges on the
   * unique index's `23505` and then READS the existing row back so the caller
   * can answer "already submitted" with its id — but a statement that raises
   * inside an open transaction puts that transaction in the aborted state, and
   * every subsequent command in it is refused with `25P02` until it unwinds. So
   * the recovery read has to run somewhere the failed INSERT did not poison (a
   * savepoint), or the error the caller sees is a driver error rather than
   * `DuplicateModerationReportError` — and intake ALWAYS runs inside a
   * transaction, because that is the whole point of the intake path.
   *
   * `__tests__/db/moderationWrites.test.ts` cannot see this: it exercises the
   * same repository on the ROOT connection, where each statement is its own
   * implicit transaction and there is nothing to abort. This test is the one
   * that runs it the way production does.
   */
  it('refuses a second report of the same object by the same reporter', async () => {
    const propertyId = await listing();
    const input = {
      reportedType: ModerationReportedType.PROPERTY,
      reportedId: propertyId,
      reporter: 'oxy-reporter',
      reason: ListingReportReason.SCAM,
    };

    await withReportIntakeTransaction((tx) => createModerationReport(input, tx));

    await expect(
      withReportIntakeTransaction((tx) => createModerationReport(input, tx)),
    ).rejects.toBeInstanceOf(DuplicateModerationReportError);

    expect(await countRows(moderationReports)).toBe(1);
  });

  /**
   * A non-string identifier is refused at the point the row is built.
   *
   * Under Mongo this was an injection: a truthy non-string reached a `findOne`
   * filter, so `{$ne: null}` matched an UNRELATED report and answered "you
   * already reported this" about somebody else's row. Parameterised SQL closes
   * that particular hole, and the guard is still what this asserts — without it
   * the value is stringified into `reported_id` and the report is keyed by
   * `"[object Object]"`, which is a row nothing can ever be delivered for.
   */
  it('refuses an identifier that is not a string', async () => {
    await expect(
      withReportIntakeTransaction((tx) =>
        createModerationReport(
          {
            reportedType: ModerationReportedType.PROPERTY,
            reportedId: { $ne: null } as unknown as string,
            reporter: 'oxy-reporter',
            reason: ListingReportReason.SCAM,
          },
          tx,
        ),
      ),
    ).rejects.toBeInstanceOf(TypeError);

    expect(await countRows(moderationReports)).toBe(0);
  });

  /**
   * The end-to-end half of the test above, through the real controller.
   *
   * A reporter whose earlier report was resolved and who files again has done
   * nothing wrong, and the moderation record is the only thing that remembers
   * the case was already answered. Telling them "already submitted" is the whole
   * behaviour; a 500 is the same refusal with the reason replaced by an
   * apology, and it is what a duplicate raised inside an aborted transaction
   * produces — the controller's `instanceof DuplicateModerationReportError`
   * branch never runs because the error it is looking for was never
   * constructed.
   */
  it('answers a re-file as already-submitted rather than 500', async () => {
    const propertyId = await listing();
    const app = buildApp('oxy-reporter');

    const first = await request(app)
      .post(`/properties/${propertyId}/report`)
      .send({ reason: ListingReportReason.SCAM });
    expect(first.status).toBe(201);

    // Resolve the local record so its own "one open per reporter" guard no
    // longer fires — leaving the moderation record as the only thing that knows.
    await getDb().update(listingReports).set({ status: 'resolved' });

    const second = await request(app)
      .post(`/properties/${propertyId}/report`)
      .send({ reason: ListingReportReason.SCAM });
    expect(second.status).toBe(200);
    expect(second.body.message).toBe('Report already submitted');
    expect(await countRows(moderationReports)).toBe(1);
  });
});
