import type { RouteCoverage } from './types';

export const REVIEW_ROUTE_COVERAGE: RouteCoverage = {
  'POST /api/reviews': 'writeReview',
  'POST /api/reviews/:reviewId/helpful': 'markReviewHelpful',
  'POST /api/reviews/:reviewId/report': 'reportReview',
  'GET /api/reviews/:reviewId': 'getReview',
  'PUT /api/reviews/:reviewId': 'updateReview',
  'DELETE /api/reviews/:reviewId': 'deleteReview',
  'GET /api/reviews/user/:oxyUserId': 'listUserReviews',
};
