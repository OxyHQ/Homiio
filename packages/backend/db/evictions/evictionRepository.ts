/**
 * `eviction_cases` and its four related tables — the public solidarity board, on
 * Postgres.
 *
 * All five tables are empty in production (measured 2026-08-09: `evictioncases`,
 * `evictioncomments` and `evictionreports` all zero), so this port has no
 * backfill and no consistency window.
 *
 * Every `oxy_user_id` here — the organizer's, an attendee's, a commenter's, a
 * reporter's — is an Oxy account id: a foreign SERVICE's primary key, so it
 * carries no foreign key, exactly as `CONVENTIONS.md` requires.
 *
 * ## Three Mongo read-then-writes became constraints, and none is re-implemented
 *
 * **The RSVP toggle** was a two-step `$push` guarded by `$not $elemMatch`, then a
 * `$pull`, each `$inc`-ing a denormalized `attendeeCount` — a shape that drifts
 * under concurrency in two independent ways (two adds both passing the guard,
 * and a counter that is a second representation of the roster).
 * `eviction_case_attendees_case_user_key` makes the insert itself the check, and
 * the count is `count(*)` over the roster. See {@link toggleAttendance}.
 *
 * **`attendeeCount` is NOT ported at all.** It existed because `attendees` was
 * `select: false` and counting it meant loading it. Once the roster is its own
 * table an indexed `count(*)` answers it, and — unlike `properties.has_images`,
 * which is kept against the same rule — it is not a SORT key of any feed, so no
 * `ORDER BY` has to survive a correlated aggregate. Carrying it would be a second
 * representation of one fact that can disagree with the first.
 *
 * **The outcome-reminder claim** was already a guarded `updateOne`; it is the
 * same CAS here, expressed as an `UPDATE … WHERE outcome_reminder_sent_at IS
 * NULL … RETURNING`, so concurrent cron runs across tasks still notify exactly
 * once.
 *
 * ## `attendees` is a TABLE, and that is stronger than the flag it replaces
 *
 * Mongoose hid the roster with `select: false`, a per-QUERY default drizzle does
 * not have — a bare `select()` would return it. As `eviction_case_attendees` it
 * cannot be returned by accident at all: getting the roster requires writing a
 * join. The five `contact_*` columns are the ones that still need the protected
 * column registry, and they are in it.
 */

