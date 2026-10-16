import type { RouteCoverage } from './types';

export const NOTIFICATION_ROUTE_COVERAGE: RouteCoverage = {
  'GET /api/notifications': 'listMyNotifications',
  'POST /api/notifications': {
    excluded:
      'Writes an arbitrary notification (any type, title, message and data) into the mailbox outside `notificationDispatchService`, the one notification write chokepoint (AGENTS.md); notifications are effects of domain actions, never something an agent composes.',
  },
  'PATCH /api/notifications/read-all': 'markAllNotificationsRead',
  'DELETE /api/notifications/clear-all': 'clearAllNotifications',
  'GET /api/notifications/:id': 'getNotification',
  'PUT /api/notifications/:id': {
    excluded:
      'Rewrites a notification’s title, message, priority and data — content the dispatcher wrote, not the person’s. The person action it carries, the read state, is markNotificationRead.',
  },
  'PATCH /api/notifications/:id/read': 'markNotificationRead',
  'DELETE /api/notifications/:id': 'deleteNotification',
};
