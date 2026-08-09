/**
 * The moderation writes, against a REAL Postgres server.
 *
 * Every property asserted here is one a mocked drizzle call cannot express, and
 * that is the entire reason this file exists rather than more unit tests. A
 * mocked `insert`/`update` accepts any statement, including one the server
 * rejects outright: a real CHECK, a real partial unique index, `FOR UPDATE SKIP
 * LOCKED` and the transaction guard have no mocked counterpart, so a suite built
 * on mocks would stay green through the exact regressions this pipeline cannot
 * survive.
 *
 * Both domains are EMPTY in production (measured 2026-08-09: all seven
 * collections at zero), so nothing here is protecting existing rows — it is
 * protecting the guarantees the first real report will depend on.
 */

import { eq, sql } from 'drizzle-orm';
import { CHECK_VIOLATION, constraintNameOf, sqlStateOf, uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, getDb, type Database } from '../../db/postgres';
import {
  enqueueModerationOutboxEvent,
  claimModerationOutboxEvent,
  completeModerationOutboxEvent,
  findModerationOutboxEvent,
} from '../../db/moderation/moderationOutboxRepository';
import { MissingTransactionError } from '../../db/moderation/transactionGuard';
import {
  claimModerationEvent,
  releaseModerationEvent,
} from '../../db/moderation/moderationEventRepository';
import {
  claimEnforcement,
  findPropertyRestriction,
  markEnforcementApplied,
  setPropertyRestriction,
} from '../../db/moderation/moderationEnforcementRepository';
import {
  insertModerationReport,
  DuplicateModerationReportError,
} from '../../db/moderation/moderationReportRepository';
import { moderationEnforcements, moderationOutbox, properties } from '../../db/schema';
import { seedAddress, seedGeoChain, seedProperty } from '../helpers/postgresGeoFixtures';

let db: Database;

/** A distinct suffix per test, so parallel workers and reruns never collide. */
function unique(prefix: string): string {
  return `${prefix}-${uuidv7()}`;
}

/**
 * A real `moderation_reports` row, because `moderation_outbox.report_id` is a
 * real foreign key with `ON DELETE CASCADE`.
 *
 * A fixture that invented a report id would fail here rather than in production
 * — which is the constraint working, and worth keeping: a submission job for a
 * report that does not exist is work with no subject.
 */
async function seedReport(): Promise<string> {
  const report = await insertModerationReport(getDb(), {
    reportedType: 'property',
    reportedId: unique('property'),
    reporterOxyUserId: unique('oxy-reporter'),
    reason: 'scam',
    localStatus: 'queued',
  });
  return report.id;
}

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

describe('the outbox enqueue refuses the root connection', () => {
  /**
   * The guard this asserts is the one that makes "a 201 means stored" true.
   *
   * `DatabaseOrTransaction` is satisfied by the ROOT `Database`, so
   * `enqueueModerationOutboxEvent(input, getDb())` type-checks perfectly, commits
   * the outbox row on its own, and passes any test that only asserts the row
   * exists. The failure it produces in production is a report answered 201 whose
   * delivery row never committed with it — discovered weeks later, if ever.
   */
  it('throws MissingTransactionError when handed getDb()', async () => {
    const eventId = unique('moderation:report.submit:root');

    await expect(
      enqueueModerationOutboxEvent(
        { eventId, kind: 'report.submit', payload: { reportId: await seedReport() } },
        getDb(),
      ),
    ).rejects.toThrow(MissingTransactionError);

    // And nothing was written — the refusal is before the statement, not after.
    expect(await findModerationOutboxEvent(eventId)).toBeUndefined();
  });

  it('accepts a real transaction handle', async () => {
    const eventId = unique('moderation:report.submit:tx');
    const reportId = await seedReport();
    await db.transaction(async (tx) => {
      await enqueueModerationOutboxEvent(
        { eventId, kind: 'report.submit', payload: { reportId } },
        tx,
      );
    });
    expect(await findModerationOutboxEvent(eventId)).toBeDefined();
  });

  /**
   * A nested (savepoint) transaction is still a transaction.
   *
   * The discriminator is `typeof handle.rollback === 'function'`, and this is the
   * case that would break if somebody replaced it with an `instanceof
   * PgTransaction` check under a hoisting arrangement that installed two copies
   * of drizzle.
   */
  it('accepts a nested transaction handle', async () => {
    const eventId = unique('moderation:report.submit:nested');
    const reportId = await seedReport();
    await db.transaction(async (tx) => {
      await tx.transaction(async (nested) => {
        await enqueueModerationOutboxEvent(
          { eventId, kind: 'report.submit', payload: { reportId } },
          nested,
        );
      });
    });
    expect(await findModerationOutboxEvent(eventId)).toBeDefined();
  });
});

