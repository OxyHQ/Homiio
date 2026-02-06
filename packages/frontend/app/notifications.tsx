import React, { useState, useCallback, useMemo } from 'react';
import {
    View,
    StyleSheet,
    FlatList,
    RefreshControl,
    TouchableOpacity,
    TextInput,
    Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNotifications } from '@/context/NotificationContext';
import { NotificationItem } from '@/components/NotificationItem';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { toast } from 'sonner';
// Simple date formatting function
const formatDistanceToNow = (date: Date) => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)}mo ago`;
    return `${Math.floor(diffInSeconds / 31536000)}y ago`;
};

export default function NotificationsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const {
        notifications,
        scheduledNotifications,
        unreadCount,
        isLoading,
        error,
        preferences,
        hasPermission,
        loadNotifications,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        cancelLocalNotification,
        cancelAllLocalNotifications,
        requestPermissions,
        refreshAll,
    } = useNotifications();

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFilter, setSelectedFilter] = useState<'all' | 'unread' | 'property' | 'message' | 'system'>('all');
    const [refreshing, setRefreshing] = useState(false);

    // Filter notifications based on search and filter
    const filteredNotifications = useMemo(() => {
        let filtered = notifications;

        // Apply type filter
        if (selectedFilter !== 'all') {
            if (selectedFilter === 'unread') {
                filtered = filtered.filter(n => !n.read);
            } else {
                filtered = filtered.filter(n => n.type === selectedFilter);
            }
        }

        // Apply search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(n =>
                n.title.toLowerCase().includes(query) ||
                n.message.toLowerCase().includes(query) ||
                n.type.toLowerCase().includes(query)
            );
        }

        return filtered;
    }, [notifications, selectedFilter, searchQuery]);

    // Handle refresh
    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await refreshAll();
        } catch (error) {
        } finally {
            setRefreshing(false);
        }
    }, [refreshAll]);

    // Handle notification press
    const handleNotificationPress = useCallback(async (notification: any) => {
        try {
            // Mark as read if it's unread
            if (!notification.read) {
                await markAsRead(notification.id);
            }

            // Navigate based on notification type
            if (notification.data?.screen) {
                router.push(notification.data.screen);
            } else if (notification.type === 'property' && notification.data?.propertyId) {
                router.push(`/properties/${notification.data.propertyId}`);
            } else if (notification.type === 'message') {
                router.push('/messages');
            } else if (notification.type === 'contract') {
                router.push('/contracts');
            } else if (notification.type === 'payment') {
                router.push('/payments');
            }
        } catch (error) {
        }
    }, [markAsRead, router]);

    // Handle delete notification
    const handleDeleteNotification = useCallback(async (notification: any) => {
        Alert.alert(
            t('notification.delete.title', 'Delete Notification'),
            t('notification.delete.message', 'Are you sure you want to delete this notification?'),
            [
                { text: t('common.cancel', 'Cancel'), style: 'cancel' },
                {
                    text: t('common.delete', 'Delete'),
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteNotification(notification.id);
                            toast.success(t('notification.delete.success', 'Notification deleted'));
                        } catch (error) {
                            toast.error(t('notification.delete.error', 'Failed to delete notification'));
                        }
                    },
                },
            ]
        );
    }, [deleteNotification, t]);

    // Handle mark all as read
    const handleMarkAllAsRead = useCallback(async () => {
        try {
            await markAllAsRead();
            toast.success(t('notification.markAllRead.success', 'All notifications marked as read'));
        } catch (error) {
            toast.error(t('notification.markAllRead.error', 'Failed to mark all as read'));
        }
    }, [markAllAsRead, t]);

    // Handle request permissions
    const handleRequestPermissions = useCallback(async () => {
        try {
            const granted = await requestPermissions();
            if (granted) {
                toast.success(t('notification.permissions.granted', 'Notification permissions granted'));
            } else {
                toast.error(t('notification.permissions.denied', 'Notification permissions denied'));
            }
        } catch (error) {
            toast.error(t('notification.permissions.error', 'Failed to request permissions'));
        }
    }, [requestPermissions, t]);

    // Render notification item
    const renderNotificationItem = useCallback(({ item }: { item: any }) => (
        <NotificationItem
            type={item.type}
            title={item.title}
            description={item.message}
            time={formatDistanceToNow(new Date(item.createdAt))}
            read={item.read}
            onPress={() => handleNotificationPress(item)}
            style={styles.notificationItem}
        />
    ), [handleNotificationPress]);

    // Render scheduled notification item
    const renderScheduledNotificationItem = useCallback(({ item }: { item: any }) => (
        <View style={styles.scheduledNotificationItem}>
            <View style={styles.scheduledNotificationHeader}>
                <Ionicons name="time-outline" size={16} color={colors.COLOR_BLACK_LIGHT_5} />
                <ThemedText style={styles.scheduledNotificationTitle}>
                    {item.content.title}
                </ThemedText>
                <TouchableOpacity
                    onPress={() => cancelLocalNotification(item.identifier)}
                    style={styles.cancelButton}
                >
                    <Ionicons name="close" size={16} color={colors.chatUnreadBadge} />
                </TouchableOpacity>
            </View>
            <ThemedText style={styles.scheduledNotificationBody}>
                {item.content.body}
            </ThemedText>
            <ThemedText style={styles.scheduledNotificationTime}>
                {item.trigger.date ?
                    `Scheduled for ${new Date(item.trigger.date).toLocaleString()}` :
                    'Scheduled notification'
                }
            </ThemedText>
        </View>
    ), [cancelLocalNotification]);

    // Render filter button
    const renderFilterButton = useCallback((filter: typeof selectedFilter, label: string) => (
        <TouchableOpacity
            style={[
                styles.filterButton,
                selectedFilter === filter && styles.filterButtonActive
            ]}
            onPress={() => setSelectedFilter(filter)}
        >
            <ThemedText style={[
                styles.filterButtonText,
                selectedFilter === filter && styles.filterButtonTextActive
            ]}>
                {label}
            </ThemedText>
        </TouchableOpacity>
    ), [selectedFilter]);

    // Render empty state
    const renderEmptyState = useCallback(() => (
        <View style={styles.emptyState}>
            <Ionicons name="notifications-outline" size={64} color={colors.COLOR_BLACK_LIGHT_5} />
            <ThemedText style={styles.emptyStateTitle}>
                {t('notification.empty.title', 'No notifications')}
            </ThemedText>
            <ThemedText style={styles.emptyStateMessage}>
                {searchQuery || selectedFilter !== 'all'
                    ? t('notification.empty.filtered', 'No notifications match your current filter')
                    : t('notification.empty.message', 'You\'re all caught up! New notifications will appear here.')
                }
            </ThemedText>
        </View>
    ), [searchQuery, selectedFilter, t]);

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={colors.primaryDark} />
                </TouchableOpacity>
                <ThemedText style={styles.headerTitle}>
                    {t('Notifications', 'Notifications')}
                </ThemedText>
                <View style={styles.headerActions}>
                    {unreadCount > 0 && (
                        <TouchableOpacity onPress={handleMarkAllAsRead} style={styles.markAllButton}>
                            <Ionicons name="checkmark-done" size={20} color={colors.primaryColor} />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => router.push('/settings/notifications')} style={styles.settingsButton}>
                        <Ionicons name="settings-outline" size={20} color={colors.primaryDark} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Search Bar */}
            <View style={styles.searchContainer}>
                <Ionicons name="search" size={20} color={colors.COLOR_BLACK_LIGHT_5} style={styles.searchIcon} />
                <TextInput
                    style={styles.searchInput}
                    placeholder={t('notification.search.placeholder', 'Search notifications...')}
                    placeholderTextColor={colors.textSecondary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
                        <Ionicons name="close-circle" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
                    </TouchableOpacity>
                )}
            </View>

            {/* Filter Buttons */}
            <View style={styles.filterContainer}>
                {renderFilterButton('all', t('notification.filter.all', 'All'))}
                {renderFilterButton('unread', t('notification.filter.unread', 'Unread'))}
                {renderFilterButton('property', t('notification.filter.property', 'Property'))}
                {renderFilterButton('message', t('notification.filter.message', 'Message'))}
                {renderFilterButton('system', t('notification.filter.system', 'System'))}
            </View>

            {/* Permission Request */}
            {!hasPermission && (
                <View style={styles.permissionContainer}>
                    <ThemedText style={styles.permissionTitle}>
                        {t('notification.permissions.title', 'Enable Notifications')}
                    </ThemedText>
                    <ThemedText style={styles.permissionMessage}>
                        {t('notification.permissions.message', 'Get notified about new properties, messages, and important updates.')}
                    </ThemedText>
                    <TouchableOpacity onPress={handleRequestPermissions} style={styles.permissionButton}>
                        <ThemedText style={styles.permissionButtonText}>
                            {t('notification.permissions.enable', 'Enable Notifications')}
                        </ThemedText>
                    </TouchableOpacity>
                </View>
            )}

            {/* Scheduled Notifications */}
            {scheduledNotifications.length > 0 && (
                <View style={styles.scheduledSection}>
                    <View style={styles.sectionHeader}>
                        <ThemedText style={styles.sectionTitle}>
                            {t('notification.scheduled.title', 'Scheduled Notifications')}
                        </ThemedText>
                        <TouchableOpacity onPress={cancelAllLocalNotifications} style={styles.clearAllButton}>
                            <ThemedText style={styles.clearAllButtonText}>
                                {t('notification.scheduled.clearAll', 'Clear All')}
                            </ThemedText>
                        </TouchableOpacity>
                    </View>
                    <FlatList
                        data={scheduledNotifications}
                        renderItem={renderScheduledNotificationItem}
                        keyExtractor={(item) => item.identifier}
                        scrollEnabled={false}
                        showsVerticalScrollIndicator={false}
                    />
                </View>
            )}

            {/* Notifications List */}
            <FlatList
                data={filteredNotifications}
                renderItem={renderNotificationItem}
                keyExtractor={(item) => item.id}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={colors.primary}
                    />
                }
                ListEmptyComponent={renderEmptyState}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContainer}
            />

            {/* Error State */}
            {error && (
                <View style={styles.errorContainer}>
                    <ThemedText style={styles.errorText}>{error}</ThemedText>
                    <TouchableOpacity onPress={handleRefresh} style={styles.retryButton}>
                        <ThemedText style={styles.retryButtonText}>
                            {t('common.retry', 'Retry')}
                        </ThemedText>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 18,
        fontFamily: 'Cereal-Bold',
        color: colors.primaryDark,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    markAllButton: {
        padding: 8,
        marginRight: 8,
    },
    settingsButton: {
        padding: 8,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginVertical: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: colors.surface,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: colors.primaryDark,
        fontFamily: 'Inter-Regular',
    },
    clearButton: {
        padding: 4,
    },
    filterContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingBottom: 12,
        gap: 8,
    },
    filterButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    filterButtonActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    filterButtonText: {
        fontSize: 14,
        fontFamily: 'Inter-Medium',
        color: colors.COLOR_BLACK_LIGHT_5,
    },
    filterButtonTextActive: {
        color: colors.white,
    },
    permissionContainer: {
        margin: 16,
        padding: 16,
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.primary,
    },
    permissionTitle: {
        fontSize: 16,
        fontFamily: 'Cereal-Bold',
        color: colors.text,
        marginBottom: 8,
    },
    permissionMessage: {
        fontSize: 14,
        fontFamily: 'Inter-Regular',
        color: colors.textSecondary,
        marginBottom: 12,
        lineHeight: 20,
    },
    permissionButton: {
        backgroundColor: colors.primary,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignSelf: 'flex-start',
    },
    permissionButtonText: {
        fontSize: 14,
        fontFamily: 'Inter-Medium',
        color: colors.white,
    },
    scheduledSection: {
        marginHorizontal: 16,
        marginBottom: 16,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    sectionTitle: {
        fontSize: 16,
        fontFamily: 'Cereal-Bold',
        color: colors.text,
    },
    clearAllButton: {
        padding: 4,
    },
    clearAllButtonText: {
        fontSize: 14,
        fontFamily: 'Inter-Medium',
        color: colors.primary,
    },
    scheduledNotificationItem: {
        backgroundColor: colors.surface,
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: colors.border,
    },
    scheduledNotificationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    scheduledNotificationTitle: {
        flex: 1,
        fontSize: 14,
        fontFamily: 'Cereal-Medium',
        color: colors.text,
        marginLeft: 8,
    },
    cancelButton: {
        padding: 4,
    },
    scheduledNotificationBody: {
        fontSize: 13,
        fontFamily: 'Inter-Regular',
        color: colors.textSecondary,
        marginBottom: 4,
    },
    scheduledNotificationTime: {
        fontSize: 12,
        fontFamily: 'Inter-Regular',
        color: colors.textTertiary,
    },
    listContainer: {
        flexGrow: 1,
        paddingHorizontal: 16,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 64,
    },
    emptyStateTitle: {
        fontSize: 18,
        fontFamily: 'Cereal-Bold',
        color: colors.text,
        marginTop: 16,
        marginBottom: 8,
    },
    emptyStateMessage: {
        fontSize: 14,
        fontFamily: 'Inter-Regular',
        color: colors.COLOR_BLACK_LIGHT_5,
        textAlign: 'center',
        paddingHorizontal: 32,
        lineHeight: 20,
    },
    errorContainer: {
        padding: 16,
        alignItems: 'center',
    },
    errorText: {
        fontSize: 14,
        fontFamily: 'Inter-Regular',
        color: colors.error,
        textAlign: 'center',
        marginBottom: 12,
    },
    retryButton: {
        backgroundColor: colors.primary,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 6,
    },
    retryButtonText: {
        fontSize: 14,
        fontFamily: 'Inter-Medium',
        color: colors.white,
    },
});
