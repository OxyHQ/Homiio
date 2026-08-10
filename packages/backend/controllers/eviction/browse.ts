/**
 * Eviction board reads.
 *
 *   - listEvictions          — PUBLIC board. REQUIRES a scope (see below).
 *   - getEvictionById        — PUBLIC detail (timeline inline).
 *   - listMyEvictions        — authed: the caller's own cases.
 *   - listAttendingEvictions — authed: cases the caller RSVP'd to.
 *   - listFollowedEvictions  — authed: cases the caller follows.
 *
 * ## The board REFUSES a request that names no place
 *
 * `GET /api/evictions` with no scope is a 400, not the world. ADR 0002's second
 * invariant is that location is never implicit, and #358 states the consequence
 * for this surface directly: *"un fallo geográfico no debe mostrar todos los
 * casos"*. A board that silently widens to everywhere when a geocode fails looks
 * like it worked — the user sees results, they are simply the wrong ones — which
 * is the failure mode this refusal exists to make impossible.
 *
 * `?global=true` keeps the world reachable, BY NAME. That distinction is the
 * whole design: the difference between "show me everything" and "I could not
 * work out where you are" has to survive into the response, and only an explicit
 * member can carry it.
 *
 * A scope parameter that is PRESENT and malformed is also a 400 rather than an
 * ignored filter, for the same reason: dropping a filter you could not parse is
 * how a bbox for one neighbourhood becomes a feed for the planet.
 *
 * ## List, map and total are ONE query
 *
 * `boardResponse` renders the page the repository returned and the total the
 * repository counted, and `listEvictionCases` derives both from a single `where`.
 * The frontend map draws exactly the `evictions` array it is handed. There is no
 * second, wider query for pins — which is the ordinary way a map and a list stop
 * agreeing, and on this board a pin the list does not explain is a place nobody
 * can account for.
 *
 * ## A case is several reads now, which is why a page is hydrated in ONE batch
 *
 * The timeline, the roster, the help needs and the organisation are all their own
 * tables, so every response needs five facts per case — and the naive spelling of
 * that is four extra queries PER ROW. `listTimelineForCases`,
 * `countAttendeesForCases`, `listHelpNeedsForCases` and `listOrganizationsByIds`
 * answer them for the whole page at once, and {@link boardResponse} is where they
 * are called so no handler can reintroduce the per-row shape.
 *
 * The board never passes `contact`, so the organiser's contact cannot reach a
 * feed response for any viewer, owner included — the unlock lives on the detail
 * endpoint alone.
 */

import { getOxyUserId } from '@oxyhq/core/server';
import {
  countAttendeesForCases,
  countEvictionAttendees,
  findAttendedCaseIds,
  findEvictionCase,
  findFollowedCaseIds,
  findSupporterStanding,
  isFollowing,
  listEvictionCases,
  listEvictionTimeline,
  listHelpNeedsForCases,
  listOrganizationsByIds,
  listTimelineForCases,
  readCaseContact,
  type EvictionBoardFilter,
  type EvictionBoardPage,
  type EvictionBoardSort,
  type EvictionScope,
} from '../../db/evictions/evictionRepository';
import { toEvictionDTO } from './toEvictionDTO';
import {
  parseDate,
  parseEvictionStatus,
  parseHelpNeedType,
  parsePagination,
  type Pagination,
} from './shared';
import { successResponse, AppError } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

/**
 * How far past its date an `upcoming` notice may be and still show on the public
 * board.
 */
const STALE_UPCOMING_MS = 24 * 60 * 60 * 1000;

/** The widest radius a `?lat/?lng/?radius` scope may ask for, in metres. */
const MAX_SCOPE_RADIUS_METERS = 100_000;
const DEFAULT_SCOPE_RADIUS_METERS = 5_000;

const SORTS: readonly EvictionBoardSort[] = [
  'soonest',
  'distance',
  'recently_updated',
  'newest',
];

