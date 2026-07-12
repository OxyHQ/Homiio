/**
 * Admin routes (authenticated + admin-gated).
 *
 * Mounted at /api/admin behind the global `oxy.auth()` in server.ts, so
 * `req.user` is resolved here. `requireAdmin` additionally restricts every route
 * to the configured platform-admin allowlist (`config.admin.oxyUserIds`), which
 * fails closed on an empty allowlist. Same mounting pattern as `routes/scraper.ts`.
 */

import express from 'express';
import { asyncHandler } from '../middlewares';
import { requireAdmin } from '../middlewares/requireAdmin';
import {
  getModerationReviews,
  moderateReview,
  getModerationEvictions,
  moderateEviction,
} from '../controllers/admin/moderationController';

export default function () {
  const router = express.Router();

  // Admin gate for every route under /api/admin.
  router.use(requireAdmin);

  // Trust & safety moderation queue.
  router.get('/moderation/reviews', asyncHandler(getModerationReviews));
  router.post('/moderation/reviews/:reviewId', asyncHandler(moderateReview));
  router.get('/moderation/evictions', asyncHandler(getModerationEvictions));
  router.post('/moderation/evictions/:caseId', asyncHandler(moderateEviction));

  return router;
}
