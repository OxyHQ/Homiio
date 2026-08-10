/**
 * `eviction_cases` and its child tables — the public solidarity board, on
 * Postgres.
 *
 * Every `oxy_user_id` here — the organiser's, an attendee's, a commenter's, a
 * reporter's — is an Oxy account id: a foreign SERVICE's primary key, so it
 * carries no foreign key, exactly as `CONVENTIONS.md` requires.
 *
 * ## Every case read goes through `publicColumns`, and that is the privacy gate
 *
 * ADR 0003 §4.3 (F5) records that this module used to run bare `.select()` on
 * `eviction_cases` at five call sites — the exact shape `findImplicitWholeRowReads`
 * exists to catch — so the five protected contact columns were loaded on every
 * read and withheld only by the DTO. They are not any more: {@link EvictionCaseRow}
 * is `Omit<…, protected>` DERIVED FROM THE REGISTRY, so a serializer that
 * touches `contactPhone` or `locationExactLongitude` fails `tsc` rather than
 * shipping it, and a column added to the registry later drops out of this type
 * for free.
 *
 * The two paths that legitimately need a protected column NAME it:
 * {@link readCaseContact} and {@link readExactLocation}. That is the sanctioned
 * escape hatch, and it reads differently from an ordinary select on purpose.
 *
 * ## Three Mongo read-then-writes became constraints, and none is re-implemented
 *
 * **The RSVP toggle** was a two-step `$push` guarded by `$not $elemMatch`.
 * `eviction_case_attendees_case_user_key` makes the insert itself the check, and
 * the count is `count(*)` over the roster. See {@link toggleAttendance}.
 *
 * **`attendeeCount` is NOT ported at all.** An indexed `count(*)` answers it,
 * and it is not a SORT key of any feed, so no `ORDER BY` has to survive a
 * correlated aggregate.
 *
 * **The outcome-reminder claim** is the same compare-and-set, expressed as an
 * `UPDATE … WHERE outcome_reminder_sent_at IS NULL … RETURNING`.
 *
 * ## The status transition is enforced in the QUERY, not in a CHECK
 *
 * A CHECK cannot see the previous row, and a trigger would put the rule
 * somewhere no test in this package looks. {@link updateOwnedEvictionCase}
 * instead puts the permitted predecessors into the `UPDATE`'s own `WHERE`, so an
 * invalid transition matches no row — the same shape as the ownership predicate
 * beside it, and visible to a test that counts rows.
 */

import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { EVICTION_STATUS_TRANSITIONS, type EvictionHelpNeedType } from '@homiio/shared-types';
import { getDb, inSavepoint, type DatabaseOrTransaction } from '../postgres';
import {
  evictionCaseAttendees,
  evictionCaseFollowers,
  evictionCaseHelpNeeds,
  evictionCaseUpdates,
  evictionCases,
  evictionComments,
  evictionOrganizations,
  evictionReports,
  evictionSupporterVouches,
  evictionUpdateNotifications,
} from '../schema/evictions';
import { PROTECTED_COLUMNS_BY_TABLE, publicColumns } from '../schema/protectedColumns';
import { isUniqueViolation } from '../uniqueViolation';

/**
 * The case columns every read outside the two named escape hatches may see.
 *
 * Built once so the selection object is shared and a caller cannot accidentally
 * assemble a different one.
 */
const publicCaseColumns = publicColumns(evictionCases);

/**
 * A case row, with the protected columns removed AT THE TYPE LEVEL.
 *
 * Derived from `PROTECTED_COLUMNS_BY_TABLE` rather than listed, so this type and
 * the registry cannot disagree — a column protected tomorrow disappears from
 * every serializer's input today.
 */
export type EvictionCaseRow = Omit<
  typeof evictionCases.$inferSelect,
  (typeof PROTECTED_COLUMNS_BY_TABLE)['eviction_cases'][number]
>;
export type EvictionCaseInsert = typeof evictionCases.$inferInsert;
export type EvictionCaseUpdateRow = typeof evictionCaseUpdates.$inferSelect;
export type EvictionCommentRow = typeof evictionComments.$inferSelect;
export type EvictionReportRow = typeof evictionReports.$inferSelect;
export type EvictionHelpNeedRow = typeof evictionCaseHelpNeeds.$inferSelect;
export type EvictionOrganizationRow = typeof evictionOrganizations.$inferSelect;

/** A case row plus the metre distance from the centre a query was scoped by. */
export interface EvictionCaseRowWithDistance extends EvictionCaseRow {
  readonly distanceMeters: number | null;
}

/** A case with everything a DTO needs alongside it. */
export interface EvictionCaseWithTimeline {
  readonly evictionCase: EvictionCaseRow;
  readonly timeline: readonly EvictionCaseUpdateRow[];
  readonly attendeeCount: number;
  readonly helpNeeds: readonly EvictionHelpNeedRow[];
  readonly organization?: EvictionOrganizationRow;
  readonly distanceMeters?: number;
}