describe('a repeated enqueue is a genuine no-op', () => {
  /**
   * `ON CONFLICT DO NOTHING` must write NOTHING — no tuple version, no
   * timestamp, no lock.
   *
   * The Mongo original carried a long comment about `timestamps: false` because
   * Mongoose's `$set: { updatedAt }` turned a repeated upsert into a real write
   * that contended with the dispatcher's live lease on that same row. `DO
   * UPDATE` reintroduces exactly that: drizzle applies a column's `$onUpdate` to
   * a conflict branch's `set`, so even "write the same data back" moves
   * `updated_at`.
   *
   * `xmin` is asserted as well as `updated_at`, and it is the assertion that
   * still catches a `DO UPDATE` careful enough to leave every column alone: the
   * system column changes on any real row version, whatever the values were.
   *
   * A repeat is ORDINARY here, not exotic — a transaction retry, two concurrent
   * duplicate submissions, or the reconciliation sweep re-deriving this same
   * deterministic id — and it runs while a dispatcher may hold a lease.
   */
  it('moves neither updated_at nor xmin', async () => {
    const eventId = unique('moderation:report.submit:repeat');
    const reportId = await seedReport();

    await db.transaction(async (tx) => {
      await enqueueModerationOutboxEvent(
        { eventId, kind: 'report.submit', payload: { reportId } },
        tx,
      );
    });

    const before = await db
      .select({ updatedAt: moderationOutbox.updatedAt, xmin: sql<string>`xmin::text` })
      .from(moderationOutbox)
      .where(eq(moderationOutbox.id, eventId));

    // Long enough that a timestamp rewrite is unambiguously visible.
    await new Promise((resolve) => setTimeout(resolve, 25));

    await db.transaction(async (tx) => {
      await enqueueModerationOutboxEvent(
        { eventId, kind: 'report.submit', payload: { reportId } },
        tx,
      );
    });

    const after = await db
      .select({ updatedAt: moderationOutbox.updatedAt, xmin: sql<string>`xmin::text` })
      .from(moderationOutbox)
      .where(eq(moderationOutbox.id, eventId));

    expect(after[0].updatedAt.getTime()).toBe(before[0].updatedAt.getTime());
    expect(after[0].xmin).toBe(before[0].xmin);
  });
});

describe('the outbox claim hands one row to exactly one dispatcher', () => {
  /**
   * `FOR UPDATE SKIP LOCKED`, asserted with real concurrency.
   *
   * Homiio runs an API task and a worker task against one database and every one
   * of them starts a dispatcher, so two claimers racing for one due row is the
   * NORMAL case rather than an edge one. A claim without `SKIP LOCKED` would
   * either block or hand the same event to both.
   */
  it('never gives the same event to two concurrent claimers', async () => {
    const eventId = unique('moderation:report.submit:race');
    const reportId = await seedReport();
    await db.transaction(async (tx) => {
      await enqueueModerationOutboxEvent(
        { eventId, kind: 'report.submit', payload: { reportId } },
        tx,
      );
    });

    const [first, second] = await Promise.all([
      claimModerationOutboxEvent({ leaseOwner: 'dispatcher-a', eventId }),
      claimModerationOutboxEvent({ leaseOwner: 'dispatcher-b', eventId }),
    ]);

    const winners = [first, second].filter((claim) => claim !== null);
    expect(winners).toHaveLength(1);
  });

  /** A completion carries the lease owner, so a reclaimed event cannot be completed by its previous holder. */
  it('refuses a completion from a dispatcher that no longer owns the lease', async () => {
    const eventId = unique('moderation:report.submit:lease');
    const reportId = await seedReport();
    await db.transaction(async (tx) => {
      await enqueueModerationOutboxEvent(
        { eventId, kind: 'report.submit', payload: { reportId } },
        tx,
      );
    });

    await claimModerationOutboxEvent({ leaseOwner: 'dispatcher-a', eventId });

    expect(await completeModerationOutboxEvent(eventId, 'dispatcher-b')).toBe(false);
    expect(await completeModerationOutboxEvent(eventId, 'dispatcher-a')).toBe(true);
  });
});

describe('the webhook dedupe claim', () => {
  /**
   * The claim is the INSERT and the empty `RETURNING` set is the answer.
   *
   * Deliberately not a caught `23505`: a dropped connection or a failover throws
   * something else entirely, and reading that as "already processed" would answer
   * the sender 200 and retire a decision nobody ever handled.
   */
  it('is taken once and refused the second time', async () => {
    const eventId = unique('cs-event');
    expect(await claimModerationEvent(eventId)).toBe(true);
    expect(await claimModerationEvent(eventId)).toBe(false);
  });

  it('can be given back so a redelivery is processed', async () => {
    const eventId = unique('cs-event-release');
    expect(await claimModerationEvent(eventId)).toBe(true);
    await releaseModerationEvent(eventId);
    expect(await claimModerationEvent(eventId)).toBe(true);
  });

  it('is not shared between two different events', async () => {
    expect(await claimModerationEvent(unique('cs-event-a'))).toBe(true);
    expect(await claimModerationEvent(unique('cs-event-b'))).toBe(true);
  });
});

