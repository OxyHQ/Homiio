/**
 * Review Routes
 * API endpoints for address reviews
 */

import { Router } from 'express';
import {
  createReview,
  getReviewById,
  updateReview,
  deleteReview,
  getUserReviews
} from '../controllers/reviewController';

const router = Router();

// NOTE: the address review READ routes (`GET /address/:addressId` and
// `/address/:addressId/stats`) are served publicly from `routes/public.ts`
// (community-visible reads, no auth). They are intentionally NOT declared here
// so this authenticated router only owns mutations + owner-scoped reads.

// Review CRUD operations
router.post('/', createReview);
router.get('/:reviewId', getReviewById);
router.put('/:reviewId', updateReview);
router.delete('/:reviewId', deleteReview);

// Profile-specific reviews
router.get('/user/:oxyUserId', getUserReviews);

export default function() {
  return router;
};
