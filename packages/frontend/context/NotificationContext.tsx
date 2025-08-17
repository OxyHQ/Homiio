import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useRef,
    ReactNode,
} from 'react';
import * as Notifications from 'expo-notifications';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

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
    NotificationData,
    NotificationContent,
    NotificationCategory,
} from '@/utils/notifications';
import { notificationService, Notification } from '@/services/notificationService';
import { initializeNotificationSocket, disconnectNotificationSocket } from '@/utils/notificationsSocket';
import { useOxy } from '@oxyhq/services';

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

export interface NotificationState {
    // Local state
    hasPermission: boolean;
    badgeCount: number;
    scheduledNotifications: Notifications.NotificationRequest[];

    // Server state
    notifications: Notification[];
    unreadCount: number;
    isLoading: boolean;
    error: string | null;

    // Preferences
    preferences: NotificationPreferences;

    // Socket state
    isSocketConnected: boolean;
}

export interface NotificationActions {
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
        }
    ) => Promise<string | undefined>;

    scheduleLocalNotification: (
        content: NotificationContent,
        trigger: Notifications.NotificationTriggerInput,
        repeats?: boolean
    ) => Promise<string>;

    cancelLocalNotification: (id: string) => Promise<void>;
    cancelAllLocalNotifications: () => Promise<void>;

    // Server notifications
    loadNotifications: (filters?: {
        unreadOnly?: boolean;
        type?: string;
        page?: number;
        limit?: number;
    }) => Promise<void>;

    markAsRead: (notificationId: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    deleteNotification: (notificationId: string) => Promise<void>;

    // Preferences
    updatePreferences: (preferences: Partial<NotificationPreferences>) => Promise<void>;

    // Socket management
    connectSocket: () => Promise<void>;
    disconnectSocket: () => Promise<void>;

    // Utility
    refreshAll: () => Promise<void>;
}

export interface NotificationContextType extends NotificationState, NotificationActions { }

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

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

