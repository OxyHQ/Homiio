/**
 * Inbox — the user's notification feed (Airbnb-2026).
 *
 * This is a notifications screen (not a chat/conversation list): it renders
 * server-backed `Notification`s from `NotificationContext`, with optional
 * locally-scheduled reminders surfaced in their own section. The screen is a
 * tab root, so it owns a left-aligned `Header` (no back button) with mark-all
 * -read + settings actions on the right.
 *
 * Layout, top → bottom:
 *   Header (title + actions)
 *   SearchInput + All/Unread SegmentedControl   (flat controls strip)
 *   [permission notice]   (only when notifications are disabled)
 *   [scheduled reminders] (only when present)
 *   Notification list  →  skeleton / error / empty / rows
 *
 * Flat aesthetic: the page uses `colors.background`, rows have no card shadow,
 * and loading/empty/error all route through the shared primitives. Relative
 * timestamps come from the centralised locale-aware `formatRelativeTime`.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type ListRenderItem,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type * as Notifications from 'expo-notifications';

import * as SegmentedControl from '@oxyhq/bloom/segmented-control';
import { SearchInput } from '@oxyhq/bloom/search-input';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { useNotifications } from '@/context/NotificationContext';
import { NotificationItem } from '@/components/NotificationItem';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { formatRelativeTime } from '@/utils/dateLocale';
import { toast } from '@/lib/sonner';
import type { Notification } from '@/services/notificationService';
import { logger } from '@/utils/logger';

type InboxFilter = 'all' | 'unread';

/**
 * Bundled illustration for the empty inbox. Resolved once at module load so
 * the `<Image>` source identity is stable across renders.
 */
const EMPTY_INBOX_ILLUSTRATION: ImageSourcePropType = require('@/assets/illustrations/empty-inbox.png');

/**
 * Safely reads the scheduled date from an Expo notification trigger. Only
 * date-based triggers carry a `date`; other trigger kinds return undefined.
 */
const getTriggerDate = (
  trigger: Notifications.NotificationRequest['trigger'],
): Date | number | undefined => {
  if (trigger && typeof trigger === 'object' && 'date' in trigger) {
    return (trigger as { date?: Date | number }).date;
  }
  return undefined;
};

