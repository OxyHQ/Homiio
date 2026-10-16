import type { RouteCoverage } from './types';

export const ADDRESS_ROUTE_COVERAGE: RouteCoverage = {
  'GET /api/addresses/search': 'searchAddresses',
  'GET /api/addresses/nearby': 'findNearbyAddresses',
  'GET /api/addresses/:id/corrections': 'listAddressCorrections',
  'POST /api/addresses/:id/corrections': 'proposeAddressCorrection',
  'DELETE /api/addresses/:id/corrections/:proposalId': 'withdrawAddressCorrection',
  'GET /api/addresses/:id': 'getAddress',
  'POST /api/addresses': 'createAddress',
  'PUT /api/addresses/:id': 'updateAddress',
};
