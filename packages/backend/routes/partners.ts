/**
 * Partner Routes
 * The Partner (agent) referral program. All routes require Oxy auth
 * (authentication is applied globally where this router is mounted).
 */

import express from 'express';
import partnerController from '../controllers/partnerController';
import { asyncHandler } from '../middlewares/errorHandler';

const router = express.Router();

// Opt in to the partner program (idempotent) and read the partner dashboard.
router.post('/join', asyncHandler(partnerController.join));
router.get('/me', asyncHandler(partnerController.me));
router.get('/me/referrals', asyncHandler(partnerController.referrals));
router.get('/me/earnings', asyncHandler(partnerController.earnings));

export default function() {
  return router;
};
