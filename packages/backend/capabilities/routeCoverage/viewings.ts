import type { RouteCoverage } from './types';

export const VIEWING_ROUTE_COVERAGE: RouteCoverage = {
  'POST /api/properties/:propertyId/viewings': 'requestViewing',
  'GET /api/properties/:propertyId/viewings': 'listListingViewingRequests',
  'GET /api/properties/:propertyId/viewing-windows': 'getViewingWindows',
  'PUT /api/properties/:propertyId/viewing-windows': 'setViewingWindows',
  'GET /api/viewings/me': 'listMyViewingRequests',
  'POST /api/viewings/:viewingId/approve': 'approveViewing',
  'POST /api/viewings/:viewingId/decline': 'declineViewing',
  'POST /api/viewings/:viewingId/cancel': 'cancelViewing',
  'PUT /api/viewings/:viewingId': 'rescheduleViewing',
};