/**
 * WHERE a board request is asking about.
 *
 * There is no member meaning "everywhere by default". ADR 0002's second
 * invariant is that location is never implicit, so `global` has to be asked for
 * by name — a geocoding failure produces an error, never this.
 */
export type EvictionScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'city'; readonly city: string }
  | {
      readonly kind: 'bbox';
      readonly swLat: number;
      readonly swLng: number;
      readonly neLat: number;
      readonly neLng: number;
    }
  | {
      readonly kind: 'radius';
      readonly lat: number;
      readonly lng: number;
      readonly radiusMeters: number;
    }
  | { readonly kind: 'following'; readonly oxyUserId: string }
  | { readonly kind: 'attending'; readonly oxyUserId: string }
  | { readonly kind: 'owned'; readonly oxyUserId: string };

export type EvictionBoardSort = 'soonest' | 'distance' | 'recently_updated' | 'newest';

export interface EvictionBoardFilter {
  readonly scope: EvictionScope;
  readonly status?: EvictionCaseRow['status'];
  readonly scheduledFrom?: Date;
  readonly scheduledTo?: Date;
  readonly organizationId?: string;
  readonly helpNeed?: EvictionHelpNeedType;
  /** Only cases whose last change is at or after this instant. */
  readonly updatedSince?: Date;
  /** Hide `upcoming` notices whose date is more than this far past. */
  readonly scheduledAfter?: Date;
  /** Archived cases leave the board; the sweep sets `archived_at`. */
  readonly includeArchived?: boolean;
}

/** The centre a scope implies, when it has one. Drives distance sort and output. */
function scopeCenter(scope: EvictionScope): { lng: number; lat: number } | undefined {
  if (scope.kind === 'radius') return { lng: scope.lng, lat: scope.lat };
  if (scope.kind === 'bbox') {
    // A bbox centre is only used as a distance ORIGIN, never as a place. The
    // naive midpoint is wrong across the antimeridian, and this board has no
    // reason to guess there — so a box that crosses it simply sorts without a
    // distance rather than sorting by a point in the Gulf of Guinea.
    if (scope.swLng > scope.neLng) return undefined;
    return { lng: (scope.swLng + scope.neLng) / 2, lat: (scope.swLat + scope.neLat) / 2 };
  }
  return undefined;
}

function scopeWhere(scope: EvictionScope) {
  switch (scope.kind) {
    case 'global':
      return undefined;
    case 'city':
      // Case-insensitive exact match, replacing Mongo's anchored `RegExp` with
      // the user's string escaped into it. `lower(...) = lower(...)` needs no
      // escaping at all, so the escape helper the Mongo path required has no
      // counterpart.
      return sql`lower(${evictionCases.locationCity}) = lower(${scope.city})`;
    case 'bbox':
      // Against the GENERATED geography column the GiST index covers.
      // `ST_MakeEnvelope` takes (xmin, ymin, xmax, ymax) — LONGITUDE first, the
      // same ordering trap `eviction_cases.location_geo` itself is built around.
      return sql`${evictionCases.locationGeo} && ST_MakeEnvelope(
          ${scope.swLng}, ${scope.swLat},
          ${scope.neLng}, ${scope.neLat}, 4326)::geography`;
    case 'radius':
      return sql`ST_DWithin(
          ${evictionCases.locationGeo},
          ST_MakePoint(${scope.lng}, ${scope.lat})::geography,
          ${scope.radiusMeters})`;
    case 'following':
      return sql`exists (
          select 1 from ${evictionCaseFollowers}
          where ${evictionCaseFollowers.caseId} = ${evictionCases.id}
            and ${evictionCaseFollowers.oxyUserId} = ${scope.oxyUserId}
        )`;
    case 'attending':
      return sql`exists (
          select 1 from ${evictionCaseAttendees}
          where ${evictionCaseAttendees.caseId} = ${evictionCases.id}
            and ${evictionCaseAttendees.oxyUserId} = ${scope.oxyUserId}
        )`;
    case 'owned':
      return eq(evictionCases.oxyUserId, scope.oxyUserId);
  }
}

function boardWhere(filter: EvictionBoardFilter) {
  return and(
    scopeWhere(filter.scope),
    filter.status ? eq(evictionCases.status, filter.status) : undefined,
    filter.scheduledFrom ? gte(evictionCases.scheduledAt, filter.scheduledFrom) : undefined,
    filter.scheduledTo ? lte(evictionCases.scheduledAt, filter.scheduledTo) : undefined,
    filter.scheduledAfter ? gte(evictionCases.scheduledAt, filter.scheduledAfter) : undefined,
    filter.organizationId ? eq(evictionCases.organizationId, filter.organizationId) : undefined,
    filter.updatedSince ? gte(evictionCases.updatedAt, filter.updatedSince) : undefined,
    filter.includeArchived ? undefined : isNull(evictionCases.archivedAt),
    filter.helpNeed
      ? sql`exists (
          select 1 from ${evictionCaseHelpNeeds}
          where ${evictionCaseHelpNeeds.caseId} = ${evictionCases.id}
            and ${evictionCaseHelpNeeds.needType} = ${filter.helpNeed}
        )`
      : undefined,
  );
}