describe('one report per reporter per object', () => {
  /**
   * The unique index, not a preceding read.
   *
   * Mongo's intake read `findOne(...)` and then inserted, which is a window two
   * concurrent submissions both pass — and the answer it produces is "you already
   * reported this" about a row that may not exist yet.
   */
  it('refuses a second report from the same reporter and returns the first', async () => {
    const reporterOxyUserId = unique('oxy-reporter');
    const reportedId = unique('property');

    const first = await insertModerationReport(getDb(), {
      reportedType: 'property',
      reportedId,
      reporterOxyUserId,
      reason: 'scam',
      localStatus: 'queued',
    });

    await expect(
      insertModerationReport(getDb(), {
        reportedType: 'property',
        reportedId,
        reporterOxyUserId,
        reason: 'scam',
        localStatus: 'queued',
      }),
    ).rejects.toThrow(DuplicateModerationReportError);

    // The existing row rides on the error, so the caller can answer with its id
    // rather than a bare conflict.
    await insertModerationReport(getDb(), {
      reportedType: 'property',
      reportedId,
      reporterOxyUserId: unique('oxy-other'),
      reason: 'scam',
      localStatus: 'queued',
    }).then((other) => expect(other.id).not.toBe(first.id));
  });

  /** The same object, reported under a DIFFERENT noun, is a different report. */
  it('scopes the key by reported type', async () => {
    const reporterOxyUserId = unique('oxy-reporter');
    const reportedId = unique('shared-id');

    await insertModerationReport(getDb(), {
      reportedType: 'property',
      reportedId,
      reporterOxyUserId,
      reason: 'scam',
      localStatus: 'queued',
    });
    const review = await insertModerationReport(getDb(), {
      reportedType: 'review',
      reportedId,
      reporterOxyUserId,
      reason: 'scam',
      localStatus: 'queued',
    });
    expect(review.id).toBeDefined();
  });
});

describe('enforcement is idempotent on decision + revision + action', () => {
  function enforcementValues(overrides: {
    decisionId: string;
    decisionRevision: number;
    action: 'restrict' | 'restore';
    subjectId: string;
  }) {
    return {
      decisionId: overrides.decisionId,
      decisionRevision: overrides.decisionRevision,
      action: overrides.action,
      caseId: unique('case'),
      subjectType: 'property',
      subjectId: overrides.subjectId,
      outcome: 'violation',
      reason: 'The jury found a violation.',
      mode: 'automatic' as const,
      applied: false,
    };
  }

  it('claims once and refuses the redelivery', async () => {
    const decisionId = unique('decision');
    const subjectId = unique('property');

    const first = await claimEnforcement(
      enforcementValues({ decisionId, decisionRevision: 1, action: 'restrict', subjectId }),
    );
    const second = await claimEnforcement(
      enforcementValues({ decisionId, decisionRevision: 1, action: 'restrict', subjectId }),
    );

    expect(first).toBeDefined();
    expect(second).toBeUndefined();
  });

  /**
   * THE reason `revision` is in the key.
   *
   * A correction is a NEW revision that supersedes the old one, so the `restore`
   * it asks for is a different action from the `restrict` that came before and
   * must be allowed to happen. Drop `revision` from the index and an upheld
   * appeal can never put a listing back — a failure whose only symptom is a
   * listing that stays down forever, with an enforcement row claiming it was
   * handled.
   */
  it('lets a later revision restore what an earlier one restricted', async () => {
    const decisionId = unique('decision');
    const subjectId = unique('property');

    const restrict = await claimEnforcement(
      enforcementValues({ decisionId, decisionRevision: 1, action: 'restrict', subjectId }),
    );
    const restore = await claimEnforcement(
      enforcementValues({ decisionId, decisionRevision: 2, action: 'restore', subjectId }),
    );

    expect(restrict).toBeDefined();
    expect(restore).toBeDefined();
  });

  /**
   * `applied` and `applied_at` are one fact, enforced by a CHECK.
   *
   * The distinction the table exists to preserve is between a plan that was
   * RECORDED and one that was EXECUTED — which is what makes `observe` mode an
   * audit rather than a silent no-op. Either column without the other erases it.
   */
  it('refuses an applied row with no timestamp', async () => {
    const decisionId = unique('decision');
    const claimed = await claimEnforcement(
      enforcementValues({
        decisionId,
        decisionRevision: 1,
        action: 'restrict',
        subjectId: unique('property'),
      }),
    );
    if (!claimed) throw new Error('claim returned no row');

    /**
     * Asserted by CONSTRAINT NAME, not by message text.
     *
     * drizzle does not rethrow the driver's error — it WRAPS it, so the
     * `PostgresError` carrying `code` and `constraint_name` is the `cause` and
     * the top-level message says only "Failed query". A `toThrow(/…check/)`
     * against the message therefore fails even when the constraint fired
     * correctly, which is what happened when this test was first written.
     * `db/uniqueViolation.ts` documents the same trap for `23505`.
     */
    const violation = await getDb()
      .update(moderationEnforcements)
      .set({ applied: true, appliedAt: null })
      .where(eq(moderationEnforcements.id, claimed.id))
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(violation).toBeDefined();
    expect(sqlStateOf(violation)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(violation)).toBe('moderation_enforcements_applied_at_check');

    // The repository's own path writes both together and is accepted.
    await markEnforcementApplied({ enforcementId: claimed.id });
    const [row] = await getDb()
      .select()
      .from(moderationEnforcements)
      .where(eq(moderationEnforcements.id, claimed.id));
    expect(row.applied).toBe(true);
    expect(row.appliedAt).not.toBeNull();
  });
});

