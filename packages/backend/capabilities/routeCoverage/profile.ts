import type { RouteCoverage } from './types';

export const PROFILE_ROUTE_COVERAGE: RouteCoverage = {
  // `GET /api/profiles` is the same handler as `/me`.
  'GET /api/profiles': 'getMyProfile',
  'GET /api/profiles/me': 'getMyProfile',
  'PUT /api/profiles/me': 'updateMyProfile',
  'GET /api/profiles/oxy/:oxyUserId': 'getUserProfile',
};
