import { Platform } from 'react-native';
import i18next from 'i18next';

// Only import expo-notifications on native platforms.
// On web and during SSR (Node.js static rendering), the module is not loaded.
const Notifications: typeof import('expo-notifications') | null =
  Platform.OS !== 'web' ? require('expo-notifications') : null;

export interface NotificationData {
  screen?: string;
  id?: string;
  type?: string;
  [key: string]: any;
}

export interface NotificationContent {
  title: string;
  body: string;
  data?: NotificationData;
  sound?: boolean;
  priority?: 'default' | 'normal' | 'high';
  badge?: number;
}

export interface ScheduledNotification {
  id: string;
  content: NotificationContent;
  trigger: any;
  repeats?: boolean;
}

export type NotificationCategory =
  | 'property'
  | 'message'
  | 'contract'
  | 'payment'
  | 'reminder'
  | 'system'
  | 'marketing';

export async function requestNotificationPermissions() {
  if (!Notifications) return false;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('Notification permissions not granted');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error requesting notification permissions:', error);
    return false;
  }
}

export async function scheduleDemoNotification() {
  if (!Notifications) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: i18next.t('notification.welcome.title'),
        body: i18next.t('notification.welcome.body'),
        data: { screen: 'notifications', type: 'welcome' },
        sound: true,
        priority: 'high',
      },
      trigger: null,
    });
  } catch (error) {
    console.error('Error scheduling demo notification:', error);
  }
}

export async function createNotification(
  title: string,
  body: string,
  data: NotificationData = {},
  options: {
    sound?: boolean;
    priority?: 'default' | 'normal' | 'high';
    badge?: number;
  } = {}
) {
  if (!Notifications) return;

  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: options.sound ?? true,
        priority: options.priority ?? 'default',
        badge: options.badge,
      },
      trigger: null,
    });

    return notificationId;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
}

export async function scheduleNotification(
  content: NotificationContent,
  trigger: any,
  repeats: boolean = false
): Promise<string> {
  if (!Notifications) {
    throw new Error('Notifications not supported on web');
  }

  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content,
      trigger,
      repeats,
    });

    return notificationId;
  } catch (error) {
    console.error('Error scheduling notification:', error);
    throw error;
  }
}

export async function cancelNotification(notificationId: string) {
  if (!Notifications) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (error) {
    console.error('Error canceling notification:', error);
  }
}

export async function cancelAllNotifications() {
  if (!Notifications) return;

  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (error) {
    console.error('Error canceling all notifications:', error);
  }
}

export async function getScheduledNotifications(): Promise<any[]> {
  if (!Notifications) return [];

  try {
    return await Notifications.getAllScheduledNotificationsAsync();
  } catch (error) {
    console.error('Error getting scheduled notifications:', error);
    return [];
  }
}

export async function getBadgeCount(): Promise<number> {
  if (!Notifications) return 0;

  try {
    return await Notifications.getBadgeCountAsync();
  } catch (error) {
    console.error('Error getting badge count:', error);
    return 0;
  }
}

export async function setBadgeCount(count: number) {
  if (!Notifications) return;

  try {
    await Notifications.setBadgeCountAsync(count);
  } catch (error) {
    console.error('Error setting badge count:', error);
  }
}

export async function clearBadge() {
  if (!Notifications) return;

  try {
    await Notifications.setBadgeCountAsync(0);
  } catch (error) {
    console.error('Error clearing badge:', error);
  }
}

export async function setupNotifications() {
  if (!Notifications) return;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const { data } = notification.request.content;

        return {
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: data?.type !== 'silent',
        };
      },
    });

    if (Platform.OS === 'ios') {
      await Notifications.setNotificationCategoryAsync('property', [
        {
          identifier: 'view',
          buttonTitle: 'View',
          options: {
            isDestructive: false,
            isAuthenticationRequired: false,
          },
        },
        {
          identifier: 'dismiss',
          buttonTitle: 'Dismiss',
          options: {
            isDestructive: true,
            isAuthenticationRequired: false,
          },
        },
      ]);

      await Notifications.setNotificationCategoryAsync('message', [
        {
          identifier: 'reply',
          buttonTitle: 'Reply',
          options: {
            isDestructive: false,
            isAuthenticationRequired: false,
          },
        },
        {
          identifier: 'view',
          buttonTitle: 'View',
          options: {
            isDestructive: false,
            isAuthenticationRequired: false,
          },
        },
      ]);
    }
  } catch (error) {
    console.error('Error setting up notifications:', error);
  }
}

export async function createPropertyNotification(
  propertyId: string,
  title: string,
  body: string,
  data: Record<string, any> = {}
) {
  return createNotification(title, body, {
    screen: 'properties',
    type: 'property',
    propertyId,
    ...data,
  }, { priority: 'high' });
}

export async function createMessageNotification(
  messageId: string,
  senderName: string,
  message: string,
  data: Record<string, any> = {}
) {
  return createNotification(
    `New message from ${senderName}`,
    message,
    {
      screen: 'messages',
      type: 'message',
      messageId,
      senderName,
      ...data,
    },
    { priority: 'high', sound: true }
  );
}

export async function createReminderNotification(
  title: string,
  body: string,
  date: Date,
  data: Record<string, any> = {}
) {
  return scheduleNotification(
    {
      title,
      body,
      data: {
        screen: 'reminders',
        type: 'reminder',
        ...data,
      },
      sound: true,
      priority: 'normal',
    },
    {
      date,
    }
  );
}

export async function createRepeatingNotification(
  title: string,
  body: string,
  interval: 'hour' | 'day' | 'week',
  data: Record<string, any> = {}
) {
  const trigger = {
    seconds: interval === 'hour' ? 3600 : interval === 'day' ? 86400 : 604800,
    repeats: true,
  };

  return scheduleNotification(
    {
      title,
      body,
      data: {
        type: 'repeating',
        ...data,
      },
      sound: true,
      priority: 'normal',
    },
    trigger,
    true
  );
}

/** Get the Notifications module (native only). Returns null on web. */
export function getNotificationsModule() {
  return Notifications;
}
