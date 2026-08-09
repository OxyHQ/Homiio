/**
 * Eviction board reads.
 *
 *   - listEvictions          — PUBLIC board: `?status` (default `upcoming`),
 *                              `?city`, `?bbox` (swLat/swLng/neLat/neLng),
 *                              paginated; upcoming sorts by soonest first,
 *                              other statuses by most recent first.
 *   - getEvictionById        — PUBLIC detail (timeline inline).
 *   - listMyEvictions        — authed: the caller's own cases.
 *   - listAttendingEvictions — authed: cases the caller RSVP'd to.
 *
 * ## A case is three reads now, which is why a page is hydrated in ONE batch
 *
 * The timeline and the RSVP roster used to be fields OF the document, so a board
 * page was a single query. They are their own tables now, so every response
 * needs three facts per case — the row, its timeline, its turnout — and the
 * naive spelling of that is two extra queries PER ROW. `listUpdatesForCases` and
 * `countAttendeesForCases` answer both for the whole page at once, and
 * {@link boardResponse} is where they are called so no handler can reintroduce
 * the per-row shape.
 *
 * `isAttending` is resolved the same way, in one query per page
 * (`findAttendedCaseIds`). It arrives as a FUNCTION rather than a set because
 * `listAttendingEvictions` already knows the answer for every row it returns:
 * its filter is the RSVP itself, so asking the roster again would be a query for
 * a fact the `where` clause has already established.
 *
 * The board never sets `includeContact`, so the organiser's contact cannot reach
 * a feed response for any viewer, owner included — the RSVP-gated unlock lives
 * on the detail endpoint alone.
 */

import { getOxyUserId } from '@oxyhq/core/server';
import {
  countAttendeesForCases,
  countEvictionAttendees,
  findAttendedCaseIds,
  findEvictionCase,
  isAttending,
  listEvictionCases,
  listEvictionUpdates,
  listUpdatesForCases,
  type EvictionBoardFilter,
  type EvictionBoardPage,
} from '../../db/evictions/evictionRepository';
import { toEvictionDTO } from './toEvictionDTO';
import { parseEvictionStatus, parsePagination, type Pagination } from './shared';
import { successResponse, AppError } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

/**
 * How far past its date an `upcoming` notice may be and still show on the public
 * board.
 */
const STALE_UPCOMING_MS = 24 * 60 * 60 * 1000;

/**
 * The `?swLat/?swLng/?neLat/?neLng` corners, as the NAMED filter the repository
 * takes.
 *
 * Mongo's `$geoWithin: { $box: [...] }` wanted a positional pair of positional
 * pairs (`[[swLng, swLat], [neLng, neLat]]`), and `ST_MakeEnvelope` wants its own
 * ordering again. Neither appears here: the four numbers are named the whole way
 * from the query string to `boardWhere`, so there is nowhere left for a
 * transposition to hide — and a transposed bbox does not fail, it quietly
 * returns a different neighbourhood's notices.
 */
function parseBbox(query: Record<string, unknown>): EvictionBoardFilter['bbox'] {
  const swLat = Number(query.swLat);
  const swLng = Number(query.swLng);
  const neLat = Number(query.neLat);
  const neLng = Number(query.neLng);
  if (![swLat, swLng, neLat, neLng].every((value) => Number.isFinite(value))) return undefined;
  return { swLat, swLng, neLat, neLng };
}

/**
 * One page of cases as the response body every board endpoint returns.
 *
 * `pagination` is duplicated at the top level as well as nested, exactly as it
 * was: a shipped client reads both, and the Postgres port is not the place to
 * change a wire shape.
 */
async function boardResponse(
  board: EvictionBoardPage,
  { page, limit, skip }: Pagination,
  viewerOxyUserId: string | null,
  resolveIsAttending: (caseId: string) => boolean | undefined,
) {
  const caseIds = board.cases.map((row) => row.id);
  const [updatesByCase, attendeeCounts] = await Promise.all([
    listUpdatesForCases(caseIds),
    countAttendeesForCases(caseIds),
  ]);

  const evictions = board.cases.map((row) =>
    toEvictionDTO(
      {
        evictionCase: row,
        // A case with no timeline and a case nobody has RSVP'd to are both
        // absent from their maps, which is what the defaults mean here.
        updates: updatesByCase.get(row.id) ?? [],
        attendeeCount: attendeeCounts.get(row.id) ?? 0,
      },
      { viewerOxyUserId, isAttending: resolveIsAttending(row.id) },
    ),
  );

  const totalPages = Math.ceil(board.total / limit);
  return {
    evictions,
    pagination: { page, limit, total: board.total, totalPages },
    hasMore: skip + board.cases.length < board.total,
    totalPages,
    total: board.total,
    page,
  };
}