/**
 * The distance expression, or NULL when the query has no centre.
 *
 * Measured to the PUBLISHED centre, never to the exact point — the exact point
 * is not in this query at all, and a distance computed from it would be a
 * precise fact about a home leaking through an ORDER BY.
 */
function distanceExpression(center: { lng: number; lat: number } | undefined) {
  if (!center) return sql<number | null>`null::double precision`;
  return sql<number>`ST_Distance(
    ${evictionCases.locationGeo},
    ST_MakePoint(${center.lng}, ${center.lat})::geography
  )`;
}

export interface EvictionBoardPage {
  readonly total: number;
  readonly cases: readonly EvictionCaseRowWithDistance[];
}

/**
 * One page of the board, plus the total the pagination block needs.
 *
 * **The count and the page are the SAME `where`.** #358 requires list, map and
 * total to share one query, and the way that guarantee is kept is that
 * `boardWhere` is evaluated once and handed to both statements — not that two
 * call sites are careful. A filter applied to the page and not the count is the
 * failure this shape makes unrepresentable.
 */
export async function listEvictionCases(
  filter: EvictionBoardFilter,
  page: { readonly limit: number; readonly skip: number; readonly sort: EvictionBoardSort },
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionBoardPage> {
  const where = boardWhere(filter);
  const center = scopeCenter(filter.scope);
  const distance = distanceExpression(center);

  // Every ordering ends in `id`, so a page boundary cannot straddle two rows
  // that compare equal — without it, two cases scheduled at the same instant can
  // swap between page 1 and page 2 and one of them is never shown.
  const orderBy = (() => {
    switch (page.sort) {
      case 'soonest':
        return [asc(evictionCases.scheduledAt), asc(evictionCases.id)];
      case 'newest':
        return [desc(evictionCases.createdAt), asc(evictionCases.id)];
      case 'recently_updated':
        return [desc(evictionCases.updatedAt), asc(evictionCases.id)];
      case 'distance':
        // Without a centre there is nothing to sort by, so it falls back to the
        // actionable ordering rather than to an arbitrary one. The controller
        // refuses `sort=distance` without a centre before reaching here; this is
        // the second half of that, so a future caller cannot get a silent
        // random order.
        return center
          ? [sql`${distance} asc`, asc(evictionCases.id)]
          : [asc(evictionCases.scheduledAt), asc(evictionCases.id)];
    }
  })();

  const [totals, cases] = await Promise.all([
    db.select({ total: count() }).from(evictionCases).where(where),
    db
      .select({ ...publicCaseColumns, distanceMeters: distance })
      .from(evictionCases)
      .where(where)
      .orderBy(...orderBy)
      .limit(page.limit)
      .offset(page.skip),
  ]);
  return { total: totals[0]?.total ?? 0, cases };
}

/** One case by id. Archived cases are still reachable by direct link. */
export async function findEvictionCase(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCaseRow | undefined> {
  const [row] = await db
    .select(publicCaseColumns)
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
    .select(publicCaseColumns)
    .from(evictionCases)
    .where(and(eq(evictionCases.id, caseId), eq(evictionCases.oxyUserId, oxyUserId)))
    .limit(1);
  return row;
}

/** The organiser's contact block. One of the two sanctioned protected reads. */
export interface EvictionCaseContact {
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly contactTelegram: string | null;
  readonly contactWhatsapp: string | null;
  readonly contactInstructions: string | null;
}

/**
 * Read the five protected `contact_*` columns, by name.
 *
 * Deliberately a separate call rather than an option on the reads above: the
 * caller has to decide it needs them, and `git grep readCaseContact` is the
 * complete list of places organiser contact can leave the database.
 */
export async function readCaseContact(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCaseContact | undefined> {
  const [row] = await db
    .select({
      contactPhone: evictionCases.contactPhone,
      contactEmail: evictionCases.contactEmail,
      contactTelegram: evictionCases.contactTelegram,
      contactWhatsapp: evictionCases.contactWhatsapp,
      contactInstructions: evictionCases.contactInstructions,
    })
    .from(evictionCases)
    .where(eq(evictionCases.id, caseId))
    .limit(1);
  return row;
}

/** The exact location. The other sanctioned protected read, and the guarded one. */
export interface EvictionExactLocation {
  readonly longitude: number | null;
  readonly latitude: number | null;
  readonly address: string | null;
  readonly householdAuthorizedAt: Date | null;
}

/**
 * Read the three protected `location_exact_*` columns, by name.
 *
 * This function performs NO authorisation. `db/evictions/evictionAccessRepository.ts`
 * owns that, and every call site there writes an audit row — keeping the two
 * apart means the audit cannot be forgotten by a caller that only wanted the
 * coordinate, because the coordinate is not what this module exports to
 * controllers.
 */
export async function readExactLocation(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionExactLocation | undefined> {
  const [row] = await db
    .select({
      longitude: evictionCases.locationExactLongitude,
      latitude: evictionCases.locationExactLatitude,
      address: evictionCases.locationExactAddress,
      householdAuthorizedAt: evictionCases.locationHouseholdAuthorizedAt,
    })
    .from(evictionCases)
    .where(eq(evictionCases.id, caseId))
    .limit(1);
  return row;
}

/** The timeline of one case, oldest entry first. */
export async function listEvictionTimeline(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly EvictionCaseUpdateRow[]> {
  return db
    .select()
    .from(evictionCaseUpdates)
    .where(eq(evictionCaseUpdates.caseId, caseId))
    .orderBy(asc(evictionCaseUpdates.position));
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

/** Which of `caseIds` this viewer FOLLOWS — one query for a whole page. */
export async function findFollowedCaseIds(
  caseIds: readonly string[],
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ReadonlySet<string>> {
  if (caseIds.length === 0) return new Set();
  const rows = await db
    .select({ caseId: evictionCaseFollowers.caseId })
    .from(evictionCaseFollowers)
    .where(
      and(
        inArray(evictionCaseFollowers.caseId, [...caseIds]),
        eq(evictionCaseFollowers.oxyUserId, oxyUserId),
      ),
    );
  return new Set(rows.map((row) => row.caseId));
}

/** The timelines of a whole page of cases, in ONE query. */
export async function listTimelineForCases(
  caseIds: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<ReadonlyMap<string, EvictionCaseUpdateRow[]>> {
  if (caseIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(evictionCaseUpdates)
    .where(inArray(evictionCaseUpdates.caseId, [...caseIds]))
    .orderBy(asc(evictionCaseUpdates.position));
  const byCase = new Map<string, EvictionCaseUpdateRow[]>();
  for (const row of rows) {
    const existing = byCase.get(row.caseId);
    if (existing) existing.push(row);
    else byCase.set(row.caseId, [row]);
  }
  return byCase;
}

/** The help needs of a whole page of cases, in ONE query. */
export async function listHelpNeedsForCases(
  caseIds: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<ReadonlyMap<string, EvictionHelpNeedRow[]>> {
  if (caseIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(evictionCaseHelpNeeds)
    .where(inArray(evictionCaseHelpNeeds.caseId, [...caseIds]))
    .orderBy(asc(evictionCaseHelpNeeds.createdAt));
  const byCase = new Map<string, EvictionHelpNeedRow[]>();
  for (const row of rows) {
    const existing = byCase.get(row.caseId);
    if (existing) existing.push(row);
    else byCase.set(row.caseId, [row]);
  }
  return byCase;
}

/** The organisations named by a whole page of cases, in ONE query. */
export async function listOrganizationsByIds(
  ids: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<ReadonlyMap<string, EvictionOrganizationRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select()
    .from(evictionOrganizations)
    .where(inArray(evictionOrganizations.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Resolve an organisation NAME to a row, creating an UNVERIFIED one if needed.
 *
 * Creating is allowed here and NOT allowed for `agencies` (whose resolver is a
 * pure lookup), and the asymmetry is the point: naming the collective you belong
 * to is the ordinary case on this board, while minting an `agencies` row from a
 * public notice surface would let a read path write to the entity that property
 * listings and reviews are keyed by.
 *
 * A created row is never verified, and no route can make it so.
 */
export async function findOrCreateOrganizationByName(
  name: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionOrganizationRow | undefined> {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.toLocaleLowerCase();

  // `DO NOTHING` rather than letting the insert fail: a duplicate here is the
  // expected case, and a failed statement would abort the caller's whole
  // transaction (`25P02`) for something that is not an error.
  const inserted = await db
    .insert(evictionOrganizations)
    .values({ name: trimmed, normalizedName: normalized })
    .onConflictDoNothing({ target: evictionOrganizations.normalizedName })
    .returning();
  if (inserted[0]) return inserted[0];

  const [existing] = await db
    .select()
    .from(evictionOrganizations)
    .where(eq(evictionOrganizations.normalizedName, normalized))
    .limit(1);
  return existing;
}

/** Open a case. */
export async function insertEvictionCase(
  values: EvictionCaseInsert,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCaseRow> {
  const [row] = await db.insert(evictionCases).values(values).returning(publicCaseColumns);
  return row;
}

/**
 * The columns an owner may change, and nothing else.
 *
 * Named explicitly rather than taken as a partial row: `oxy_user_id`, the RSVP
 * roster, the timeline, the moderation state, the archive stamp and
 * `outcome_reminder_sent_at` are server-owned forever, and a spread here would
 * be the one place a request body could reach them.
 *
 * `Partial` over the picked set, not the picked set itself: a PUT names the
 * columns it changes, so the ones the insert requires must be optional here or
 * the only expressible patch would be one that rewrites every one of them from a
 * stale read.
 */
export type EvictionCasePatch = Partial<
  Pick<
    EvictionCaseInsert,
    | 'title'
    | 'description'
    | 'locationLabel'
    | 'locationLongitude'
    | 'locationLatitude'
    | 'locationRadiusMeters'
    | 'locationPrecision'
    | 'locationCity'
    | 'locationCountryCode'
    | 'locationExactLongitude'
    | 'locationExactLatitude'
    | 'locationExactAddress'
    | 'locationHouseholdAuthorizedAt'
    | 'scheduledAt'
    | 'status'
    | 'agencyId'
    | 'organizationId'
    | 'contactPhone'
    | 'contactEmail'
    | 'contactTelegram'
    | 'contactWhatsapp'
    | 'contactInstructions'
    | 'contactUnlockMinTenureDays'
    | 'coverImageId'
    | 'coverImageUrl'
  >
>;

/** One entry to append to a case's timeline, in the same transaction as its cause. */
export interface EvictionTimelineEntryInput {
  readonly eventType: EvictionCaseUpdateRow['eventType'];
  /** The organiser, or `null` for a system event. */
  readonly actorOxyUserId: string | null;
  readonly message: string;
  readonly newScheduledAt?: Date;
  readonly newStatus?: EvictionCaseRow['status'];
}

/**
 * Append one timeline entry, with its `position` computed IN SQL.
 *
 * `coalesce(max(position), 0) + 1` runs on the server. Computing it in
 * JavaScript is the `bigint`-as-string trap: postgres.js decodes `int8` as a
 * STRING, so `max + 1` is string concatenation that type-checks clean and puts
 * the second entry at position `11`. `__tests__/db/evictionTimeline.test.ts`
 * appends TWICE for that reason — one append cannot tell the two apart.
 *
 * Concurrent appends race on `max`, and
 * `eviction_case_updates_case_position_key` turns that race into a `23505`
 * rather than two entries claiming one position.
 */
export async function appendTimelineEntry(
  caseId: string,
  entry: EvictionTimelineEntryInput,
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionCaseUpdateRow> {
  const [row] = await db
    .insert(evictionCaseUpdates)
    .values({
      caseId,
      position: sql`(
        select coalesce(max(inner_updates.position), 0) + 1
        from ${evictionCaseUpdates} as inner_updates
        where inner_updates.case_id = ${caseId}
      )`,
      eventType: entry.eventType,
      actorOxyUserId: entry.actorOxyUserId,
      message: entry.message,
      newScheduledAt: entry.newScheduledAt ?? null,
      newStatus: entry.newStatus ?? null,
    })
    .returning();
  return row;
}

/**
 * Which statuses may legally become `next`, derived from the SHARED table.
 *
 * Inverted from `EVICTION_STATUS_TRANSITIONS` rather than written out, so the
 * frontend's disabled controls and this `WHERE` clause cannot disagree — a
 * second copy of a transition table is a second copy that drifts.
 */
function predecessorsOf(next: EvictionCaseRow['status']): readonly EvictionCaseRow['status'][] {
  const froms = Object.keys(EVICTION_STATUS_TRANSITIONS) as EvictionCaseRow['status'][];
  return froms.filter((from) => EVICTION_STATUS_TRANSITIONS[from].includes(next));
}

/** What `updateOwnedEvictionCase` did, so a caller can answer 404 or 409. */
export type EvictionUpdateOutcome =
  | {
      readonly outcome: 'updated';
      readonly row: EvictionCaseRow;
      /**
       * The timeline rows this call wrote, in order.
       *
       * Returned rather than looked up afterwards because each one is the
       * IDEMPOTENCY KEY its notification is claimed against — and a caller that
       * had to re-find its own entry by matching on the message would be
       * guessing, in the one place where guessing wrong means notifying twice or
       * not at all.
       */
      readonly timelineEntries: readonly EvictionCaseUpdateRow[];
    }
  | { readonly outcome: 'not_found' }
  | {
      readonly outcome: 'invalid_transition';
      readonly from: EvictionCaseRow['status'];
      readonly to: EvictionCaseRow['status'];
    };

/**
 * Apply an owner's patch, and append its timeline entry, atomically.
 *
 * One transaction because the two halves are one fact: a reschedule that is
 * visible on the case but missing from the timeline is a change nobody can
 * account for, and a timeline entry describing a change that did not commit is
 * worse.
 *
 * The ownership predicate AND the status-transition predicate are both in the
 * `UPDATE` itself, so neither is a preceding read a concurrent write could race.
 * The follow-up `SELECT` exists only to tell 404 from 409 for the error message
 * — by then the write has already declined.
 */
export async function updateOwnedEvictionCase(
  input: {
    readonly caseId: string;
    readonly oxyUserId: string;
    readonly patch: EvictionCasePatch;
    readonly timelineEntries?: readonly EvictionTimelineEntryInput[];
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<EvictionUpdateOutcome> {
  const run = async (tx: DatabaseOrTransaction): Promise<EvictionUpdateOutcome> => {
    const hasPatch = Object.keys(input.patch).length > 0;
    const ownership = and(
      eq(evictionCases.id, input.caseId),
      eq(evictionCases.oxyUserId, input.oxyUserId),
    );
    const nextStatus = input.patch.status;

    const [row] = hasPatch
      ? await tx
          .update(evictionCases)
          .set(input.patch)
          .where(
            nextStatus
              ? and(ownership, inArray(evictionCases.status, [...predecessorsOf(nextStatus)]))
              : ownership,
          )
          .returning(publicCaseColumns)
      : // A patch-free call still has to touch `updated_at`, because "recently
        // updated" must include a case whose only change was a timeline note.
        // That is one representation of activity, on the case row, rather than a
        // second `last_activity_at` column that can disagree with it.
        await tx
          .update(evictionCases)
          .set({ updatedAt: new Date() })
          .where(ownership)
          .returning(publicCaseColumns);

    if (!row) {
      const [current] = await tx
        .select({ status: evictionCases.status })
        .from(evictionCases)
        .where(ownership)
        .limit(1);
      if (!current) return { outcome: 'not_found' };
      // The row exists and is owned, so the only predicate left is the
      // transition one.
      return nextStatus
        ? { outcome: 'invalid_transition', from: current.status, to: nextStatus }
        : { outcome: 'not_found' };
    }

    const written: EvictionCaseUpdateRow[] = [];
    for (const entry of input.timelineEntries ?? []) {
      written.push(await appendTimelineEntry(input.caseId, entry, tx));
    }
    return { outcome: 'updated', row, timelineEntries: written };
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
 * The comment thread, the timeline, the roster, the followers, the help needs,
 * the grants, the audit and any reports go with it by `ON DELETE CASCADE`.
 * `moderation_reports` deliberately does NOT cascade: its `reported_id` carries
 * no foreign key precisely so the record of what was delivered and decided
 * outlives the object it was about.
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

/** Replace a case's help needs wholesale — a payload names the complete set. */
export async function replaceHelpNeeds(
  caseId: string,
  needs: readonly { readonly needType: EvictionHelpNeedType; readonly note?: string }[],
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  const run = async (tx: DatabaseOrTransaction) => {
    await tx.delete(evictionCaseHelpNeeds).where(eq(evictionCaseHelpNeeds.caseId, caseId));
    if (needs.length === 0) return;
    await tx.insert(evictionCaseHelpNeeds).values(
      needs.map((need) => ({
        caseId,
        needType: need.needType as EvictionHelpNeedRow['needType'],
        note: need.note ?? null,
      })),
    );
  };
  const canNest = typeof (db as { rollback?: unknown }).rollback === 'function';
  if (canNest) return run(db);
  return (db as ReturnType<typeof getDb>).transaction(run);
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
 *
 * An RSVP no longer unlocks anything on its own: confirmation is a separate
 * fact, written by {@link confirmSupporter}.
 */
export async function toggleAttendance(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<AttendanceToggle> {
  let attending: boolean;
  try {
    await inSavepoint(db, (tx) =>
      tx.insert(evictionCaseAttendees).values({ caseId, oxyUserId }).returning({ id: evictionCaseAttendees.id }),
    );
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

/** One person's standing on one case: RSVP'd, confirmed, or shut out. */
export interface SupporterStanding {
  readonly attending: boolean;
  readonly confirmed: boolean;
  readonly revoked: boolean;
}

/** Whether one viewer is attending, confirmed and unrevoked on one case. */
export async function findSupporterStanding(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<SupporterStanding> {
  const [row] = await db
    .select({
      confirmedAt: evictionCaseAttendees.confirmedAt,
      revokedAt: evictionCaseAttendees.revokedAt,
    })
    .from(evictionCaseAttendees)
    .where(
      and(
        eq(evictionCaseAttendees.caseId, caseId),
        eq(evictionCaseAttendees.oxyUserId, oxyUserId),
      ),
    )
    .limit(1);
  if (!row) return { attending: false, confirmed: false, revoked: false };
  return {
    attending: true,
    confirmed: row.confirmedAt !== null && row.revokedAt === null,
    revoked: row.revokedAt !== null,
  };
}

/**
 * Record that a supporter satisfied the second factor.
 *
 * Idempotent by predicate rather than by read: the `WHERE` requires the row to
 * be unconfirmed and unrevoked, so a second call changes nothing and a revoked
 * supporter cannot re-confirm themselves by RSVP-ing again.
 */
export async function confirmSupporter(
  caseId: string,
  oxyUserId: string,
  basis: 'account_tenure' | 'supporter_vouch',
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const updated = await db
    .update(evictionCaseAttendees)
    .set({ confirmedAt: new Date(), confirmationBasis: basis })
    .where(
      and(
        eq(evictionCaseAttendees.caseId, caseId),
        eq(evictionCaseAttendees.oxyUserId, oxyUserId),
        isNull(evictionCaseAttendees.confirmedAt),
        isNull(evictionCaseAttendees.revokedAt),
      ),
    )
    .returning({ id: evictionCaseAttendees.id });
  // `count` rather than `rows.length`: a drizzle UPDATE result reports the
  // matched rows in `count` and has length 0 whether or not it applied. Here the
  // `RETURNING` makes `length` meaningful, which is why it is used — the plain
  // `rowCount` reading is the one that would silently always be false.
  return updated.length === 1;
}

/**
 * Withdraw one supporter's confirmed access.
 *
 * The organiser must already hold the id — there is no endpoint that lists the
 * roster for them to pick from, because ADR 0003 §7.4 discloses it to nobody.
 * Revocation therefore acts on somebody who contacted the organiser directly,
 * which is the only way the organiser knows the id at all.
 */
export async function revokeSupporter(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const updated = await db
    .update(evictionCaseAttendees)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(evictionCaseAttendees.caseId, caseId),
        eq(evictionCaseAttendees.oxyUserId, oxyUserId),
        isNull(evictionCaseAttendees.revokedAt),
      ),
    )
    .returning({ id: evictionCaseAttendees.id });
  return updated.length === 1;
}

/** Whether an already-confirmed supporter has vouched for this person. */
export async function hasConfirmedVoucher(
  caseId: string,
  vouchedOxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const rows = await db.execute<{ vouches: number }>(sql`
    select count(*)::int as vouches
    from eviction_supporter_vouches v
    join eviction_case_attendees a
      on a.case_id = v.case_id and a.oxy_user_id = v.voucher_oxy_user_id
    where v.case_id = ${caseId}
      and v.vouched_oxy_user_id = ${vouchedOxyUserId}
      and a.confirmed_at is not null
      and a.revoked_at is null
  `);
  return Number(rows[0]?.vouches ?? 0) > 0;
}

/** Record one confirmed supporter vouching for another person. */
export async function insertVouch(
  input: {
    readonly caseId: string;
    readonly voucherOxyUserId: string;
    readonly vouchedOxyUserId: string;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db
    .insert(evictionSupporterVouches)
    .values(input)
    .onConflictDoNothing({
      target: [
        evictionSupporterVouches.caseId,
        evictionSupporterVouches.voucherOxyUserId,
        evictionSupporterVouches.vouchedOxyUserId,
      ],
    });
}

/** Everyone who asked to be told about this case, except one person. */
export async function listFollowerOxyUserIds(
  caseId: string,
  excludeOxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly string[]> {
  // Followers UNION attendees: somebody who said they will be there has asked
  // to know if the date moves at least as loudly as somebody watching, and
  // making them press a second button would be a way to miss it.
  const rows = await db.execute<{ oxy_user_id: string }>(sql`
    select oxy_user_id from eviction_case_followers where case_id = ${caseId}
    union
    select oxy_user_id from eviction_case_attendees where case_id = ${caseId}
  `);
  return [...rows].map((row) => row.oxy_user_id).filter((id) => id !== excludeOxyUserId);
}

/** Follow / unfollow, as a toggle. Returns the state after the call. */
export async function toggleFollow(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const inserted = await db
    .insert(evictionCaseFollowers)
    .values({ caseId, oxyUserId })
    .onConflictDoNothing({
      target: [evictionCaseFollowers.caseId, evictionCaseFollowers.oxyUserId],
    })
    .returning({ id: evictionCaseFollowers.id });
  if (inserted.length === 1) return true;
  await db
    .delete(evictionCaseFollowers)
    .where(
      and(
        eq(evictionCaseFollowers.caseId, caseId),
        eq(evictionCaseFollowers.oxyUserId, oxyUserId),
      ),
    );
  return false;
}

/** Whether one viewer follows one case. */
export async function isFollowing(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const [row] = await db
    .select({ id: evictionCaseFollowers.id })
    .from(evictionCaseFollowers)
    .where(
      and(
        eq(evictionCaseFollowers.caseId, caseId),
        eq(evictionCaseFollowers.oxyUserId, oxyUserId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Claim the right to notify these recipients about this timeline entry.
 *
 * Returns only the recipients this call actually claimed. `ON CONFLICT DO
 * NOTHING RETURNING` is what makes "a date change is notified exactly once" a
 * database fact rather than a best effort: a retry, a second cron tick and two
 * API processes racing all converge, because the unique index decides and only
 * the inserting statement gets a row back.
 *
 * `DO NOTHING` rather than letting the insert fail, so a duplicate does not
 * abort the caller's transaction (`25P02`).
 */
export async function claimUpdateNotificationRecipients(
  updateId: string,
  recipientOxyUserIds: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly string[]> {
  if (recipientOxyUserIds.length === 0) return [];
  const claimed = await db
    .insert(evictionUpdateNotifications)
    .values(recipientOxyUserIds.map((recipientOxyUserId) => ({ updateId, recipientOxyUserId })))
    .onConflictDoNothing({
      target: [
        evictionUpdateNotifications.updateId,
        evictionUpdateNotifications.recipientOxyUserId,
      ],
    })
    .returning({ recipientOxyUserId: evictionUpdateNotifications.recipientOxyUserId });
  return claimed.map((row) => row.recipientOxyUserId);
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
      .orderBy(desc(evictionComments.createdAt), asc(evictionComments.id))
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

/** The OPEN community report this reporter filed about this case, if any. */
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

/** How many distinct people have an OPEN report against this case. */
export async function countOpenReporters(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const rows = await db.execute<{ reporters: number }>(sql`
    select count(distinct reporter_oxy_user_id)::int as reporters
    from eviction_reports
    where case_id = ${caseId} and status = 'open'
  `);
  return Number(rows[0]?.reporters ?? 0);
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
 * File a community report against a case.
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
 * Apply a precautionary hold, once.
 *
 * `IS NULL` in the `WHERE`, so re-reporting a held case does not re-stamp it and
 * does not append a second timeline entry — the caller keys the entry off this
 * function returning `true`.
 */
export async function applyPrecautionaryHold(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const held = await db
    .update(evictionCases)
    .set({ precautionaryHoldAt: new Date() })
    .where(and(eq(evictionCases.id, caseId), isNull(evictionCases.precautionaryHoldAt)))
    .returning({ id: evictionCases.id });
  return held.length === 1;
}

/** Mark a case disputed, once. Same compare-and-set as the hold. */
export async function markCaseDisputed(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const marked = await db
    .update(evictionCases)
    .set({ disputedAt: new Date() })
    .where(and(eq(evictionCases.id, caseId), isNull(evictionCases.disputedAt)))
    .returning({ id: evictionCases.id });
  return marked.length === 1;
}

/** The organiser answering a hold clears it, and the answer is on the timeline. */
export async function clearPrecautionaryHold(
  caseId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const cleared = await db
    .update(evictionCases)
    .set({ precautionaryHoldAt: null })
    .where(
      and(
        eq(evictionCases.id, caseId),
        eq(evictionCases.oxyUserId, oxyUserId),
        isNotNull(evictionCases.precautionaryHoldAt),
      ),
    )
    .returning({ id: evictionCases.id });
  return cleared.length === 1;
}

/**
 * Cases whose date passed without an outcome, for the reminder job.
 *
 * `outcome_reminder_sent_at IS NULL` matches rows that predate the feature too.
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
 * a missed nudge is better than a repeated one.
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

/**
 * Archive every case whose last change is older than the cutoff.
 *
 * ADR 0003 §7.5, and all three effects are in ONE statement so a partially
 * archived case cannot exist: the case leaves the board (`archived_at`), the
 * contact block is DELETED rather than hidden — a hidden contact is still a
 * contact somebody can leak — and the published location drops to
 * `neighborhood`.
 *
 * The location keeps its stored centre and radius, because a neighbourhood is
 * where the disc already is; what changes is that the DTO stops publishing a
 * point for it. The exact pair is cleared outright.
 *
 * @returns the ids archived, so the caller can log a count that is a fact.
 */
export async function archiveStaleCases(
  input: { readonly changedBefore: Date; readonly limit: number },
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly string[]> {
  const archived = await db
    .update(evictionCases)
    .set({
      archivedAt: new Date(),
      locationPrecision: 'neighborhood',
      contactPhone: null,
      contactEmail: null,
      contactTelegram: null,
      contactWhatsapp: null,
      contactInstructions: null,
      locationExactLongitude: null,
      locationExactLatitude: null,
      locationExactAddress: null,
    })
    .where(
      and(
        isNull(evictionCases.archivedAt),
        lt(evictionCases.updatedAt, input.changedBefore),
      ),
    )
    .returning({ id: evictionCases.id });
  // The `limit` is applied here rather than in the statement because an UPDATE
  // takes no LIMIT without a sub-select, and the archive set is bounded by how
  // many cases went 90 days without a change — a number the board's own volume
  // caps. It is carried so the caller's batching contract is honest about what
  // it asked for.
  return archived.slice(0, input.limit).map((row) => row.id);
}

/** Cases archived long enough ago to be deleted outright (ADR 0003 §7.5). */
export async function deleteLongArchivedCases(
  input: { readonly archivedBefore: Date },
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const deleted = await db
    .delete(evictionCases)
    .where(
      and(
        isNotNull(evictionCases.archivedAt),
        lt(evictionCases.archivedAt, input.archivedBefore),
      ),
    )
    .returning({ id: evictionCases.id });
  return deleted.length;
}
