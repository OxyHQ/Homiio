/**
 * Eviction solidarity board routes (authenticated).
 *
 * Mounted at /api/evictions behind the global `oxy.auth()` in server.ts. The
 * PUBLIC reads (`GET /evictions`, `GET /evictions/:id`,
 * `GET /evictions/:id/comments`) live in `routes/public.ts` — they are
 * intentionally NOT declared here so this router only owns writes + the
 * caller-scoped list reads.
 *
 * The two-segment `me/list` / `me/attending` statics are declared BEFORE the
 * `/:id` params so `me` is never swallowed by the id matcher (same trick as
 * `routes/properties.ts`).
 */

import express from 'express';
import { asyncHandler } from '../middlewares';

export default function () {
  const router = express.Router();
  const eviction = require('../controllers/eviction');

  // Open a case.
  router.post('/', asyncHandler(eviction.createEviction));

  // Caller-scoped lists (static two-segment routes first).
  router.get('/me/list', asyncHandler(eviction.listMyEvictions));
  router.get('/me/attending', asyncHandler(eviction.listAttendingEvictions));

  // Owner-only mutations.
  router.put('/:id', asyncHandler(eviction.updateEviction));
  router.delete('/:id', asyncHandler(eviction.deleteEviction));
  router.post('/:id/updates', asyncHandler(eviction.createUpdate));

  // RSVP toggle (any signed-in user).
  router.post('/:id/attend', asyncHandler(eviction.toggleAttend));

  // Comment thread writes.
  router.post('/:id/comments', asyncHandler(eviction.createComment));
  router.delete('/:id/comments/:commentId', asyncHandler(eviction.deleteComment));

  // Trust & safety.
  router.post('/:id/report', asyncHandler(eviction.createEvictionReport));

  return router;
}
