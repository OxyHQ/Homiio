import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  requestNotificationPermissions,
  setupNotifications,
  getBadgeCount,
  setBadgeCount,
  clearBadge,
  getScheduledNotifications,
  cancelNotification,
  cancelAllNotifications,
  createNotification,
  scheduleNotification,
  getNotificationsModule,
  type NotificationData,
  type NotificationContent,
} from '@/utils/notifications';
import {
  notificationService,
  type Notification,
  type NotificationListResponse,
} from '@/services/notificationService';
import { useOxy } from '@oxy.so/services/ui/client';
import { logger } from '@/utils/logger';
import { getData, storeData } from '@/utils/storage';

export interface NotificationPreferences {
  property: boolean;
  message: boolean;
  contract: boolean;
  payment: boolean;
  reminder: boolean;
  system: boolean;
  marketing: boolean;
  sound: boolean;
  badge: boolean;
  push: boolean;
}

interface NotificationState {
  // Local state
  hasPermission: boolean;
  badgeCount: number;
  scheduledNotifications: any[];

  // Server state
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;

  // Preferences
  preferences: NotificationPreferences;
}

interface NotificationActions {
  // Permission management
  requestPermissions: () => Promise<boolean>;

  // Badge management
  updateBadgeCount: (count: number) => Promise<void>;
  clearBadgeCount: () => Promise<void>;

  // Local notifications
  createLocalNotification: (
    title: string,
    body: string,
    data?: NotificationData,
    options?: {
      sound?: boolean;
      priority?: 'default' | 'normal' | 'high';
      badge?: number;
    },
  ) => Promise<string | undefined>;

  scheduleLocalNotification: (
    content: NotificationContent,
    trigger: any,
    repeats?: boolean,
  ) => Promise<string>;

  cancelLocalNotification: (id: string) => Promise<void>;
  cancelAllLocalNotifications: () => Promise<void>;

  // Server notifications
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  clearAllNotifications: () => Promise<void>;

  // Preferences
  updatePreferences: (preferences: Partial<NotificationPreferences>) => Promise<void>;

  // Utility
  refreshAll: () => Promise<void>;
}

interface NotificationContextType extends NotificationState, NotificationActions {}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const PREFERENCES_STORAGE_KEY = 'homiio.notificationPreferences';

const DEFAULT_PREFERENCES: NotificationPreferences = {
  property: true,
  message: true,
  contract: true,
  payment: true,
  reminder: true,
  system: true,
  marketing: false,
  sound: true,
  badge: true,
  push: true,
};

/**
 * Device-side notification state: OS permission, app badge, scheduled local
 * notifications, plus the locally persisted preferences. None of it belongs to
 * a component — it mirrors the OS and AsyncStorage — so it lives in a module
 * scope external store read with `useSyncExternalStore`, is initialised once
 * when this module loads, and is written by the plain functions below.
 */
interface DeviceState {
  hasPermission: boolean;
  badgeCount: number;
  scheduledNotifications: any[];
  preferences: NotificationPreferences;
  initError: string | null;
  /**
   * Ids marked read on this device that the mailbox query may not reflect yet
   * (a notification tapped from the OS tray is marked read here, outside
   * React). The provider overlays them onto the server list.
   */
  readIds: ReadonlySet<string>;
}

let device: DeviceState = {
  hasPermission: false,
  badgeCount: 0,
  scheduledNotifications: [],
  preferences: DEFAULT_PREFERENCES,
  initError: null,
  readIds: new Set(),
};
const deviceListeners = new Set<() => void>();

function patchDevice(patch: Partial<DeviceState>) {
  device = { ...device, ...patch };
  for (const listener of deviceListeners) listener();
}

function subscribeDevice(listener: () => void) {
  deviceListeners.add(listener);
  return () => {
    deviceListeners.delete(listener);
  };
}

const getDevice = () => device;

async function refreshScheduled() {
  patchDevice({ scheduledNotifications: await getScheduledNotifications() });
}

// Permission management
async function requestPermissions(): Promise<boolean> {
  try {
    const hasPermission = await requestNotificationPermissions();
    patchDevice({ hasPermission });
    return hasPermission;
  } catch (error) {
    logger.error('Notifications: permission request failed', error);
    return false;
  }
}

// Badge management (best-effort: failures are non-fatal but logged)
async function updateBadgeCount(count: number) {
  try {
    await setBadgeCount(count);
    patchDevice({ badgeCount: count });
  } catch (error) {
    logger.warn('Notifications: updateBadgeCount failed', error);
  }
}

async function clearBadgeCount() {
  try {
    await clearBadge();
    patchDevice({ badgeCount: 0 });
  } catch (error) {
    logger.warn('Notifications: clearBadgeCount failed', error);
  }
}