export async function listEvictions(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const pagination = parsePagination(query);

    // An absent or empty `?status` is the default board, not a bad request; a
    // present one that names no declared status is refused rather than ignored.
    const requested = typeof query.status === 'string' && query.status ? query.status : undefined;
    const status = requested === undefined ? 'upcoming' : parseEvictionStatus(requested);
    if (!status) {
      return next(new AppError('Invalid status filter', 400, 'INVALID_STATUS'));
    }
    const isUpcomingBoard = status === 'upcoming';

    const board = await listEvictionCases(
      {
        status,
        city: typeof query.city === 'string' && query.city.trim() ? query.city.trim() : undefined,
        bbox: parseBbox(query),
        // Hygiene: the public "upcoming" board hides cases whose date is >24h
        // past — stale, unmaintained notices whose real outcome was never
        // reported. They stay reachable by direct link and in the owner's "my
        // cases" list; the owner also gets an outcome-reminder nudge (see
        // evictionOutcomeReminderService).
        scheduledAfter: isUpcomingBoard ? new Date(Date.now() - STALE_UPCOMING_MS) : undefined,
      },
      {
        limit: pagination.limit,
        skip: pagination.skip,
        // Soonest-first for the actionable "upcoming" board; most-recent-first
        // otherwise, where the interesting cases are the ones just resolved.
        order: isUpcomingBoard ? 'soonest_first' : 'most_recent_first',
      },
    );

    const viewer = getOxyUserId(req);
    const attended = viewer
      ? await findAttendedCaseIds(
          board.cases.map((row) => row.id),
          viewer,
        )
      : undefined;

    res.json(
      successResponse(
        // `undefined` for an anonymous viewer, which is what leaves `isAttending`
        // off the response entirely rather than reporting a false "no".
        await boardResponse(board, pagination, viewer, (caseId) => attended?.has(caseId)),
        'Eviction cases',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function getEvictionById(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const evictionCase = await findEvictionCase(id);
    if (!evictionCase) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const viewer = getOxyUserId(req);
    const [updates, attendeeCount, viewerIsAttending] = await Promise.all([
      listEvictionUpdates(id),
      countEvictionAttendees(id),
      viewer ? isAttending(id, viewer) : Promise.resolve(undefined),
    ]);

    res.json(
      successResponse(
        toEvictionDTO(
          { evictionCase, updates, attendeeCount },
          { viewerOxyUserId: viewer, isAttending: viewerIsAttending, includeContact: true },
        ),
        'Eviction case',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function listMyEvictions(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const pagination = parsePagination(req.query);

    const board = await listEvictionCases(
      { oxyUserId },
      { limit: pagination.limit, skip: pagination.skip, order: 'newest_created_first' },
    );

    const attended = await findAttendedCaseIds(
      board.cases.map((row) => row.id),
      oxyUserId,
    );

    res.json(
      successResponse(
        await boardResponse(board, pagination, oxyUserId, (caseId) => attended.has(caseId)),
        'My eviction cases',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function listAttendingEvictions(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const pagination = parsePagination(req.query);

    const board = await listEvictionCases(
      { attendedByOxyUserId: oxyUserId },
      { limit: pagination.limit, skip: pagination.skip, order: 'soonest_first' },
    );

    res.json(
      successResponse(
        // Every row here is one the caller RSVP'd to, by construction — the
        // filter IS the answer, so re-asking the roster would be a second query
        // for a fact the `exists (...)` predicate already established.
        await boardResponse(board, pagination, oxyUserId, () => true),
        'Attending eviction cases',
      ),
    );
  } catch (error) {
    next(error);
  }
}