export default function InboxScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    notifications,
    scheduledNotifications,
    unreadCount,
    isLoading,
    error,
    hasPermission,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    cancelLocalNotification,
    cancelAllLocalNotifications,
    requestPermissions,
    refreshAll,
  } = useNotifications();

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const isFiltered = filter !== 'all' || searchQuery.trim().length > 0;

  const filteredNotifications = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return notifications.filter((notification) => {
      if (filter === 'unread' && notification.read) return false;
      if (!query) return true;
      return (
        notification.title.toLowerCase().includes(query) ||
        notification.message.toLowerCase().includes(query) ||
        notification.type.toLowerCase().includes(query)
      );
    });
  }, [notifications, filter, searchQuery]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } catch (refreshError: unknown) {
      logger.error('Failed to refresh notifications:', refreshError);
    } finally {
      setRefreshing(false);
    }
  }, [refreshAll]);

  const handleNotificationPress = useCallback(
    async (notification: Notification) => {
      try {
        if (!notification.read) {
          await markAsRead(notification.id);
        }

        const screen = notification.data?.screen;
        if (typeof screen === 'string') {
          router.push(screen);
        } else if (
          notification.type === 'property' &&
          notification.data?.propertyId
        ) {
          router.push(`/properties/${notification.data.propertyId}`);
        } else if (notification.type === 'message') {
          router.push('/messages');
        } else if (notification.type === 'contract') {
          router.push('/contracts');
        } else if (notification.type === 'payment') {
          router.push('/payments');
        }
      } catch (pressError: unknown) {
        logger.error('Failed to handle notification press:', pressError);
      }
    },
    [markAsRead, router],
  );

  const handleDeleteNotification = useCallback(
    (notification: Notification) => {
      Alert.alert(
        t('notification.delete.title', 'Delete Notification'),
        t(
          'notification.delete.message',
          'Are you sure you want to delete this notification?',
        ),
        [
          { text: t('common.cancel', 'Cancel'), style: 'cancel' },
          {
            text: t('common.delete', 'Delete'),
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteNotification(notification.id);
                toast.success(
                  t('notification.delete.success', 'Notification deleted'),
                );
              } catch (deleteError: unknown) {
                logger.error(
                  'Failed to delete notification:',
                  deleteError,
                );
                toast.error(
                  t(
                    'notification.delete.error',
                    'Failed to delete notification',
                  ),
                );
              }
            },
          },
        ],
      );
    },
    [deleteNotification, t],
  );

  const handleMarkAllAsRead = useCallback(async () => {
    try {
      await markAllAsRead();
      toast.success(
        t('notification.markAllRead.success', 'All notifications marked as read'),
      );
    } catch (markError: unknown) {
      logger.error('Failed to mark all notifications as read:', markError);
      toast.error(
        t('notification.markAllRead.error', 'Failed to mark all as read'),
      );
    }
  }, [markAllAsRead, t]);

  const handleRequestPermissions = useCallback(async () => {
    try {
      const granted = await requestPermissions();
      if (granted) {
        toast.success(
          t('notification.permissions.granted', 'Notification permissions granted'),
        );
      } else {
        toast.error(
          t('notification.permissions.denied', 'Notification permissions denied'),
        );
      }
    } catch (permissionError: unknown) {
      logger.error(
        'Failed to request notification permissions:',
        permissionError,
      );
      toast.error(
        t('notification.permissions.error', 'Failed to request permissions'),
      );
    }
  }, [requestPermissions, t]);

  const renderNotificationItem = useCallback<ListRenderItem<Notification>>(
    ({ item }) => (
      <NotificationItem
        type={item.type}
        title={item.title}
        description={item.message}
        time={formatRelativeTime(new Date(item.createdAt))}
        read={item.read}
        onPress={() => handleNotificationPress(item)}
        onLongPress={() => handleDeleteNotification(item)}
      />
    ),
    [handleNotificationPress, handleDeleteNotification],
  );

  const header = (
    <Header
      options={{
        title: t('inbox.title', 'Inbox'),
        titlePosition: 'left',
        rightComponents: [
          unreadCount > 0 ? (
            <HeaderIconButton
              key="mark-all"
              icon="checkmark-done"
              color={colors.primaryColor}
              accessibilityLabel={t(
                'notification.markAllRead.action',
                'Mark all as read',
              )}
              onPress={handleMarkAllAsRead}
            />
          ) : null,
          <HeaderIconButton
            key="settings"
            icon="settings-outline"
            color={colors.COLOR_BLACK_LIGHT_2}
            accessibilityLabel={t(
              'notification.settings.title',
              'Notification Settings',
            )}
            onPress={() => router.push('/settings/notifications')}
          />,
        ],
      }}
    />
  );

  const listHeader = (
    <View style={styles.listHeader}>
      {!hasPermission ? (
        <Pressable
          onPress={handleRequestPermissions}
          accessibilityRole="button"
          style={styles.permissionNotice}
        >
          <View style={styles.permissionIcon}>
            <Ionicons
              name="notifications-off-outline"
              size={20}
              color={colors.primaryColor}
            />
          </View>
          <View style={styles.permissionText}>
            <BloomText style={styles.permissionTitle}>
              {t('notification.permissions.title', 'Enable Notifications')}
            </BloomText>
            <BloomText style={styles.permissionMessage}>
              {t(
                'notification.permissions.message',
                'Get notified about new properties, messages, and important updates.',
              )}
            </BloomText>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textTertiary}
          />
        </Pressable>
      ) : null}

      {scheduledNotifications.length > 0 ? (
        <View style={styles.scheduledSection}>
          <View style={styles.sectionHeaderRow}>
            <H3 style={styles.sectionTitle}>
              {t('notification.scheduled.title', 'Scheduled Notifications')}
            </H3>
            <Pressable
              onPress={cancelAllLocalNotifications}
              accessibilityRole="button"
              hitSlop={8}
            >
              <BloomText style={styles.clearAllText}>
                {t('notification.scheduled.clearAll', 'Clear All')}
              </BloomText>
            </Pressable>
          </View>
          {scheduledNotifications.map((item) => (
            <ScheduledRow
              key={item.identifier}
              request={item}
              onCancel={() => cancelLocalNotification(item.identifier)}
              scheduledLabel={t(
                'notification.scheduled.label',
                'Scheduled notification',
              )}
            />
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      {header}

      <View style={styles.controls}>
        <SearchInput
          value={searchQuery}
          label={t('notification.search.placeholder', 'Search notifications')}
          onChangeText={setSearchQuery}
          onClearText={() => setSearchQuery('')}
        />

        <SegmentedControl.Root<InboxFilter>
          label={t('notification.filter.label', 'Filter notifications')}
          type="tabs"
          value={filter}
          onChange={setFilter}
        >
          <SegmentedControl.Item value="all">
            <SegmentedControl.ItemText>
              {t('notification.filter.all', 'All')}
            </SegmentedControl.ItemText>
          </SegmentedControl.Item>
          <SegmentedControl.Item value="unread">
            <SegmentedControl.ItemText>
              {unreadCount > 0
                ? `${t('notification.filter.unread', 'Unread')} · ${unreadCount}`
                : t('notification.filter.unread', 'Unread')}
            </SegmentedControl.ItemText>
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      </View>

      {isLoading && notifications.length === 0 ? (
        <View style={styles.stateWrap}>
          <ListSkeleton rows={6} rowHeight={64} />
        </View>
      ) : error ? (
        <View style={styles.stateWrap}>
          <ErrorState
            title={t('error.load_notifications', "We couldn't load your inbox")}
            description={
              typeof error === 'string'
                ? error
                : t('common.tryAgain', 'Please try again.')
            }
            retryLabel={t('common.retry', 'Retry')}
            onRetry={handleRefresh}
          />
        </View>
      ) : (
        <FlatList
          data={filteredNotifications}
          renderItem={renderNotificationItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={listHeader}
          ItemSeparatorComponent={ListSeparator}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primaryColor]}
              tintColor={colors.primaryColor}
            />
          }
          ListEmptyComponent={
            isFiltered ? (
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon="filter-outline"
                  title={t('notification.empty.filteredTitle', 'No matches')}
                  description={t(
                    'notification.empty.filtered',
                    'No notifications match your current filter',
                  )}
                />
              </View>
            ) : (
              <View style={styles.illustrationEmpty}>
                <Image
                  source={EMPTY_INBOX_ILLUSTRATION}
                  style={styles.illustrationImage}
                  contentFit="contain"
                  accessibilityIgnoresInvertColors
                />
                <H3 style={styles.illustrationTitle}>
                  {t('notification.empty.title', 'No notifications')}
                </H3>
                <BloomText style={styles.illustrationMessage}>
                  {t(
                    'notification.empty.message',
                    "You're all caught up! New notifications will appear here.",
                  )}
                </BloomText>
              </View>
            )
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface HeaderIconButtonProps {
  icon: IoniconName;
  color: string;
  accessibilityLabel: string;
  onPress: () => void;
}

/**
 * Round, tappable header action. Owns its pressed state (NativeWind v4 can't
 * use the function-form `style`), giving a subtle tint on press.
 */
const HeaderIconButton: React.FC<HeaderIconButtonProps> = ({
  icon,
  color,
  accessibilityLabel,
  onPress,
}) => {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={[styles.headerButton, pressed && styles.headerButtonPressed]}
    >
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
};

interface ScheduledRowProps {
  request: Notifications.NotificationRequest;
  onCancel: () => void;
  scheduledLabel: string;
}

/**
 * A single locally-scheduled reminder. Flat surface (no shadow) with a cancel
 * affordance; surfaced above the server feed so users can manage pending
 * reminders.
 */
const ScheduledRow: React.FC<ScheduledRowProps> = ({
  request,
  onCancel,
  scheduledLabel,
}) => {
  const triggerDate = getTriggerDate(request.trigger);
  const when = triggerDate
    ? formatRelativeTime(new Date(triggerDate))
    : scheduledLabel;

  return (
    <View style={styles.scheduledRow}>
      <View style={styles.scheduledIcon}>
        <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
      </View>
      <View style={styles.scheduledContent}>
        <BloomText style={styles.scheduledTitle} numberOfLines={1}>
          {request.content.title}
        </BloomText>
        {request.content.body ? (
          <BloomText style={styles.scheduledBody} numberOfLines={1}>
            {request.content.body}
          </BloomText>
        ) : null}
        <BloomText style={styles.scheduledTime}>{when}</BloomText>
      </View>
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        hitSlop={8}
        style={styles.scheduledCancel}
      >
        <Ionicons name="close" size={18} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
};

const ListSeparator: React.FC = () => <View style={styles.separator} />;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonPressed: {
    backgroundColor: colors.mutedSubtle,
  },
  controls: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: spacing['4xl'],
  },
  listHeader: {
    gap: spacing.lg,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.lg + 44 + spacing.md,
  },
  // --- Permission notice ---
  permissionNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.infoSubtle,
  },
  permissionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  permissionText: {
    flex: 1,
    gap: spacing.xs,
  },
  permissionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  permissionMessage: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  // --- Scheduled section ---
  scheduledSection: {
    marginHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  clearAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primaryColor,
  },
  scheduledRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  scheduledIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mutedSubtle,
  },
  scheduledContent: {
    flex: 1,
    gap: spacing.xs,
  },
  scheduledTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  scheduledBody: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  scheduledTime: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  scheduledCancel: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // --- States ---
  stateWrap: {
    flex: 1,
    padding: spacing.lg,
  },
  emptyWrap: {
    paddingVertical: spacing['4xl'],
  },
  // --- Illustration empty state (image-forward, hero) ---
  illustrationEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['5xl'],
    paddingHorizontal: spacing['2xl'],
    minHeight: 320,
  },
  illustrationImage: {
    width: 200,
    height: 200,
    marginBottom: spacing.xl,
  },
  illustrationTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  illustrationMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
});
