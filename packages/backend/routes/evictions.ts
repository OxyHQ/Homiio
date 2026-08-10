/**
 * Eviction solidarity board routes (authenticated).
 *
 * Mounted at /api/evictions behind the global `oxy.auth()` in server.ts. The
 * PUBLIC reads (`GET /evictions`, `GET /evictions/:id`,
 * `GET /evictions/:id/comments`, `GET /evictions/resources`) live in
 * `routes/public.ts` — they are intentionally NOT declared here so this router
 * only owns writes plus the caller-scoped reads.
 *
 * **Which FILE a handler is declared in decides whether it needs a session**
 * (`AGENTS.md`, "Public vs authenticated"), so moving one between the two files
 * changes its auth requirement silently. Two handlers here are the ones that
 * would hurt most if they moved:
 *
 *  - `GET /:id/location/exact` — the only endpoint that returns an exact
 *    eviction coordinate. On the public router it would return one to anybody.
 *  - `GET /:id/location/audit` — who looked at that coordinate.
 *
 * The two-segment `me/*` statics are declared BEFORE the `/:id` params so `me`
 * is never swallowed by the id matcher (same trick as `routes/properties.ts`).
 */

import express from 'express';
import { asyncHandler } from '../middlewares';
import * as eviction from '../controllers/eviction';

export default function () {
  const router = express.Router();

  // Open a case.
  router.post('/', asyncHandler(eviction.createEviction));

  // Caller-scoped lists (static two-segment routes first).
  router.get('/me/list', asyncHandler(eviction.listMyEvictions));
  router.get('/me/attending', asyncHandler(eviction.listAttendingEvictions));
  router.get('/me/following', asyncHandler(eviction.listFollowedEvictions));

  // Owner-only mutations.
  router.put('/:id', asyncHandler(eviction.updateEviction));
  router.delete('/:id', asyncHandler(eviction.deleteEviction));
  router.post('/:id/updates', asyncHandler(eviction.createUpdate));
  router.post('/:id/hold/clear', asyncHandler(eviction.clearHold));

  // RSVP, following and the §7.3.1 second factor (any signed-in user).
  router.post('/:id/attend', asyncHandler(eviction.toggleAttend));
  router.post('/:id/follow', asyncHandler(eviction.toggleFollowEviction));
  router.post('/:id/vouch/:oxyUserId', asyncHandler(eviction.vouchForSupporter));

  // Owner-only supporter management. The id is in the PATH because the roster is
  // never listed to anybody, the organiser included (ADR 0003 §7.4).
  router.post('/:id/supporters/:oxyUserId/revoke', asyncHandler(eviction.revokeAttendee));

  // Exact-location access. Every one of these is owner-only except the read,
  // which needs a live grant, and every one of them writes an audit row.
  router.get('/:id/location/exact', asyncHandler(eviction.getExactLocation));
  router.get('/:id/location/grants', asyncHandler(eviction.listLocationGrants));
  router.post('/:id/location/grants', asyncHandler(eviction.createLocationGrant));
  router.post(
    '/:id/location/grants/:oxyUserId/revoke',
    asyncHandler(eviction.revokeLocationGrant),
  );
  router.get('/:id/location/audit', asyncHandler(eviction.getLocationAccessAudit));

  // Comment thread writes.
  router.post('/:id/comments', asyncHandler(eviction.createComment));
  router.delete('/:id/comments/:commentId', asyncHandler(eviction.deleteComment));

  // Community reports.
  router.post('/:id/report', asyncHandler(eviction.createEvictionReport));

  return router;
}
