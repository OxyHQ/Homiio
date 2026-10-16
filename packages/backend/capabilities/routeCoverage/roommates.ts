import type { RouteCoverage } from './types';

export const ROOMMATE_ROUTE_COVERAGE: RouteCoverage = {
  'GET /api/roommates': 'listRoommateProfiles',
  'GET /api/roommates/status': 'getRoommateStatus',
  'GET /api/roommates/preferences': 'getRoommatePreferences',
  'PUT /api/roommates/preferences': 'updateRoommatePreferences',
  'PATCH /api/roommates/toggle': 'toggleRoommateMatching',
  'GET /api/roommates/requests': 'listRoommateRequests',
  'GET /api/roommates/relationships': 'listRoommateRelationships',
  'DELETE /api/roommates/relationships/:relationshipId': 'endRoommateRelationship',
  'POST /api/roommates/requests/:requestId/accept': 'acceptRoommateRequest',
  'POST /api/roommates/requests/:requestId/decline': 'declineRoommateRequest',
  'POST /api/roommates/:oxyUserId/request': 'sendRoommateRequest',
};
