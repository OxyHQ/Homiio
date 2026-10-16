import {
  clearAllNotifications,
  getNotification,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removeNotification,
} from '../../domain/notifications';
import { asQuery, type HomiioToolHandlers, requiredString } from './context';

export const NOTIFICATION_HANDLERS: HomiioToolHandlers = {
  listMyNotifications: async (input, { accountId }) =>
    listMyNotifications(accountId, asQuery(input)),
  getNotification: async (input, { accountId }) => ({
    data: await getNotification(accountId, requiredString(input, 'notificationId')),
  }),
  markNotificationRead: async (input, { accountId }) => ({
    data: await markNotificationRead(accountId, requiredString(input, 'notificationId')),
  }),
  markAllNotificationsRead: async (_input, { accountId }) => ({
    data: await markAllNotificationsRead(accountId),
  }),
  deleteNotification: async (input, { accountId }) => {
    await removeNotification(accountId, requiredString(input, 'notificationId'));
    return { data: null };
  },
  clearAllNotifications: async (_input, { accountId }) => ({
    data: await clearAllNotifications(accountId),
  }),
};