/** A finite number from a query param, or undefined when absent/unparseable. */
function numberParam(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isTrue(value: unknown): boolean {
  return value === 'true' || value === true;
}

/**
 * Read the scope out of a query string, or say why it could not.
 *
 * Returns a discriminated result rather than throwing so the caller answers with
 * a code the client can act on: `LOCATION_SCOPE_REQUIRED` and
 * `INVALID_LOCATION_SCOPE` are different problems, and a UI that shows the same
 * message for both teaches people to re-tap rather than to pick a place.
 */
type ScopeResult =
  | { readonly ok: true; readonly scope: EvictionScope }
  | { readonly ok: false; readonly code: string; readonly message: string };

function parseScope(
  query: Record<string, unknown>,
  viewerOxyUserId: string | null,
): ScopeResult {
  if (isTrue(query.global)) return { ok: true, scope: { kind: 'global' } };

  if (isTrue(query.following) || isTrue(query.attending)) {
    if (!viewerOxyUserId) {
      return {
        ok: false,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Following and attending scopes need a signed-in viewer.',
      };
    }
    return {
      ok: true,
      scope: isTrue(query.following)
        ? { kind: 'following', oxyUserId: viewerOxyUserId }
        : { kind: 'attending', oxyUserId: viewerOxyUserId },
    };
  }

  const city = typeof query.city === 'string' ? query.city.trim() : '';
  if (city) return { ok: true, scope: { kind: 'city', city } };

  const swLat = numberParam(query.swLat);
  const swLng = numberParam(query.swLng);
  const neLat = numberParam(query.neLat);
  const neLng = numberParam(query.neLng);
  const bboxNamed = [query.swLat, query.swLng, query.neLat, query.neLng].some(
    (value) => value !== undefined && value !== '',
  );
  if (bboxNamed) {
    if ([swLat, swLng, neLat, neLng].some((value) => value === undefined)) {
      return {
        ok: false,
        code: 'INVALID_LOCATION_SCOPE',
        message: 'A bounding box needs all four of swLat, swLng, neLat and neLng.',
      };
    }
    // Non-null after the guard above; named locals keep the narrowing readable.
    const box = { swLat: swLat ?? 0, swLng: swLng ?? 0, neLat: neLat ?? 0, neLng: neLng ?? 0 };
    if (box.swLat > box.neLat) {
      return {
        ok: false,
        code: 'INVALID_LOCATION_SCOPE',
        message: 'The bounding box south-west corner is north of its north-east corner.',
      };
    }
    return { ok: true, scope: { kind: 'bbox', ...box } };
  }

  const lat = numberParam(query.lat);
  const lng = numberParam(query.lng);
  const centreNamed = [query.lat, query.lng].some((value) => value !== undefined && value !== '');
  if (centreNamed) {
    if (lat === undefined || lng === undefined) {
      return {
        ok: false,
        code: 'INVALID_LOCATION_SCOPE',
        message: 'A radius scope needs both lat and lng.',
      };
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return {
        ok: false,
        code: 'INVALID_LOCATION_SCOPE',
        message: 'lat must be within ±90 and lng within ±180.',
      };
    }
    const requested = numberParam(query.radius);
    const radiusMeters = Math.min(
      requested !== undefined && requested > 0 ? requested : DEFAULT_SCOPE_RADIUS_METERS,
      MAX_SCOPE_RADIUS_METERS,
    );
    return { ok: true, scope: { kind: 'radius', lat, lng, radiusMeters } };
  }

  return {
    ok: false,
    code: 'LOCATION_SCOPE_REQUIRED',
    message:
      'The eviction board is local. Send a city, a bounding box, a centre and radius, ' +
      'following=true, attending=true, or global=true to browse everywhere on purpose.',
  };
}

/**
 * One page of cases as the response body every board endpoint returns.
 *
 * `pagination` is duplicated at the top level as well as nested, exactly as it
 * was: a shipped client reads both.
 */
async function boardResponse(
  board: EvictionBoardPage,
  { page, limit, skip }: Pagination,
  viewerOxyUserId: string | null,
  viewerFlags: {
    readonly resolveIsAttending: (caseId: string) => boolean | undefined;
    readonly resolveIsFollowing: (caseId: string) => boolean | undefined;
  },
  scope: EvictionScope,
) {
  const caseIds = board.cases.map((row) => row.id);
  const organizationIds = board.cases
    .map((row) => row.organizationId)
    .filter((id): id is string => id !== null);

  const [timelineByCase, attendeeCounts, helpNeedsByCase, organizations] = await Promise.all([
    listTimelineForCases(caseIds),
    countAttendeesForCases(caseIds),
    listHelpNeedsForCases(caseIds),
    listOrganizationsByIds(organizationIds),
  ]);

  const evictions = board.cases.map((row) =>
    toEvictionDTO(
      {
        evictionCase: row,
        // A case with no timeline and a case nobody has RSVP'd to are both
        // absent from their maps, which is what the defaults mean here.
        timeline: timelineByCase.get(row.id) ?? [],
        attendeeCount: attendeeCounts.get(row.id) ?? 0,
        helpNeeds: helpNeedsByCase.get(row.id) ?? [],
        organization: row.organizationId
          ? organizations.get(row.organizationId)
          : undefined,
        distanceMeters: row.distanceMeters ?? undefined,
      },
      {
        viewerOxyUserId,
        isAttending: viewerFlags.resolveIsAttending(row.id),
        isFollowing: viewerFlags.resolveIsFollowing(row.id),
      },
    ),
  );

  const totalPages = Math.ceil(board.total / limit);
  return {
    evictions,
    // Echoed back so a client can tell what the server actually scoped by rather
    // than what it believes it asked for. ADR 0002 §7: every surface answering
    // "where?" states the area it queried.
    scope,
    pagination: { page, limit, total: board.total, totalPages },
    hasMore: skip + board.cases.length < board.total,
    totalPages,
    total: board.total,
    page,
  };
}

/** The filters shared by every board endpoint, read once. */
function parseFilters(
  query: Record<string, unknown>,
): { ok: true; filters: Omit<EvictionBoardFilter, 'scope'> } | { ok: false; message: string } {
  const requested = typeof query.status === 'string' && query.status ? query.status : undefined;
  const status = requested === undefined ? undefined : parseEvictionStatus(requested);
  if (requested !== undefined && !status) {
    return { ok: false, message: 'Invalid status filter' };
  }

  const scheduledFrom = query.scheduledFrom === undefined ? undefined : parseDate(query.scheduledFrom);
  if (query.scheduledFrom !== undefined && !scheduledFrom) {
    return { ok: false, message: 'Invalid scheduledFrom' };
  }
  const scheduledTo = query.scheduledTo === undefined ? undefined : parseDate(query.scheduledTo);
  if (query.scheduledTo !== undefined && !scheduledTo) {
    return { ok: false, message: 'Invalid scheduledTo' };
  }

  const helpNeedRaw = typeof query.helpNeed === 'string' ? query.helpNeed : undefined;
  const helpNeed = helpNeedRaw === undefined ? undefined : parseHelpNeedType(helpNeedRaw);
  if (helpNeedRaw !== undefined && !helpNeed) {
    return { ok: false, message: 'Invalid helpNeed filter' };
  }

  const updatedWithinDays = numberParam(query.updatedWithinDays);
  const updatedSince =
    updatedWithinDays !== undefined && updatedWithinDays > 0
      ? new Date(Date.now() - updatedWithinDays * 24 * 60 * 60 * 1000)
      : undefined;

  return {
    ok: true,
    filters: {
      status,
      scheduledFrom,
      scheduledTo,
      organizationId:
        typeof query.organizationId === 'string' && query.organizationId
          ? query.organizationId
          : undefined,
      helpNeed,
      updatedSince,
      // The public "upcoming" board hides cases whose date is >24h past —
      // stale, unmaintained notices whose real outcome was never reported. They
      // stay reachable by direct link and in the owner's own list, and the owner
      // gets an outcome-reminder nudge.
      scheduledAfter:
        status === 'upcoming' ? new Date(Date.now() - STALE_UPCOMING_MS) : undefined,
    },
  };
}

function parseSort(query: Record<string, unknown>): EvictionBoardSort | undefined {
  if (typeof query.sort !== 'string' || !query.sort) return 'soonest';
  return SORTS.find((sort) => sort === query.sort);
}

export async function listEvictions(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const pagination = parsePagination(query);
    const viewer = getOxyUserId(req);

    const scoped = parseScope(query, viewer);
    if (!scoped.ok) {
      return next(
        new AppError(
          scoped.message,
          scoped.code === 'AUTHENTICATION_REQUIRED' ? 401 : 400,
          scoped.code,
        ),
      );
    }

    const filters = parseFilters(query);
    if (!filters.ok) return next(new AppError(filters.message, 400, 'INVALID_FILTER'));

    const sort = parseSort(query);
    if (!sort) return next(new AppError('Invalid sort', 400, 'INVALID_SORT'));
    // Distance without a centre is not a weaker ordering, it is no ordering at
    // all — so it is refused rather than silently answered with another one.
    if (sort === 'distance' && scoped.scope.kind !== 'radius' && scoped.scope.kind !== 'bbox') {
      return next(
        new AppError(
          'sort=distance needs a scope with a centre (lat/lng/radius, or a bounding box).',
          400,
          'INVALID_SORT',
        ),
      );
    }

    const board = await listEvictionCases(
      { scope: scoped.scope, ...filters.filters },
      { limit: pagination.limit, skip: pagination.skip, sort },
    );

    const caseIds = board.cases.map((row) => row.id);
    const [attended, followed] = viewer
      ? await Promise.all([
          findAttendedCaseIds(caseIds, viewer),
          findFollowedCaseIds(caseIds, viewer),
        ])
      : [undefined, undefined];

    res.json(
      successResponse(
        await boardResponse(
          board,
          pagination,
          viewer,
          {
            // `undefined` for an anonymous viewer, which leaves the flags off the
            // response entirely rather than reporting a false "no".
            resolveIsAttending: (caseId) => attended?.has(caseId),
            resolveIsFollowing: (caseId) => followed?.has(caseId),
          },
          scoped.scope,
        ),
        'Eviction cases',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function getEvictionById(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id } = req.params;
    const evictionCase = await findEvictionCase(id);
    if (!evictionCase) {
      return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    }

    const viewer = getOxyUserId(req);
    const [timeline, attendeeCount, helpNeedsByCase, organizations, standing, following, contact] =
      await Promise.all([
        listEvictionTimeline(id),
        countEvictionAttendees(id),
        listHelpNeedsForCases([id]),
        evictionCase.organizationId
          ? listOrganizationsByIds([evictionCase.organizationId])
          : Promise.resolve(undefined),
        viewer ? findSupporterStanding(id, viewer) : Promise.resolve(undefined),
        viewer ? isFollowing(id, viewer) : Promise.resolve(undefined),
        // The one place the five protected contact columns are read on a read
        // path. `toEvictionDTO` still decides whether they are emitted; this
        // only makes them available to that decision.
        readCaseContact(id),
      ]);

    res.json(
      successResponse(
        toEvictionDTO(
          {
            evictionCase,
            timeline,
            attendeeCount,
            helpNeeds: helpNeedsByCase.get(id) ?? [],
            organization: evictionCase.organizationId
              ? organizations?.get(evictionCase.organizationId)
              : undefined,
          },
          {
            viewerOxyUserId: viewer,
            isAttending: standing?.attending,
            isConfirmedSupporter: standing?.confirmed,
            isRevokedSupporter: standing?.revoked,
            isFollowing: following,
            contact,
          },
        ),
        'Eviction case',
      ),
    );
  } catch (error) {
    next(error);
  }
}

/** The caller's own cases. The scope IS the caller, so no `?global` is needed. */
export async function listMyEvictions(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const pagination = parsePagination(req.query);
    const scope: EvictionScope = { kind: 'owned', oxyUserId };

    const board = await listEvictionCases(
      // An owner sees their archived cases too: the archive removes a case from
      // the PUBLIC board, and hiding it from the person who wrote it as well
      // would make the 90-day sweep look like a deletion.
      { scope, includeArchived: true },
      { limit: pagination.limit, skip: pagination.skip, sort: 'newest' },
    );

    const caseIds = board.cases.map((row) => row.id);
    const [attended, followed] = await Promise.all([
      findAttendedCaseIds(caseIds, oxyUserId),
      findFollowedCaseIds(caseIds, oxyUserId),
    ]);

    res.json(
      successResponse(
        await boardResponse(
          board,
          pagination,
          oxyUserId,
          {
            resolveIsAttending: (caseId) => attended.has(caseId),
            resolveIsFollowing: (caseId) => followed.has(caseId),
          },
          scope,
        ),
        'My eviction cases',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function listAttendingEvictions(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const pagination = parsePagination(req.query);
    const scope: EvictionScope = { kind: 'attending', oxyUserId };

    const board = await listEvictionCases(
      { scope },
      { limit: pagination.limit, skip: pagination.skip, sort: 'soonest' },
    );

    const followed = await findFollowedCaseIds(
      board.cases.map((row) => row.id),
      oxyUserId,
    );

    res.json(
      successResponse(
        await boardResponse(
          board,
          pagination,
          oxyUserId,
          {
            // Every row here is one the caller RSVP'd to, by construction — the
            // filter IS the answer, so re-asking the roster would be a second
            // query for a fact the `exists (...)` predicate already established.
            resolveIsAttending: () => true,
            resolveIsFollowing: (caseId) => followed.has(caseId),
          },
          scope,
        ),
        'Attending eviction cases',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function listFollowedEvictions(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const pagination = parsePagination(req.query);
    const scope: EvictionScope = { kind: 'following', oxyUserId };

    const board = await listEvictionCases(
      { scope },
      { limit: pagination.limit, skip: pagination.skip, sort: 'soonest' },
    );

    const attended = await findAttendedCaseIds(
      board.cases.map((row) => row.id),
      oxyUserId,
    );

    res.json(
      successResponse(
        await boardResponse(
          board,
          pagination,
          oxyUserId,
          {
            resolveIsAttending: (caseId) => attended.has(caseId),
            resolveIsFollowing: () => true,
          },
          scope,
        ),
        'Followed eviction cases',
      ),
    );
  } catch (error) {
    next(error);
  }
}