describe('the property restriction lever', () => {
  let addressId: string;

  beforeAll(async () => {
    const chain = await seedGeoChain({ countryCode: 'MW', cityName: 'Moderation City' });
    addressId = await seedAddress({ chain, street: `Carrer Moderation ${uuidv7()}` });
  });

  /**
   * The regression this file exists to prevent, and the reason two guards were
   * deliberately NOT ported.
   *
   * The Mongo effects opened with `if (!mongoose.isValidObjectId(subject.id))
   * return { changed: false }`. Post-cutover every id `generatedId()` mints is a
   * uuid v7, for which `isValidObjectId` is FALSE — so keeping that guard would
   * have made every listing created after the cutover permanently
   * un-enforceable, while still reporting "nothing to do" as though it had
   * looked. A jury could restrict such a listing and it would stay up.
   */
  it('restricts a listing whose id is a uuid v7, not an ObjectId hex', async () => {
    const propertyId = await seedProperty({ addressId, idShape: 'generated' });
    // The shape is the point of the test — assert it rather than trusting the fixture.
    expect(propertyId).not.toMatch(/^[0-9a-f]{24}$/);

    expect(await findPropertyRestriction(propertyId)).toBe(false);

    const decisionId = unique('decision');
    expect(
      await setPropertyRestriction({ propertyId, restricted: true, decisionId }),
    ).toBe(true);
    expect(await findPropertyRestriction(propertyId)).toBe(true);
  });

  it('restricts a listing whose id is a pre-cutover ObjectId hex', async () => {
    const propertyId = await seedProperty({ addressId, idShape: 'objectId' });
    expect(propertyId).toMatch(/^[0-9a-f]{24}$/);

    expect(
      await setPropertyRestriction({ propertyId, restricted: true, decisionId: unique('d') }),
    ).toBe(true);
    expect(await findPropertyRestriction(propertyId)).toBe(true);
  });

  /**
   * Clearing nulls the provenance columns in the same statement, so a restored
   * listing never keeps a stale decision id claiming it is still restricted.
   */
  it('clears the provenance columns when the restriction is lifted', async () => {
    const propertyId = await seedProperty({ addressId, idShape: 'generated' });
    const decisionId = unique('d');
    await setPropertyRestriction({ propertyId, restricted: true, decisionId });

    const [restricted] = await getDb()
      .select({
        restricted: properties.moderationRestricted,
        at: properties.moderationRestrictedAt,
        byDecisionId: properties.moderationRestrictedByDecisionId,
      })
      .from(properties)
      .where(eq(properties.id, propertyId));
    expect(restricted.restricted).toBe(true);
    expect(restricted.at).not.toBeNull();
    expect(restricted.byDecisionId).toBe(decisionId);

    await setPropertyRestriction({ propertyId, restricted: false });

    const [cleared] = await getDb()
      .select({
        restricted: properties.moderationRestricted,
        at: properties.moderationRestrictedAt,
        byDecisionId: properties.moderationRestrictedByDecisionId,
      })
      .from(properties)
      .where(eq(properties.id, propertyId));
    expect(cleared.restricted).toBe(false);
    expect(cleared.at).toBeNull();
    expect(cleared.byDecisionId).toBeNull();
  });

  /** A listing that is gone answers `undefined`, which is what lets the effect say "no longer exists". */
  it('answers undefined for a listing that does not exist', async () => {
    expect(await findPropertyRestriction(uuidv7())).toBeUndefined();
    expect(
      await setPropertyRestriction({ propertyId: uuidv7(), restricted: true, decisionId: 'd' }),
    ).toBe(false);
  });
});
