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
 * A signed-in viewer's `isAttending` is resolved with a single `$elemMatch`
 * roster query (attendees are `select: false`, never returned inline).
 */

import { getOxyUserId } from '@oxyhq/core/server';
import { EvictionCaseStatus } from '@homiio/shared-types';
import { EvictionCase } from '../../models';
import { toEvictionDTO } from './toEvictionDTO';
import { escapeRegExp, parsePagination, VALID_EVICTION_STATUSES } from './shared';
import { successResponse, AppError } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

/** Resolve which of `ids` the viewer is attending (one roster query). */
async function attendingSetFor(ids: unknown[], viewerOxyUserId: string | null): Promise<Set<string>> {
  if (!viewerOxyUserId || ids.length === 0) return new Set();
  const attended = await EvictionCase.find({
    _id: { $in: ids },
    attendees: { $elemMatch: { oxyUserId: viewerOxyUserId } },
  })
    .select('_id')
    .lean();
  return new Set(attended.map((row) => String(row._id)));
}

function parseBbox(query: Record<string, unknown>): [[number, number], [number, number]] | undefined {
  const swLat = Number(query.swLat);
  const swLng = Number(query.swLng);
  const neLat = Number(query.neLat);
  const neLng = Number(query.neLng);
  const all = [swLat, swLng, neLat, neLng];
  if (!all.every((value) => Number.isFinite(value))) return undefined;
  // GeoJSON $box corners are [lng, lat] pairs: [ [swLng, swLat], [neLng, neLat] ].
  return [
    [swLng, swLat],
    [neLng, neLat],
  ];
}

export async function listEvictions(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const { page, limit, skip } = parsePagination(query);

    const status = typeof query.status === 'string' && query.status ? query.status : EvictionCaseStatus.UPCOMING;
    if (!VALID_EVICTION_STATUSES.has(status)) {
      return next(new AppError('Invalid status filter', 400, 'INVALID_STATUS'));
    }

    const filter: Record<string, unknown> = { status };
    if (typeof query.city === 'string' && query.city.trim()) {
      filter['location.city'] = new RegExp(`^${escapeRegExp(query.city.trim())}$`, 'i');
    }
    const bbox = parseBbox(query);
    if (bbox) {
      filter['location.coordinates'] = { $geoWithin: { $box: bbox } };
    }

    // Soonest-first for the actionable "upcoming" board; most-recent-first otherwise.
    const sort: Record<string, 1 | -1> =
      status === EvictionCaseStatus.UPCOMING ? { scheduledAt: 1 } : { scheduledAt: -1 };

    const [total, evictions] = await Promise.all([
      EvictionCase.countDocuments(filter),
      EvictionCase.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    ]);

    const viewer = getOxyUserId(req);
    const attendingSet = await attendingSetFor(
      evictions.map((row) => row._id),
      viewer,
    );

    const data = evictions.map((row) =>
      toEvictionDTO(row, {
        viewerOxyUserId: viewer,
        isAttending: viewer ? attendingSet.has(String(row._id)) : undefined,
      }),
    );

    const totalPages = Math.ceil(total / limit);
    res.json(
      successResponse(
        {
          evictions: data,
          pagination: { page, limit, total, totalPages },
          hasMore: skip + evictions.length < total,
          totalPages,
          total,
          page,
        },
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
    const evictionCase = await EvictionCase.findById(id).lean();
    if (!evictionCase) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const viewer = getOxyUserId(req);
    let isAttending: boolean | undefined;
    if (viewer) {
      const attending = await EvictionCase.countDocuments({
        _id: id,
        attendees: { $elemMatch: { oxyUserId: viewer } },
      });
      isAttending = attending > 0;
    }

    res.json(
      successResponse(toEvictionDTO(evictionCase, { viewerOxyUserId: viewer, isAttending }), 'Eviction case'),
    );
  } catch (error) {
    next(error);
  }
}

export async function listMyEvictions(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { oxyUserId };
    const [total, evictions] = await Promise.all([
      EvictionCase.countDocuments(filter),
      EvictionCase.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const attendingSet = await attendingSetFor(
      evictions.map((row) => row._id),
      oxyUserId,
    );

    const data = evictions.map((row) =>
      toEvictionDTO(row, { viewerOxyUserId: oxyUserId, isAttending: attendingSet.has(String(row._id)) }),
    );

    const totalPages = Math.ceil(total / limit);
    res.json(
      successResponse(
        {
          evictions: data,
          pagination: { page, limit, total, totalPages },
          hasMore: skip + evictions.length < total,
          totalPages,
          total,
          page,
        },
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
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { attendees: { $elemMatch: { oxyUserId } } };
    const [total, evictions] = await Promise.all([
      EvictionCase.countDocuments(filter),
      EvictionCase.find(filter).sort({ scheduledAt: 1 }).skip(skip).limit(limit).lean(),
    ]);

    // Every row here is one the caller RSVP'd to, by construction.
    const data = evictions.map((row) =>
      toEvictionDTO(row, { viewerOxyUserId: oxyUserId, isAttending: true }),
    );

    const totalPages = Math.ceil(total / limit);
    res.json(
      successResponse(
        {
          evictions: data,
          pagination: { page, limit, total, totalPages },
          hasMore: skip + evictions.length < total,
          totalPages,
          total,
          page,
        },
        'Attending eviction cases',
      ),
    );
  } catch (error) {
    next(error);
  }
}