import { and, asc, count, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { getDb, inSavepoint, type DatabaseOrTransaction } from '../postgres';
import {
  evictionCaseAttendees,
  evictionCaseUpdates,
  evictionCases,
  evictionComments,
  evictionReports,
} from '../schema/evictions';
import { isUniqueViolation } from '../uniqueViolation';

export type EvictionCaseRow = typeof evictionCases.$inferSelect;
export type EvictionCaseInsert = typeof evictionCases.$inferInsert;
export type EvictionCaseUpdateRow = typeof evictionCaseUpdates.$inferSelect;
export type EvictionCommentRow = typeof evictionComments.$inferSelect;
export type EvictionReportRow = typeof evictionReports.$inferSelect;

/** A case with the two things every DTO needs alongside it. */
export interface EvictionCaseWithTimeline {
  readonly evictionCase: EvictionCaseRow;
  readonly updates: readonly EvictionCaseUpdateRow[];
  readonly attendeeCount: number;
}

/** How the public board is ordered, decided by the status being browsed. */
export type EvictionBoardOrder = 'soonest_first' | 'most_recent_first' | 'newest_created_first';

export interface EvictionBoardFilter {
  readonly status?: EvictionCaseRow['status'];
  readonly city?: string;
  readonly bbox?: {
    readonly swLat: number;
    readonly swLng: number;
    readonly neLat: number;
    readonly neLng: number;
  };
  /** Hide `upcoming` notices whose date is more than this far past. */
  readonly scheduledAfter?: Date;
  /** "My cases". */
  readonly oxyUserId?: string;
  /** "Cases I RSVP'd to". */
  readonly attendedByOxyUserId?: string;
}

function boardWhere(filter: EvictionBoardFilter) {
  return and(
    filter.status ? eq(evictionCases.status, filter.status) : undefined,
    filter.scheduledAfter ? gte(evictionCases.scheduledAt, filter.scheduledAfter) : undefined,
    filter.oxyUserId ? eq(evictionCases.oxyUserId, filter.oxyUserId) : undefined,
    // Case-insensitive exact match, replacing Mongo's anchored `RegExp` with the
    // user's string escaped into it. `lower(...) = lower(...)` needs no escaping
    // at all, so the escape helper the Mongo path required has no counterpart.
    filter.city
      ? sql`lower(${evictionCases.locationCity}) = lower(${filter.city})`
      : undefined,
    // The bbox, against the GENERATED geography column the GiST index covers.
    // `ST_MakeEnvelope` takes (xmin, ymin, xmax, ymax) — LONGITUDE first, the
    // same ordering trap `eviction_cases.location_geo` itself is built around.
    filter.bbox
      ? sql`${evictionCases.locationGeo} && ST_MakeEnvelope(
          ${filter.bbox.swLng}, ${filter.bbox.swLat},
          ${filter.bbox.neLng}, ${filter.bbox.neLat}, 4326)::geography`
      : undefined,
    filter.attendedByOxyUserId
      ? sql`exists (
          select 1 from ${evictionCaseAttendees}
          where ${evictionCaseAttendees.caseId} = ${evictionCases.id}
            and ${evictionCaseAttendees.oxyUserId} = ${filter.attendedByOxyUserId}
        )`
      : undefined,
  );
}

function boardOrder(order: EvictionBoardOrder) {
  switch (order) {
    case 'soonest_first':
      return asc(evictionCases.scheduledAt);
    case 'most_recent_first':
      return desc(evictionCases.scheduledAt);
    case 'newest_created_first':
      return desc(evictionCases.createdAt);
  }
}

export interface EvictionBoardPage {
  readonly total: number;
  readonly cases: readonly EvictionCaseRow[];
}

/** One page of the board, plus the total the pagination block needs. */
export async function listEvictionCases(
  filter: EvictionBoardFilter,
  page: { readonly limit: number; readonly skip: number; readonly order: EvictionBoardOrder },
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionBoardPage> {
  const where = boardWhere(filter);
  const [totals, cases] = await Promise.all([
    db.select({ total: count() }).from(evictionCases).where(where),
    db
      .select()
      .from(evictionCases)
      .where(where)
      .orderBy(boardOrder(page.order))
      .limit(page.limit)
      .offset(page.skip),
  ]);
  return { total: totals[0]?.total ?? 0, cases };
}

/** One case by id. */
export async function findEvictionCase(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCaseRow | undefined> {
  const [row] = await db
    .select()
    .from(evictionCases)
    .where(eq(evictionCases.id, caseId))
    .limit(1);
  return row;
}

/** One case, but only if `oxyUserId` owns it — the ownership gate every write uses. */
export async function findOwnedEvictionCase(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCaseRow | undefined> {
  const [row] = await db
    .select()
    .from(evictionCases)
    .where(and(eq(evictionCases.id, caseId), eq(evictionCases.oxyUserId, oxyUserId)))
    .limit(1);
  return row;
}

/** The timeline of one case, oldest entry first. */
export async function listEvictionUpdates(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly EvictionCaseUpdateRow[]> {
  return db
    .select()
    .from(evictionCaseUpdates)
    .where(eq(evictionCaseUpdates.caseId, caseId))
    .orderBy(asc(evictionCaseUpdates.createdAt));
}

/**
 * How many people said they will be there.
 *
 * The honest number, and the reason `attendeeCount` is not a column: this counts
 * the rows a unique index guarantees are one-per-person.
 */
export async function countEvictionAttendees(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(evictionCaseAttendees)
    .where(eq(evictionCaseAttendees.caseId, caseId));
  return row?.total ?? 0;
}

/** Attendee counts for a whole page of cases, in ONE query. */
export async function countAttendeesForCases(
  caseIds: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<ReadonlyMap<string, number>> {
  if (caseIds.length === 0) return new Map();
  const rows = await db
    .select({ caseId: evictionCaseAttendees.caseId, total: count() })
    .from(evictionCaseAttendees)
    .where(inArray(evictionCaseAttendees.caseId, [...caseIds]))
    .groupBy(evictionCaseAttendees.caseId);
  return new Map(rows.map((row) => [row.caseId, row.total]));
}

/** Which of `caseIds` this viewer is attending — one query for a whole page. */
export async function findAttendedCaseIds(
  caseIds: readonly string[],
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ReadonlySet<string>> {
  if (caseIds.length === 0) return new Set();
  const rows = await db
    .select({ caseId: evictionCaseAttendees.caseId })
    .from(evictionCaseAttendees)
    .where(
      and(
        inArray(evictionCaseAttendees.caseId, [...caseIds]),
        eq(evictionCaseAttendees.oxyUserId, oxyUserId),
      ),
    );
  return new Set(rows.map((row) => row.caseId));
}

/** The timelines of a whole page of cases, in ONE query. */
export async function listUpdatesForCases(
  caseIds: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<ReadonlyMap<string, EvictionCaseUpdateRow[]>> {
  if (caseIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(evictionCaseUpdates)
    .where(inArray(evictionCaseUpdates.caseId, [...caseIds]))
    .orderBy(asc(evictionCaseUpdates.createdAt));
  const byCase = new Map<string, EvictionCaseUpdateRow[]>();
  for (const row of rows) {
    const existing = byCase.get(row.caseId);
    if (existing) existing.push(row);
    else byCase.set(row.caseId, [row]);
  }
  return byCase;
}

/** Open a case. */
export async function insertEvictionCase(
  values: EvictionCaseInsert,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCaseRow> {
  const [row] = await db.insert(evictionCases).values(values).returning();
  return row;
}

/**
 * The columns an owner may change, and nothing else.
 *
 * Named explicitly rather than taken as a partial row: `oxy_user_id`, the RSVP
 * roster, the timeline and `outcome_reminder_sent_at` are server-owned forever,
 * and a spread here would be the one place a request body could reach them.
 *
 * `Partial` over the picked set, not the picked set itself: a PUT names the
 * columns it changes, so the six the insert requires (`title`, `description`,
 * the location label and its two coordinates, `scheduled_at`) must be optional
 * here or the only expressible patch would be one that rewrites every one of
 * them from a stale read. Same spelling as `LeaseColumnPatch`, and what
 * {@link updateOwnedEvictionCase}'s own `Object.keys(patch).length > 0` already
 * assumes.
 */
export type EvictionCasePatch = Partial<
  Pick<
    EvictionCaseInsert,
    | 'title'
    | 'description'
    | 'locationLabel'
    | 'locationLongitude'
    | 'locationLatitude'
    | 'locationPrecision'
    | 'locationCity'
    | 'locationCountryCode'
    | 'scheduledAt'
    | 'status'
    | 'agencyId'
    | 'contactPhone'
    | 'contactEmail'
    | 'contactTelegram'
    | 'contactWhatsapp'
    | 'contactInstructions'
    | 'coverImageId'
    | 'coverImageUrl'
  >
>;

/**
 * Apply an owner's patch, and append its timeline entry, atomically.
 *
 * One transaction because the two halves are one fact: a reschedule that is
 * visible on the case but missing from the timeline is a change nobody can
 * account for, and a timeline entry describing a change that did not commit is
 * worse. Mongo did both in one `findOneAndUpdate` with a `$push`; this is that
 * same atomicity, spelled across two tables.
 *
 * The ownership predicate is in the `UPDATE` itself, so a non-owner gets
 * `undefined` from the statement rather than from a preceding read that could
 * race a transfer.
 */
export async function updateOwnedEvictionCase(
  input: {
    readonly caseId: string;
    readonly oxyUserId: string;
    readonly patch: EvictionCasePatch;
    readonly timelineEntry?: {
      readonly message: string;
      readonly newScheduledAt?: Date;
      readonly newStatus?: EvictionCaseRow['status'];
    };
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCaseRow | undefined> {
  const run = async (tx: DatabaseOrTransaction): Promise<EvictionCaseRow | undefined> => {
    const hasPatch = Object.keys(input.patch).length > 0;
    const [row] = hasPatch
      ? await tx
          .update(evictionCases)
          .set(input.patch)
          .where(
            and(
              eq(evictionCases.id, input.caseId),
              eq(evictionCases.oxyUserId, input.oxyUserId),
            ),
          )
          .returning()
      : await tx
          .select()
          .from(evictionCases)
          .where(
            and(
              eq(evictionCases.id, input.caseId),
              eq(evictionCases.oxyUserId, input.oxyUserId),
            ),
          )
          .limit(1);
    if (!row) return undefined;

    if (input.timelineEntry) {
      await tx.insert(evictionCaseUpdates).values({
        caseId: input.caseId,
        message: input.timelineEntry.message,
        newScheduledAt: input.timelineEntry.newScheduledAt ?? null,
        newStatus: input.timelineEntry.newStatus ?? null,
      });
    }
    return row;
  };

  // Join a caller's transaction when there is one; open one otherwise. A
  // transaction handle has `rollback`; the root `Database` does not — the same
  // discriminator `db/moderation/transactionGuard.ts` documents.
  const canNest = typeof (db as { rollback?: unknown }).rollback === 'function';
  if (canNest) return run(db);
  return (db as ReturnType<typeof getDb>).transaction(run);
}

/**
 * Delete a case the caller owns.
 *
 * The comment thread, the timeline, the roster and any trust & safety reports go
 * with it by `ON DELETE CASCADE` — Mongo needed an explicit second
 * `EvictionComment.deleteMany`, and a cascade cannot be forgotten the way that
 * call could. `moderation_reports` deliberately does NOT cascade: its
 * `reported_id` carries no foreign key precisely so the record of what was
 * delivered and decided outlives the object it was about.
 */
export async function deleteOwnedEvictionCase(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const deleted = await db
    .delete(evictionCases)
    .where(and(eq(evictionCases.id, caseId), eq(evictionCases.oxyUserId, oxyUserId)))
    .returning({ id: evictionCases.id });
  return deleted.length === 1;
}

/** Append one timeline entry. */
export async function insertEvictionUpdate(
  input: {
    readonly caseId: string;
    readonly message: string;
    readonly newScheduledAt?: Date;
    readonly newStatus?: EvictionCaseRow['status'];
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCaseUpdateRow> {
  const [row] = await db
    .insert(evictionCaseUpdates)
    .values({
      caseId: input.caseId,
      message: input.message,
      newScheduledAt: input.newScheduledAt ?? null,
      newStatus: input.newStatus ?? null,
    })
    .returning();
  return row;
}

export interface AttendanceToggle {
  readonly attending: boolean;
  readonly attendeeCount: number;
}

/**
 * Toggle one person's RSVP, and report the honest turnout.
 *
 * The insert IS the "are they already attending?" check — `23505` from
 * `eviction_case_attendees_case_user_key` means they were, so the toggle removes
 * them instead. Mongo's read-then-write let two concurrent RSVPs from one person
 * both pass the guard and double-count them on a number the public board shows
 * as turnout.
 */
export async function toggleAttendance(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<AttendanceToggle> {
  let attending: boolean;
  try {
    await db.insert(evictionCaseAttendees).values({ caseId, oxyUserId });
    attending = true;
  } catch (error) {
    if (!isUniqueViolation(error, 'eviction_case_attendees_case_user_key')) throw error;
    await db
      .delete(evictionCaseAttendees)
      .where(
        and(
          eq(evictionCaseAttendees.caseId, caseId),
          eq(evictionCaseAttendees.oxyUserId, oxyUserId),
        ),
      );
    attending = false;
  }
  return { attending, attendeeCount: await countEvictionAttendees(caseId, db) };
}

/** Whether one viewer is attending one case. */
export async function isAttending(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const [row] = await db
    .select({ id: evictionCaseAttendees.id })
    .from(evictionCaseAttendees)
    .where(
      and(
        eq(evictionCaseAttendees.caseId, caseId),
        eq(evictionCaseAttendees.oxyUserId, oxyUserId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Everyone who said they will be there, except one person (usually the owner). */
export async function listAttendeeOxyUserIds(
  caseId: string,
  excludeOxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly string[]> {
  const rows = await db
    .select({ oxyUserId: evictionCaseAttendees.oxyUserId })
    .from(evictionCaseAttendees)
    .where(eq(evictionCaseAttendees.caseId, caseId));
  return rows
    .map((row) => row.oxyUserId)
    .filter((oxyUserId) => oxyUserId !== excludeOxyUserId);
}

export interface EvictionCommentPage {
  readonly total: number;
  readonly comments: readonly EvictionCommentRow[];
}

/** One page of a case's public thread, newest first. */
export async function listEvictionComments(
  caseId: string,
  page: { readonly limit: number; readonly skip: number },
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCommentPage> {
  const where = eq(evictionComments.caseId, caseId);
  const [totals, comments] = await Promise.all([
    db.select({ total: count() }).from(evictionComments).where(where),
    db
      .select()
      .from(evictionComments)
      .where(where)
      .orderBy(desc(evictionComments.createdAt))
      .limit(page.limit)
      .offset(page.skip),
  ]);
  return { total: totals[0]?.total ?? 0, comments };
}

/** Post a comment. */
export async function insertEvictionComment(
  input: { readonly caseId: string; readonly oxyUserId: string; readonly body: string },
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCommentRow> {
  const [row] = await db.insert(evictionComments).values(input).returning();
  return row;
}

/** One comment, scoped to its case so a wrong pairing is not found. */
export async function findEvictionComment(
  caseId: string,
  commentId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCommentRow | undefined> {
  const [row] = await db
    .select()
    .from(evictionComments)
    .where(and(eq(evictionComments.id, commentId), eq(evictionComments.caseId, caseId)))
    .limit(1);
  return row;
}

/** Remove a comment. Authorization is the caller's — see `comments.ts`. */
export async function deleteEvictionComment(
  caseId: string,
  commentId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const deleted = await db
    .delete(evictionComments)
    .where(and(eq(evictionComments.id, commentId), eq(evictionComments.caseId, caseId)))
    .returning({ id: evictionComments.id });
  return deleted.length === 1;
}

/** The OPEN trust & safety report this reporter filed about this case, if any. */
export async function findOpenEvictionReport(
  caseId: string,
  reporterOxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionReportRow | undefined> {
  const [row] = await db
    .select()
    .from(evictionReports)
    .where(
      and(
        eq(evictionReports.caseId, caseId),
        eq(evictionReports.reporterOxyUserId, reporterOxyUserId),
        eq(evictionReports.status, 'open'),
      ),
    )
    .limit(1);
  return row;
}

/** This reporter has an OPEN report against this case already. */
export class DuplicateEvictionReportError extends Error {
  readonly existing: EvictionReportRow;

  constructor(existing: EvictionReportRow) {
    super('This case has already been reported by this reporter.');
    this.name = 'DuplicateEvictionReportError';
    this.existing = existing;
  }
}

/**
 * File a trust & safety report against a case.
 *
 * @throws {DuplicateEvictionReportError} From `eviction_reports_open_reporter_key`,
 *   the PARTIAL unique index over open reports — so re-filing while one is still
 *   open converges instead of racing, and a CLOSED report does not block a new
 *   one.
 */
export async function insertEvictionReport(
  db: DatabaseOrTransaction,
  values: typeof evictionReports.$inferInsert,
): Promise<EvictionReportRow> {
  try {
    // In its own SAVEPOINT, so a conflict leaves the caller's transaction
    // usable for the recovery read below — see `inSavepoint`.
    const [row] = await inSavepoint(db, (tx) =>
      tx.insert(evictionReports).values(values).returning(),
    );
    return row;
  } catch (error) {
    if (!isUniqueViolation(error, 'eviction_reports_open_reporter_key')) throw error;
    const existing = await findOpenEvictionReport(
      values.caseId,
      values.reporterOxyUserId,
      db,
    );
    if (!existing) throw error;
    throw new DuplicateEvictionReportError(existing);
  }
}

/**
 * Cases whose date passed without an outcome, for the reminder job.
 *
 * `outcome_reminder_sent_at IS NULL` matches rows that predate the feature too,
 * exactly as Mongo's `{ outcomeReminderSentAt: null }` matched a missing field.
 */
export async function listEvictionCasesAwaitingOutcome(
  input: { readonly before: Date; readonly limit: number },
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly Pick<EvictionCaseRow, 'id' | 'oxyUserId' | 'title'>[]> {
  return db
    .select({
      id: evictionCases.id,
      oxyUserId: evictionCases.oxyUserId,
      title: evictionCases.title,
    })
    .from(evictionCases)
    .where(
      and(
        eq(evictionCases.status, 'upcoming'),
        lt(evictionCases.scheduledAt, input.before),
        isNull(evictionCases.outcomeReminderSentAt),
      ),
    )
    .limit(input.limit);
}

/**
 * Claim the once-per-case outcome nudge.
 *
 * The `IS NULL` predicate is in the `UPDATE`, so concurrent cron runs across ECS
 * tasks cannot both claim it: exactly one gets a row back and dispatches. The
 * claim commits BEFORE the notification is sent, which is the right way round —
 * a missed nudge is better than a repeated one, and the dispatch is best-effort
 * by design.
 *
 * @returns `true` when this call took the claim.
 */
export async function claimEvictionOutcomeReminder(
  caseId: string,
  now: Date = new Date(),
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const claimed = await db
    .update(evictionCases)
    .set({ outcomeReminderSentAt: now })
    .where(
      and(eq(evictionCases.id, caseId), isNull(evictionCases.outcomeReminderSentAt)),
    )
    .returning({ id: evictionCases.id });
  return claimed.length === 1;
}
