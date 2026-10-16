import type { RouteCoverage } from './types';

/** The owner side of a listing, rooms and analytics. */
export const PROPERTY_ROUTE_COVERAGE: RouteCoverage = {
  'POST /api/properties': 'createProperty',
  'POST /api/properties/test-telegram': {
    excluded:
      'A test endpoint that duplicates listing creation and also posts to the Telegram group; createProperty is the person action.',
  },
  'PUT /api/properties/:propertyId': 'updateProperty',
  'DELETE /api/properties/:propertyId': 'deleteProperty',
  'POST /api/properties/:propertyId/mark-transacted': 'markPropertyTransacted',
  'GET /api/properties/me/list': 'listMyProperties',
  'GET /api/properties/owner/:oxyUserId': 'listPropertiesByOwner',
  'GET /api/rooms': 'listRooms',
  'POST /api/rooms': 'createRoom',
  'GET /api/rooms/:id': 'getRoom',
  'PUT /api/rooms/:id': 'updateRoom',
  'DELETE /api/rooms/:id': 'deleteRoom',
  'GET /api/analytics': 'getMyAnalytics',
  'GET /api/analytics/stats': 'getAppStats',
};
