import type { RouteCoverage } from './types';

export const EXCHANGE_ROUTE_COVERAGE: RouteCoverage = {
  'POST /api/exchanges': 'requestExchange',
  'GET /api/exchanges': 'listMyExchangeRequests',
  'GET /api/exchanges/:id': 'getExchangeRequest',
  // One PATCH, four tools, each fixing the status the route reads from its body.
  'PATCH /api/exchanges/:id': [
    'confirmExchange',
    'declineExchange',
    'cancelExchange',
    'completeExchange',
  ],
  'POST /api/exchanges/:id/reviews': 'writeExchangeReview',
  'GET /api/exchanges/:id/reviews': 'listExchangeReviews',
  'GET /api/profiles/oxy/:oxyUserId/exchange-reviews': 'listUserExchangeReviews',
};
