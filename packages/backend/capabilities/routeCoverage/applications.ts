import type { RouteCoverage } from './types';

export const APPLICATION_ROUTE_COVERAGE: RouteCoverage = {
  'POST /api/applications': 'submitApplication',
  'POST /api/applications/:id/documents': 'addApplicationDocuments',
  'GET /api/applications': 'listMyApplications',
  'POST /api/applications/:id/documents/:documentId/verification': 'verifyApplicationDocument',
  'GET /api/applications/:id/documents/:documentId': {
    excluded:
      "Returns one document's raw bytes as base64 (up to ~13 MB) for the app to open; a model context is not a file viewer, and getApplication already gives each document's type, name and verification state. The person opens the document in Homiio.",
  },
  'GET /api/applications/:id': 'getApplication',
  // One route, four tools: the status in the body decides which person may move it.
  'PATCH /api/applications/:id': [
    'withdrawApplication',
    'startReviewingApplication',
    'acceptApplication',
    'rejectApplication',
  ],
  'POST /api/applications/:id/create-lease': 'createLeaseFromApplication',
};
