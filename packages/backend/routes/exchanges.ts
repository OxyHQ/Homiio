/**
 * Exchange Routes
 *
 * Mounted at /api/exchanges (authenticated via global oxy.auth() in server.ts).
 * Handles the home-exchange lifecycle (swap / free hosting) and the post-stay
 * reviews tied to each exchange. Mirrors reservations.ts.
 */

import express from 'express';
import { asyncHandler } from '../middlewares';

export default function () {
  const router = express.Router();

  const exchangeController = require('../controllers/exchangeController');
  const exchangeReviewController = require('../controllers/exchangeReviewController');
  const validation = require('../middlewares/validation');

  // POST /api/exchanges — requester proposes a swap or hosting stay
  router.post(
    '/',
    validation.validateExchangeRequest,
    asyncHandler(exchangeController.createExchangeRequest)
  );

  // GET /api/exchanges — list my exchange requests (as guest or ?asHost=true)
  router.get(
    '/',
    asyncHandler(exchangeController.listMyExchangeRequests)
  );

  // GET /api/exchanges/:id — view a single exchange request
  router.get(
    '/:id',
    asyncHandler(exchangeController.getExchangeRequest)
  );

  // PATCH /api/exchanges/:id — host confirms/declines, requester cancels, either completes
  router.patch(
    '/:id',
    validation.validateExchangeUpdate,
    asyncHandler(exchangeController.updateExchangeRequestStatus)
  );

  // POST /api/exchanges/:id/reviews — review the other party after completion
  router.post(
    '/:id/reviews',
    validation.validateExchangeReview,
    asyncHandler(exchangeReviewController.createExchangeReview)
  );

  // GET /api/exchanges/:id/reviews — both reviews for a single exchange
  router.get(
    '/:id/reviews',
    asyncHandler(exchangeReviewController.getExchangeReviews)
  );

  return router;
}
