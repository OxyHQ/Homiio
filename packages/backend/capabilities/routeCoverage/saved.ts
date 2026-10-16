import type { RouteCoverage } from './types';

export const SAVED_ROUTE_COVERAGE: RouteCoverage = {
  'GET /api/profiles/me/recent-properties': 'listRecentlyViewedHomes',
  'POST /api/profiles/me/recent-properties/:propertyId': {
    excluded:
      "Records the PERSON opening a listing in their recently-viewed history. An agent reading a listing is not the person viewing it, so a tool doing this would pollute the person's own history.",
  },
  'DELETE /api/profiles/me/recent-properties': 'clearRecentlyViewedHomes',
  'GET /api/profiles/me/saved-properties': 'listSavedHomes',
  'POST /api/profiles/me/save-property': 'saveHome',
  'DELETE /api/profiles/me/saved-properties/:propertyId': 'unsaveHome',
  'PATCH /api/profiles/me/saved-properties/:propertyId/notes': 'updateSavedHomeNotes',
  'GET /api/profiles/me/saved-property-folders': 'listSavedFolders',
  'POST /api/profiles/me/saved-property-folders': 'createSavedFolder',
  'PUT /api/profiles/me/saved-property-folders/:folderId': 'updateSavedFolder',
  'DELETE /api/profiles/me/saved-property-folders/:folderId': 'deleteSavedFolder',
  'GET /api/profiles/me/saved-searches': 'listSavedSearches',
  'POST /api/profiles/me/saved-searches': 'createSavedSearch',
  'DELETE /api/profiles/me/saved-searches/:searchId': 'deleteSavedSearch',
  'PUT /api/profiles/me/saved-searches/:searchId': 'updateSavedSearch',
  'PUT /api/profiles/me/saved-searches/:searchId/notifications': 'setSavedSearchAlerts',
  'GET /api/profiles/me/alerts': 'listHousingAlerts',
  'GET /api/profiles/me/alerts/:alertId': 'getHousingAlert',
};