export function NotificationProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { oxyServices, activeSessionId } = useOxy();

    // State
    const [state, setState] = useState<NotificationState>({
        hasPermission: false,
        badgeCount: 0,
        scheduledNotifications: [],
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        error: null,
        preferences: DEFAULT_PREFERENCES,
        isSocketConnected: false,
    });

    // Refs
    const notificationListener = useRef<Notifications.Subscription>();
    const responseListener = useRef<Notifications.Subscription>();
    const appStateListener = useRef<any>();

    // Initialize notifications
    const initializeNotifications = useCallback(async () => {
        try {
            if (Platform.OS === 'web') return;

            await setupNotifications();
            const hasPermission = await requestNotificationPermissions();

            setState(prev => ({ ...prev, hasPermission }));

            if (hasPermission) {
                const badgeCount = await getBadgeCount();
                const scheduledNotifications = await getScheduledNotifications();

                setState(prev => ({
                    ...prev,
                    badgeCount,
                    scheduledNotifications,
                }));
            }
        } catch (error) {
            console.error('Error initializing notifications:', error);
            setState(prev => ({ ...prev, error: 'Failed to initialize notifications' }));
        }
    }, []);

    // Request permissions
    const requestPermissions = useCallback(async (): Promise<boolean> => {
        try {
            const hasPermission = await requestNotificationPermissions();
            setState(prev => ({ ...prev, hasPermission }));
            return hasPermission;
        } catch (error) {
            console.error('Error requesting permissions:', error);
            return false;
        }
    }, []);

    // Badge management
    const updateBadgeCount = useCallback(async (count: number) => {
        try {
            await setBadgeCount(count);
            setState(prev => ({ ...prev, badgeCount: count }));
        } catch (error) {
            console.error('Error updating badge count:', error);
        }
    }, []);

    const clearBadgeCount = useCallback(async () => {
        try {
            await clearBadge();
            setState(prev => ({ ...prev, badgeCount: 0 }));
        } catch (error) {
            console.error('Error clearing badge count:', error);
        }
    }, []);

    // Local notifications
    const createLocalNotification = useCallback(async (
        title: string,
        body: string,
        data?: NotificationData,
        options?: {
            sound?: boolean;
            priority?: 'default' | 'normal' | 'high';
            badge?: number;
        }
    ) => {
        try {
            const notificationId = await createNotification(title, body, data, options);

            // Refresh scheduled notifications
            const scheduledNotifications = await getScheduledNotifications();
            setState(prev => ({ ...prev, scheduledNotifications }));

            return notificationId;
        } catch (error) {
            console.error('Error creating local notification:', error);
            return undefined;
        }
    }, []);

    const scheduleLocalNotification = useCallback(async (
        content: NotificationContent,
        trigger: Notifications.NotificationTriggerInput,
        repeats?: boolean
    ) => {
        try {
            const notificationId = await scheduleNotification(content, trigger, repeats);

            // Refresh scheduled notifications
            const scheduledNotifications = await getScheduledNotifications();
            setState(prev => ({ ...prev, scheduledNotifications }));

            return notificationId;
        } catch (error) {
            console.error('Error scheduling local notification:', error);
            throw error;
        }
    }, []);

    const cancelLocalNotification = useCallback(async (id: string) => {
        try {
            await cancelNotification(id);

            // Refresh scheduled notifications
            const scheduledNotifications = await getScheduledNotifications();
            setState(prev => ({ ...prev, scheduledNotifications }));
        } catch (error) {
            console.error('Error canceling local notification:', error);
        }
    }, []);

    const cancelAllLocalNotifications = useCallback(async () => {
        try {
            await cancelAllNotifications();
            setState(prev => ({ ...prev, scheduledNotifications: [] }));
        } catch (error) {
            console.error('Error canceling all local notifications:', error);
        }
    }, []);

    // Server notifications
    const loadNotifications = useCallback(async (filters?: {
        unreadOnly?: boolean;
        type?: string;
        page?: number;
        limit?: number;
    }) => {
        if (!oxyServices || !activeSessionId) return;

        try {
            setState(prev => ({ ...prev, isLoading: true, error: null }));

            const response = await notificationService.getNotifications(filters);

            setState(prev => ({
                ...prev,
                notifications: response.notifications,
                unreadCount: response.notifications.filter(n => !n.read).length,
                isLoading: false,
            }));
        } catch (error) {
            console.error('Error loading notifications:', error);
            setState(prev => ({
                ...prev,
                error: 'Failed to load notifications',
                isLoading: false,
            }));
        }
    }, [oxyServices, activeSessionId]);

    const markAsRead = useCallback(async (notificationId: string) => {
        if (!oxyServices || !activeSessionId) return;

        try {
            await notificationService.markAsRead(notificationId);

            // Update local state
            setState(prev => ({
                ...prev,
                notifications: prev.notifications.map(n =>
                    n.id === notificationId ? { ...n, read: true } : n
                ),
                unreadCount: Math.max(0, prev.unreadCount - 1),
            }));

            // Update badge count
            const newUnreadCount = Math.max(0, state.unreadCount - 1);
            await updateBadgeCount(newUnreadCount);

            // Invalidate queries
            queryClient.invalidateQueries({ queryKey: ['notifications'] });
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    }, [oxyServices, activeSessionId, state.unreadCount, updateBadgeCount, queryClient]);

    const markAllAsRead = useCallback(async () => {
        if (!oxyServices || !activeSessionId) return;

        try {
            await notificationService.markAllAsRead();

            // Update local state
            setState(prev => ({
                ...prev,
                notifications: prev.notifications.map(n => ({ ...n, read: true })),
                unreadCount: 0,
            }));

            // Clear badge
            await clearBadgeCount();

            // Invalidate queries
            queryClient.invalidateQueries({ queryKey: ['notifications'] });
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
        }
    }, [oxyServices, activeSessionId, clearBadgeCount, queryClient]);

    const deleteNotification = useCallback(async (notificationId: string) => {
        if (!oxyServices || !activeSessionId) return;

        try {
            await notificationService.deleteNotification(notificationId);

            // Update local state
            setState(prev => ({
                ...prev,
                notifications: prev.notifications.filter(n => n.id !== notificationId),
                unreadCount: prev.notifications.find(n => n.id === notificationId)?.read === false
                    ? Math.max(0, prev.unreadCount - 1)
                    : prev.unreadCount,
            }));

            // Invalidate queries
            queryClient.invalidateQueries({ queryKey: ['notifications'] });
        } catch (error) {
            console.error('Error deleting notification:', error);
        }
    }, [oxyServices, activeSessionId, queryClient]);

    // Preferences
    const updatePreferences = useCallback(async (preferences: Partial<NotificationPreferences>) => {
        try {
            setState(prev => ({
                ...prev,
                preferences: { ...prev.preferences, ...preferences },
            }));

            // Here you would typically save preferences to the server
            // await notificationService.updatePreferences(preferences);
        } catch (error) {
            console.error('Error updating preferences:', error);
        }
    }, []);

    // Socket management
    const connectSocket = useCallback(async () => {
        if (!oxyServices || !activeSessionId) return;

        try {
            const socket = await initializeNotificationSocket();
            if (socket) {
                setState(prev => ({ ...prev, isSocketConnected: true }));

                // Listen for new notifications
                socket.on('notification', (notification: Notification) => {
                    setState(prev => ({
                        ...prev,
                        notifications: [notification, ...prev.notifications],
                        unreadCount: prev.unreadCount + 1,
                    }));

                    // Update badge count
                    updateBadgeCount(state.unreadCount + 1);

                    // Show toast
                    toast.success(notification.title);
                });
            }
        } catch (error) {
            console.error('Error connecting notification socket:', error);
        }
    }, [oxyServices, activeSessionId, state.unreadCount, updateBadgeCount]);

    const disconnectSocket = useCallback(async () => {
        try {
            await disconnectNotificationSocket();
            setState(prev => ({ ...prev, isSocketConnected: false }));
        } catch (error) {
            console.error('Error disconnecting notification socket:', error);
        }
    }, []);

    // Utility
    const refreshAll = useCallback(async () => {
        await Promise.all([
            loadNotifications(),
            connectSocket(),
        ]);
    }, [loadNotifications, connectSocket]);

    // Set up notification listeners
    useEffect(() => {
        if (Platform.OS === 'web') return;

        // Listen for notifications received while app is running
        notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
            const { data } = notification.request.content;

            // Handle notification based on type
            if (data?.type === 'property' && data?.propertyId) {
                // Navigate to property or update property list
                router.push(`/properties/${data.propertyId}`);
            } else if (data?.type === 'message' && data?.messageId) {
                // Navigate to messages
                router.push('/messages');
            }

            // Update badge count
            updateBadgeCount(state.badgeCount + 1);
        });

        // Listen for notification responses (taps)
        responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
            const { data } = response.notification.request.content;

            // Handle notification tap
            if (data?.screen) {
                router.push(data.screen);
            }

            // Mark as read if it's a server notification
            if (data?.id) {
                markAsRead(data.id);
            }
        });

        // Listen for app state changes
        appStateListener.current = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
            if (nextAppState === 'active') {
                // App became active, refresh notifications and clear badge
                refreshAll();
                clearBadgeCount();
            }
        });

        return () => {
            if (notificationListener.current) {
                Notifications.removeNotificationSubscription(notificationListener.current);
            }
            if (responseListener.current) {
                Notifications.removeNotificationSubscription(responseListener.current);
            }
            if (appStateListener.current) {
                appStateListener.current.remove();
            }
        };
    }, [router, state.badgeCount, updateBadgeCount, markAsRead, refreshAll, clearBadgeCount]);

    // Initialize on mount
    useEffect(() => {
        initializeNotifications();
    }, [initializeNotifications]);

    // Connect socket when authenticated
    useEffect(() => {
        if (oxyServices && activeSessionId) {
            connectSocket();
            loadNotifications();
        } else {
            disconnectSocket();
        }
    }, [oxyServices, activeSessionId, connectSocket, disconnectSocket, loadNotifications]);

    const contextValue: NotificationContextType = {
        ...state,
        requestPermissions,
        updateBadgeCount,
        clearBadgeCount,
        createLocalNotification,
        scheduleLocalNotification,
        cancelLocalNotification,
        cancelAllLocalNotifications,
        loadNotifications,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        updatePreferences,
        connectSocket,
        disconnectSocket,
        refreshAll,
    };

    return (
        <NotificationContext.Provider value={contextValue}>
            {children}
        </NotificationContext.Provider>
    );
}

export function useNotifications() {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
}
