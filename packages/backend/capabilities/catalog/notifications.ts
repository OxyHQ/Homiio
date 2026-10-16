import type { CatalogTool } from '@oxy.so/contracts';

import {
  actTool,
  booleanInput,
  enumInput,
  idInput,
  limitInput,
  objectInput,
  optionalTextInput,
  pageInput,
  readTool,
} from './define';

export const NOTIFICATION_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'listMyNotifications',
    description:
      'List the person’s Homiio notifications, newest first, with the unread count. Filter with unreadOnly, type or priority.',
    capability: 'housing.notifications.read',
    input: objectInput({
      page: pageInput,
      limit: limitInput,
      unreadOnly: booleanInput,
      type: optionalTextInput(100),
      priority: enumInput(['low', 'medium', 'high', 'urgent']),
    }),
  }),
  readTool({
    name: 'getNotification',
    description: 'Read one of the person’s notifications. Anyone else’s answers not-found.',
    capability: 'housing.notifications.read',
    input: objectInput({ notificationId: idInput }, ['notificationId']),
  }),
  actTool({
    name: 'markNotificationRead',
    description: 'Mark one of the person’s notifications as read.',
    capability: 'housing.notifications.manage',
    capabilityPackage: 'administer',
    input: objectInput({ notificationId: idInput }, ['notificationId']),
  }),
  actTool({
    name: 'markAllNotificationsRead',
    description: 'Mark all of the person’s notifications as read.',
    capability: 'housing.notifications.manage',
    capabilityPackage: 'administer',
    input: objectInput({}),
  }),
  actTool({
    name: 'deleteNotification',
    description: 'Delete one of the person’s notifications. Anyone else’s answers not-found.',
    capability: 'housing.notifications.manage',
    capabilityPackage: 'administer',
    input: objectInput({ notificationId: idInput }, ['notificationId']),
  }),
  actTool({
    name: 'clearAllNotifications',
    description: 'Permanently delete all of the person’s notifications.',
    capability: 'housing.notifications.manage',
    capabilityPackage: 'administer',
    input: objectInput({}),
  }),
];
