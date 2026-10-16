import type { RouteCoverage } from './types';

const VIEW_TRACKING =
  "Records the PERSON opening a listing (their recently-viewed history and the listing's view count). An agent reading a listing is not the person viewing it, so a tool doing this would pollute their own history and the owner's analytics.";

export const LISTING_ROUTE_COVERAGE: RouteCoverage = {
  'POST /api/properties/:propertyId/report': 'reportListing',
  'POST /api/properties/:propertyId/track-view': { excluded: VIEW_TRACKING },
};
