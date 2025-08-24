/**
 * Review Routes
 * API endpoints for address reviews
 */

import { Router } from 'express';
import {
  getReviewsByAddress,
  getAddressReviewStats,
  createReview,
  getReviewById,
  updateReview,
  deleteReview,
  getUserReviews
} from '../controllers/reviewController';

const router = Router();

// Address-specific review routes
router.get('/address/:addressId', getReviewsByAddress);
router.get('/address/:addressId/stats', getAddressReviewStats);

// Review CRUD operations
router.post('/', createReview);
router.get('/:reviewId', getReviewById);
router.put('/:reviewId', updateReview);
router.delete('/:reviewId', deleteReview);

// Profile-specific reviews
router.get('/profile/:profileId', getUserReviews);

export default function() {
  return router;
};
