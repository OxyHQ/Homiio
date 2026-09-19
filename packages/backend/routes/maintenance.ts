/**
 * `/api/maintenance` — repair requests (#518 §7.1, #519 §7.1).
 *
 * Mounted on `routes/index.ts`, which is the authenticated router: every
 * handler here needs a session, and `AGENTS.md` is explicit that the ROUTER is
 * what decides that rather than a per-handler check. There is deliberately no
 * public read — a repair request names a household's problems in a building
 * somebody can find.
 *
 * Static segments are declared before the `/:id` matcher so `comments` and
 * `status` are never swallowed by it — the same ordering `routes/leases.ts`
 * uses, for the same reason.
 */

import express from 'express';

import * as maintenanceController from '../controllers/maintenanceController';
import { asyncHandler } from '../middlewares';

export default function () {
  const router = express.Router();

  router.get('/', asyncHandler(maintenanceController.listRequests));
  router.post('/', asyncHandler(maintenanceController.createRequest));

  router.post('/:id/status', asyncHandler(maintenanceController.transitionRequest));
  router.post('/:id/comments', asyncHandler(maintenanceController.commentOnRequest));

  router.get('/:id', asyncHandler(maintenanceController.getRequest));

  return router;
}
