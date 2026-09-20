/**
 * `/api/guest-points` — a person's own points ledger (#518 §7.5, #519 §7.5).
 *
 * Mounted on `routes/index.ts`, which is the authenticated router. `AGENTS.md`
 * is explicit that the ROUTER decides auth rather than a per-handler check, and
 * this one must never move to `routes/public.ts`: a balance is a record of
 * where somebody has stayed and who they have hosted.
 *
 * ONE route, and no write. Every write belongs to the exchange lifecycle — see
 * `controllers/guestPointsController.ts` for why a write endpoint here would be
 * the first half of a shape #518 §7.5 forbids.
 */

import express from 'express';

import guestPointsController from '../controllers/guestPointsController';
import { asyncHandler } from '../middlewares';

export default function () {
  const router = express.Router();

  // GET /api/guest-points — my balance and the movements behind it
  router.get('/', asyncHandler(guestPointsController.getMyGuestPoints));

  return router;
}
