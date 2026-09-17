/**
 * Inbox — the user's notification feed.
 *
 * This is a notifications screen (not a chat/conversation list): it renders
 * server-backed `Notification`s from `NotificationContext`, with optional
 * locally-scheduled reminders surfaced in their own section. The screen is a
 * tab root, so it owns a `Header` (no back button) with mark-all-read +
 * settings actions on the right.
 *
 * Layout, top → bottom:
 *   Header (title + mark-all-read / settings icon buttons)
 *   Search + All/Unread SegmentedControl   (flat controls strip)
 *   [permission Admonition]   (only when notifications are disabled)
 *   [scheduled reminders]     (a SettingsListGroup, only when present)
 *   Notification list  →  skeleton / error / empty / `NotificationItem` rows
 *
 * Bloom's `NotificationCenter` was considered and not used: it is a fixed-size
 * popover panel with its own All/Mentions/System tabs and local read state,
 * and no row press (deep links), search or delete — all of which this screen
 * needs. Rows are Bloom `Item`s instead (see `NotificationItem`). Deletes ask
 * through `confirm()`; relative timestamps come from `formatRelativeTime`.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type ListRenderItem,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import type * as Notifications from 'expo-notifications';

import {
  AdmonitionButton,
  AdmonitionContent,
  AdmonitionIcon,
  AdmonitionRoot,
  AdmonitionRow,
  AdmonitionText,
} from '@oxy.so/bloom/admonition';
import { Button, CloseButton } from '@oxy.so/bloom/button';
import {
  RiCheckboxCircleLine,
  RiFilterLine,
  RiSettings3Line,
  RiTimeLine,
} from '@oxy.so/bloom/icons';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { Search } from '@oxy.so/bloom/search';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { H3, Text as BloomText } from '@oxy.so/bloom/typography';

import { useNotifications } from '@/context/NotificationContext';
import { NotificationItem } from '@/components/NotificationItem';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { contentClamp, spacing } from '@/constants/styles';
import { formatRelativeTime } from '@/utils/dateLocale';
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
  const { colors: theme } = useTheme();
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

        // Prefer the producer-supplied deep link; every screen we emit is a real
        // route. Fall back to type-based routing for legacy notifications, and
        // only to routes that actually exist in the app.
        const screen = notification.data?.screen;
        if (typeof screen === 'string') {
          router.push(screen);
        } else if (notification.type === 'property' && notification.data?.propertyId) {
          router.push(`/properties/${notification.data.propertyId}`);
        } else if (notification.data?.evictionId) {
          router.push(`/evictions/${notification.data.evictionId}`);
        } else if (notification.type === 'contract') {
          router.push('/contracts');
        } else if (notification.type === 'roommate') {
          router.push('/roommates');
        }
      } catch (pressError: unknown) {
        logger.error('Failed to handle notification press:', pressError);
      }
    },
    [markAsRead, router],
  );

  const handleDeleteNotification = useCallback(
    async (notification: Notification) => {
      const ok = await confirm({
        title: t('notification.delete.title'),
        description: t('notification.delete.message'),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!ok) return;
      try {
        await deleteNotification(notification.id);
        toast.success(t('notification.delete.success'));
      } catch (deleteError: unknown) {
        logger.error('Failed to delete notification:', deleteError);
        toast.error(t('notification.delete.error'));
      }
    },
    [deleteNotification, t],
  );

  const handleMarkAllAsRead = useCallback(async () => {
    try {
      await markAllAsRead();
      toast.success(t('notification.markAllRead.success'));
    } catch (markError: unknown) {
      logger.error('Failed to mark all notifications as read:', markError);
      toast.error(t('notification.markAllRead.error'));
    }
  }, [markAllAsRead, t]);

  const handleRequestPermissions = useCallback(async () => {
    try {
      const granted = await requestPermissions();
      if (granted) {
        toast.success(t('notification.permissions.granted'));
      } else {
        toast.error(t('notification.permissions.denied'));
      }
    } catch (permissionError: unknown) {
      logger.error('Failed to request notification permissions:', permissionError);
      toast.error(t('notification.permissions.error'));
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
        onPress={() => void handleNotificationPress(item)}
        onLongPress={() => void handleDeleteNotification(item)}
        onDelete={() => void handleDeleteNotification(item)}
      />
    ),
    [handleNotificationPress, handleDeleteNotification],
  );

  const header = (
    <Header
      options={{
        title: t('inbox.title'),
        rightComponents: [
          unreadCount > 0 ? (
            <Button
              key="mark-all"
              variant="ghost"
              iconOnly
              leadingIcon={RiCheckboxCircleLine}
              accessibilityLabel={t('notification.markAllRead.action')}
              onPress={() => void handleMarkAllAsRead()}
            />
          ) : null,
          <Button
            key="settings"
            variant="ghost"
            iconOnly
            leadingIcon={RiSettings3Line}
            accessibilityLabel={t('notification.settings.title')}
            onPress={() => router.push('/settings/notifications')}
          />,
        ],
      }}
    />
  );

  const listHeader = (
    <View style={styles.listHeader}>
      {!hasPermission ? (
        <AdmonitionRoot type="info">
          <AdmonitionRow>
            <AdmonitionIcon />
            <AdmonitionContent>
              <AdmonitionText style={styles.permissionTitle}>
                {t('notification.permissions.title')}
              </AdmonitionText>
              <AdmonitionText>{t('notification.permissions.message')}</AdmonitionText>
              <AdmonitionButton onPress={() => void handleRequestPermissions()}>
                {t('notification.permissions.enable')}
              </AdmonitionButton>
            </AdmonitionContent>
          </AdmonitionRow>
        </AdmonitionRoot>
      ) : null}

      {scheduledNotifications.length > 0 ? (
        <SettingsListGroup title={t('notification.scheduled.title')}>
          {scheduledNotifications.map((item) => (
            <ScheduledRow
              key={item.identifier}
              request={item}
              onCancel={() => cancelLocalNotification(item.identifier)}
              scheduledLabel={t('notification.scheduled.label')}
              cancelLabel={t('common.cancel')}
            />
          ))}
          <SettingsListItem
            title={t('notification.scheduled.clearAll')}
            destructive
            showChevron={false}
            onPress={() => void cancelAllLocalNotifications()}
          />
        </SettingsListGroup>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {header}

      <View style={styles.controls}>
        <Search
          value={searchQuery}
          label={t('notification.search.placeholder')}
          onChangeText={setSearchQuery}
          onClearText={() => setSearchQuery('')}
        />

        <SegmentedControl<InboxFilter>
          label={t('notification.filter.label')}
          type="tabs"
          value={filter}
          onChange={setFilter}
        >
          <SegmentedControlItem value="all">
            <SegmentedControlItemText>{t('notification.filter.all')}</SegmentedControlItemText>
          </SegmentedControlItem>
          <SegmentedControlItem value="unread">
            <SegmentedControlItemText>
              {unreadCount > 0
                ? `${t('notification.filter.unread')} · ${unreadCount}`
                : t('notification.filter.unread')}
            </SegmentedControlItemText>
          </SegmentedControlItem>
        </SegmentedControl>
      </View>

      {isLoading && notifications.length === 0 ? (
        <View style={styles.stateWrap}>
          <ListSkeleton rows={6} rowHeight={64} />
        </View>
      ) : error ? (
        <View style={styles.stateWrap}>
          <ErrorState
            title={t('error.loadNotifications')}
            description={typeof error === 'string' ? error : t('common.tryAgain')}
            retryLabel={t('common.retry')}
            onRetry={handleRefresh}
          />
        </View>
      ) : (
        <FlatList
          data={filteredNotifications}
          renderItem={renderNotificationItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={listHeader}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[theme.primary]}
              tintColor={theme.primary}
            />
          }
          ListEmptyComponent={
            isFiltered ? (
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon={RiFilterLine}
                  title={t('notification.empty.filteredTitle')}
                  description={t('notification.empty.filtered')}
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
                <H3 style={[styles.illustrationTitle, { color: theme.text }]}>
                  {t('notification.empty.title')}
                </H3>
                <BloomText style={[styles.illustrationMessage, { color: theme.textSecondary }]}>
                  {t('notification.empty.message')}
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

interface ScheduledRowProps {
  request: Notifications.NotificationRequest;
  onCancel: () => void;
  scheduledLabel: string;
  cancelLabel: string;
}

/** A single locally-scheduled reminder, cancellable in place. */
const ScheduledRow: React.FC<ScheduledRowProps> = ({
  request,
  onCancel,
  scheduledLabel,
  cancelLabel,
}) => {
  const { colors: theme } = useTheme();
  const triggerDate = getTriggerDate(request.trigger);
  const when = triggerDate ? formatRelativeTime(new Date(triggerDate)) : scheduledLabel;

  return (
    <SettingsListItem
      icon={<RiTimeLine width={20} height={20} fill={theme.textSecondary} />}
      title={request.content.title ?? scheduledLabel}
      description={request.content.body ? `${request.content.body} · ${when}` : when}
      rightElement={<CloseButton size="xs" accessibilityLabel={cancelLabel} onPress={onCancel} />}
    />
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  controls: {
    width: '100%',
    maxWidth: contentClamp.copy,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  listContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: contentClamp.copy,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['4xl'],
    gap: spacing.xs,
  },
  listHeader: {
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  permissionTitle: {
    fontWeight: '700',
  },
  stateWrap: {
    flex: 1,
    padding: spacing.lg,
  },
  emptyWrap: {
    paddingVertical: spacing['4xl'],
  },
  // Illustration empty state (image-forward, hero)
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
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  illustrationMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
});
