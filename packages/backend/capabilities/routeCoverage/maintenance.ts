import type { RouteCoverage } from './types';

const PHOTO_BYTES =
  'Raw photo bytes (an 8 MB multipart upload, or a base64 body answered back). A tool call is model-generated JSON and cannot carry or usefully return an image; the person attaches and opens photos in Homiio, and the request’s photo list is in getMaintenanceRequest.';

export const MAINTENANCE_ROUTE_COVERAGE: RouteCoverage = {
  'GET /api/maintenance': 'listMyMaintenanceRequests',
  'POST /api/maintenance': 'createMaintenanceRequest',
  'POST /api/maintenance/:id/status': 'transitionMaintenanceRequest',
  'POST /api/maintenance/:id/comments': 'commentOnMaintenanceRequest',
  'POST /api/maintenance/:id/attachments': { excluded: PHOTO_BYTES },
  'GET /api/maintenance/:id/attachments/:attachmentId': { excluded: PHOTO_BYTES },
  'GET /api/maintenance/:id': 'getMaintenanceRequest',
};
