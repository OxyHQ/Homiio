import type { RouteCoverage } from './types';

/**
 * The authenticated eviction routes. The three team-chat routes are in
 * `platform.ts`; the public reads (`GET /api/evictions`, `/resources`,
 * `/:id`, `/:id/comments`) are on `routes/public.ts` and served by
 * listEvictionCases, listEvictionResources, getEvictionCase and
 * listEvictionComments.
 */
export const EVICTION_ROUTE_COVERAGE: RouteCoverage = {
  'POST /api/evictions': 'reportEvictionCase',
  'GET /api/evictions/me/list': 'listMyEvictionCases',
  'GET /api/evictions/me/attending': 'listAttendingEvictionCases',
  'GET /api/evictions/me/following': 'listFollowedEvictionCases',
  'GET /api/evictions/:id/team': 'getEvictionTeam',
  'POST /api/evictions/:id/collaborators': 'addEvictionCollaborator',
  'DELETE /api/evictions/:id/collaborators/:oxyUserId': 'removeEvictionCollaborator',
  'PUT /api/evictions/:id': 'updateEvictionCase',
  'DELETE /api/evictions/:id': 'deleteEvictionCase',
  'POST /api/evictions/:id/updates': 'postEvictionUpdate',
  'POST /api/evictions/:id/hold/clear': 'clearEvictionHold',
  'POST /api/evictions/:id/attend': 'toggleEvictionAttendance',
  'POST /api/evictions/:id/follow': 'toggleEvictionFollow',
  'POST /api/evictions/:id/vouch/:oxyUserId': 'vouchForSupporter',
  'POST /api/evictions/:id/supporters/:oxyUserId/revoke': 'revokeSupporter',
  'GET /api/evictions/:id/location/exact': 'getExactEvictionLocation',
  'GET /api/evictions/:id/location/grants': 'listEvictionLocationGrants',
  'POST /api/evictions/:id/location/grants': 'grantEvictionLocation',
  'POST /api/evictions/:id/location/grants/:oxyUserId/revoke': 'revokeEvictionLocationGrant',
  'GET /api/evictions/:id/location/audit': 'getEvictionLocationAudit',
  'POST /api/evictions/:id/comments': 'commentOnEviction',
  'DELETE /api/evictions/:id/comments/:commentId': 'deleteEvictionComment',
  'POST /api/evictions/:id/report': 'reportEvictionContent',
};
