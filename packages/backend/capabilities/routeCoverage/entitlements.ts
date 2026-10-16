import type { RouteCoverage } from './types';

export const ENTITLEMENT_ROUTE_COVERAGE: RouteCoverage = {
  'GET /api/profiles/me/entitlements': 'readFileEntitlement',
  'POST /api/profiles/me/entitlements/consume-file-credit': 'consumeFileCredit',
};
