import type { RouteCoverage } from './types';

export const PARTNER_ROUTE_COVERAGE: RouteCoverage = {
  'POST /api/partners/join': 'joinPartnerProgram',
  'GET /api/partners/me': 'getMyPartnerStatus',
  'GET /api/partners/me/referrals': 'listMyReferrals',
  'GET /api/partners/me/earnings': 'getMyPartnerEarnings',
  'GET /api/guest-points': 'getMyGuestPoints',
};