// Local notifications
async function createLocalNotification(
  title: string,
  body: string,
  data?: NotificationData,
  options?: {
    sound?: boolean;
    priority?: 'default' | 'normal' | 'high';
    badge?: number;
  },
) {
  try {
    const notificationId = await createNotification(title, body, data, options);
    await refreshScheduled();
    return notificationId;
  } catch (error) {
    logger.error('Notifications: createLocalNotification failed', error);
    return undefined;
  }
}

async function scheduleLocalNotification(
  content: NotificationContent,
  trigger: any,
  repeats?: boolean,
) {
  try {
    const notificationId = await scheduleNotification(content, trigger, repeats);
    await refreshScheduled();
    return notificationId;
  } catch (error) {
    logger.error('Notifications: scheduleLocalNotification failed', error);
    throw error;
  }
}

async function cancelLocalNotification(id: string) {
  try {
    await cancelNotification(id);
    await refreshScheduled();
  } catch (error) {
    logger.error('Notifications: cancelLocalNotification failed', error);
  }
}

async function cancelAllLocalNotifications() {
  try {
    await cancelAllNotifications();
    patchDevice({ scheduledNotifications: [] });
  } catch (error) {
    logger.error('Notifications: cancelAllLocalNotifications failed', error);
  }
}

// Preferences — the backend exposes no notification-preferences endpoint,
// so preferences are persisted locally (AsyncStorage) to survive restarts.
async function updatePreferences(preferences: Partial<NotificationPreferences>) {
  const nextPreferences = { ...device.preferences, ...preferences };
  patchDevice({ preferences: nextPreferences });

  try {
    await storeData(PREFERENCES_STORAGE_KEY, nextPreferences);
  } catch (error) {
    logger.error('Notifications: failed to persist preferences', error);
  }
}

/**
 * Mark a server notification read. The id is overlaid as read straight away;
 * a failed write takes the overlay back off. Any mailbox fetch waits for
 * pending writes first, so a refetch can never resurrect an unread state that
 * is already being cleared.
 */
const pendingReads = new Set<Promise<void>>();

function markNotificationRead(notificationId: string): Promise<void> {
  patchDevice({ readIds: new Set(device.readIds).add(notificationId) });
  const write = notificationService.markAsRead(notificationId).catch((error: unknown) => {
    const readIds = new Set(device.readIds);
    readIds.delete(notificationId);
    patchDevice({ readIds });
    throw error;
  });
  const settled = write.then(
    () => undefined,
    () => undefined,
  );
  pendingReads.add(settled);
  void settled.then(() => pendingReads.delete(settled));
  return write;
}

async function fetchMailbox(): Promise<NotificationListResponse> {
  await Promise.all(pendingReads);
  return notificationService.getNotifications();
}

/** One-time device initialisation, started when the app loads this module. */
async function initializeNotifications() {
  try {
    const storedPreferences = await getData<NotificationPreferences>(PREFERENCES_STORAGE_KEY);
    if (storedPreferences) {
      patchDevice({ preferences: { ...DEFAULT_PREFERENCES, ...storedPreferences } });
    }

    if (Platform.OS === 'web') return;

    await setupNotifications();
    const hasPermission = await requestNotificationPermissions();
    patchDevice({ hasPermission });

    if (hasPermission) {
      patchDevice({
        badgeCount: await getBadgeCount(),
        scheduledNotifications: await getScheduledNotifications(),
      });
    }
  } catch (error) {
    logger.error('Notifications: initialization failed', error);
    patchDevice({ initError: 'Failed to initialize notifications' });
  }
}

void initializeNotifications();

/**
 * App-lifetime OS subscriptions (native only — the module is null on web).
 * They live as long as the app, so they are attached once here and never
 * removed, rather than re-attached by a component on every badge change.
 */
const NotificationsModule = getNotificationsModule();
if (NotificationsModule) {
  // A notification received while the app is running.
  NotificationsModule.addNotificationReceivedListener((notification) => {
    const { data } = notification.request.content;

    const propertyId = data?.propertyId;
    if (data?.type === 'property' && typeof propertyId === 'string') {
      router.push(`/properties/${propertyId}`);
    }

    void updateBadgeCount(device.badgeCount + 1);
  });

  // A notification tapped.
  NotificationsModule.addNotificationResponseReceivedListener((response) => {
    const { data } = response.notification.request.content;

    const screen = data?.screen;
    if (typeof screen === 'string') {
      router.push(screen);
    }

    const id = data?.id;
    if (typeof id === 'string') {
      markNotificationRead(id)
        .then(() => updateBadgeCount(Math.max(0, device.badgeCount - 1)))
        .catch((error: unknown) => logger.error('Notifications: markAsRead failed', error));
    }
  });

  // Back in the foreground: the badge has been seen. The mailbox refetch on
  // foreground is the query's own `refetchOnWindowFocus` (focusManager follows
  // AppState, wired in the root layout).
  AppState.addEventListener('change', (nextAppState) => {
    if (nextAppState === 'active') void clearBadgeCount();
  });
}

const EMPTY_NOTIFICATIONS: Notification[] = [];

const mailboxKey = (sessionId: string | null | undefined) =>
  ['notifications', 'mailbox', sessionId ?? null] as const;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();
  const signedIn = Boolean(oxyServices && activeSessionId);

  const deviceState = useSyncExternalStore(subscribeDevice, getDevice, getDevice);

  // The mailbox is server state: React Query owns fetching it for the active
  // session. The app has no realtime notifications channel; the inbox stays
  // fresh via refetch-on-foreground (native, as before) + invalidation after
  // writes.
  const mailbox = useQuery({
    queryKey: mailboxKey(activeSessionId),
    queryFn: fetchMailbox,
    enabled: signedIn,
    refetchOnWindowFocus: Platform.OS === 'web' ? false : 'always',
  });

  const serverNotifications = mailbox.data?.notifications ?? EMPTY_NOTIFICATIONS;
  const { readIds } = deviceState;
  const notifications = serverNotifications.map((n) =>
    n.read || !readIds.has(n.id) ? n : { ...n, read: true },
  );
  const overlaidReads = serverNotifications.filter((n) => !n.read && readIds.has(n.id)).length;
  const unreadCount = Math.max(0, (mailbox.data?.unreadCount ?? 0) - overlaidReads);

  const setMailbox = useCallback(
    (update: (prev: NotificationListResponse) => NotificationListResponse) => {
      queryClient.setQueryData<NotificationListResponse>(mailboxKey(activeSessionId), (prev) =>
        prev ? update(prev) : prev,
      );
    },
    [queryClient, activeSessionId],
  );

  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!signedIn) return;

      try {
        await markNotificationRead(notificationId);
        await updateBadgeCount(Math.max(0, unreadCount - 1));
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch (error) {
        logger.error('Notifications: markAsRead failed', error);
      }
    },
    [signedIn, unreadCount, queryClient],
  );

  const markAllAsRead = useCallback(async () => {
    if (!signedIn) return;

    try {
      await notificationService.markAllAsRead();

      setMailbox((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      }));

      await clearBadgeCount();

      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (error) {
      logger.error('Notifications: markAllAsRead failed', error);
    }
  }, [signedIn, setMailbox, queryClient]);

  const deleteNotification = useCallback(
    async (notificationId: string) => {
      if (!signedIn) return;

      try {
        await notificationService.deleteNotification(notificationId);

        setMailbox((prev) => ({
          ...prev,
          notifications: prev.notifications.filter((n) => n.id !== notificationId),
          unreadCount:
            prev.notifications.find((n) => n.id === notificationId)?.read === false
              ? Math.max(0, prev.unreadCount - 1)
              : prev.unreadCount,
        }));

        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch (error) {
        logger.error('Notifications: deleteNotification failed', error);
      }
    },
    [signedIn, setMailbox, queryClient],
  );

  const clearAllNotifications = useCallback(async () => {
    if (!signedIn) return;

    try {
      await notificationService.clearAllNotifications();

      setMailbox((prev) => ({ ...prev, notifications: [], unreadCount: 0 }));

      await clearBadgeCount();

      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (error) {
      logger.error('Notifications: clearAllNotifications failed', error);
      throw error;
    }
  }, [signedIn, setMailbox, queryClient]);

  const { refetch } = mailbox;
  const refreshAll = useCallback(async () => {
    if (!signedIn) return;
    await refetch();
  }, [signedIn, refetch]);

  const contextValue: NotificationContextType = {
    hasPermission: deviceState.hasPermission,
    badgeCount: deviceState.badgeCount,
    scheduledNotifications: deviceState.scheduledNotifications,
    preferences: deviceState.preferences,
    notifications,
    unreadCount,
    isLoading: mailbox.isFetching,
    error: mailbox.isError ? 'Failed to load notifications' : deviceState.initError,
    requestPermissions,
    updateBadgeCount,
    clearBadgeCount,
    createLocalNotification,
    scheduleLocalNotification,
    cancelLocalNotification,
    cancelAllLocalNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllNotifications,
    updatePreferences,
    refreshAll,
  };

  return (
    <NotificationContext.Provider value={contextValue}>{children}</NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
