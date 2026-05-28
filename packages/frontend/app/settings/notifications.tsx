/**
 * Settings → Notifications. Uses Bloom SettingsList primitives for category
 * toggles, Bloom Switch for booleans, Bloom Button for the request-permission
 * CTA and shared ConfirmDialog for the destructive clear-all flow.
 */
import React, { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { toast } from 'sonner';

import { Button } from '@oxyhq/bloom/button';
import { Switch } from '@oxyhq/bloom/switch';
import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxyhq/bloom/settings-list';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';

import { Header } from '@/components/Header';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CardSurface } from '@/components/ui/CardSurface';
import {
  useNotifications,
  type NotificationPreferences,
} from '@/context/NotificationContext';
import {
  createPropertyNotification,
  createMessageNotification,
  createReminderNotification,
  createRepeatingNotification,
} from '@/utils/notifications';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const RowIcon: React.FC<{ name: IoniconName; destructive?: boolean }> = ({
  name,
  destructive,
}) => (
  <Ionicons
    name={name}
    size={20}
    color={destructive ? colors.danger : colors.muted}
  />
);

interface PreferenceRow {
  key: keyof NotificationPreferences;
  title: string;
  description: string;
  icon: IoniconName;
}

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const {
    preferences,
    hasPermission,
    updatePreferences,
    requestPermissions,
    clearBadgeCount,
  } = useNotifications();

  const [isUpdating, setIsUpdating] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handlePreferenceChange = useCallback(
    async (key: keyof NotificationPreferences, value: boolean): Promise<void> => {
      try {
        setIsUpdating(true);
        await updatePreferences({ [key]: value });
        toast.success(t('notification.settings.updated', 'Settings updated'));
      } catch {
        toast.error(t('notification.settings.error', 'Failed to update settings'));
      } finally {
        setIsUpdating(false);
      }
    },
    [updatePreferences, t],
  );

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
    } catch {
      toast.error(
        t('notification.permissions.error', 'Failed to request permissions'),
      );
    }
  }, [requestPermissions, t]);

  const handleClearAll = useCallback(async () => {
    try {
      setClearing(true);
      await clearBadgeCount();
      toast.success(
        t('notification.clearAll.success', 'All notifications cleared'),
      );
    } catch {
      toast.error(
        t('notification.clearAll.error', 'Failed to clear notifications'),
      );
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }, [clearBadgeCount, t]);

  const categoryRows: PreferenceRow[] = [
    {
      key: 'property',
      title: t('notification.settings.property.title', 'Property notifications'),
      description: t(
        'notification.settings.property.description',
        'New properties, price changes, and viewing reminders',
      ),
      icon: 'home-outline',
    },
    {
      key: 'message',
      title: t('notification.settings.message.title', 'Message notifications'),
      description: t(
        'notification.settings.message.description',
        'New messages from agents, landlords, and other users',
      ),
      icon: 'chatbubble-outline',
    },
    {
      key: 'contract',
      title: t('notification.settings.contract.title', 'Contract notifications'),
      description: t(
        'notification.settings.contract.description',
        'Contract updates, signatures, and important deadlines',
      ),
      icon: 'document-text-outline',
    },
    {
      key: 'payment',
      title: t('notification.settings.payment.title', 'Payment notifications'),
      description: t(
        'notification.settings.payment.description',
        'Payment confirmations, reminders, and receipts',
      ),
      icon: 'card-outline',
    },
    {
      key: 'reminder',
      title: t('notification.settings.reminder.title', 'Reminder notifications'),
      description: t(
        'notification.settings.reminder.description',
        'Viewing reminders, application deadlines, and follow-ups',
      ),
      icon: 'alarm-outline',
    },
    {
      key: 'system',
      title: t('notification.settings.system.title', 'System notifications'),
      description: t(
        'notification.settings.system.description',
        'App updates, maintenance, and important announcements',
      ),
      icon: 'settings-outline',
    },
    {
      key: 'marketing',
      title: t('notification.settings.marketing.title', 'Marketing notifications'),
      description: t(
        'notification.settings.marketing.description',
        'Promotional offers, newsletters, and special deals',
      ),
      icon: 'megaphone-outline',
    },
  ];

  const behaviorRows: PreferenceRow[] = [
    {
      key: 'sound',
      title: t('notification.settings.sound.title', 'Sound'),
      description: t(
        'notification.settings.sound.description',
        'Play sound when notifications arrive',
      ),
      icon: 'volume-high-outline',
    },
    {
      key: 'badge',
      title: t('notification.settings.badge.title', 'Badge count'),
      description: t(
        'notification.settings.badge.description',
        'Show unread count on the app icon',
      ),
      icon: 'notifications-outline',
    },
    {
      key: 'push',
      title: t('notification.settings.push.title', 'Push notifications'),
      description: t(
        'notification.settings.push.description',
        'Receive notifications even when the app is closed',
      ),
      icon: 'phone-portrait-outline',
    },
  ];

  const testActions: { label: string; icon: IoniconName; run: () => Promise<unknown> }[] = [
    {
      label: t('notification.test.property', 'Test property'),
      icon: 'home-outline',
      run: () =>
        createPropertyNotification(
          'test-property-id',
          'New property available',
          'A new property matching your search criteria is now available.',
          { test: true },
        ),
    },
    {
      label: t('notification.test.message', 'Test message'),
      icon: 'chatbubble-outline',
      run: () =>
        createMessageNotification(
          'test-message-id',
          'John Doe',
          'Hi! I am interested in your property.',
          { test: true },
        ),
    },
    {
      label: t('notification.test.reminder', 'Test reminder'),
      icon: 'alarm-outline',
      run: () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);
        return createReminderNotification(
          'Property viewing reminder',
          'You have a property viewing scheduled for tomorrow at 10:00 AM.',
          tomorrow,
          { test: true },
        );
      },
    },
    {
      label: t('notification.test.repeating', 'Test repeating'),
      icon: 'repeat-outline',
      run: () =>
        createRepeatingNotification(
          'Daily property update',
          'Check out the latest properties in your area.',
          'day',
          { test: true },
        ),
    },
  ];

  const runTest = useCallback(
    async (run: () => Promise<unknown>): Promise<void> => {
      try {
        await run();
        toast.success(
          t('notification.test.success', 'Test notification sent'),
        );
      } catch {
        toast.error(
          t('notification.test.error', 'Failed to send test notification'),
        );
      }
    },
    [t],
  );

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('notification.settings.title', 'Notifications'),
          showBackButton: true,
          titlePosition: 'center',
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.permissionWrap}>
          <CardSurface>
            <View style={styles.permissionHeader}>
              <Ionicons
                name={hasPermission ? 'checkmark-circle' : 'close-circle'}
                size={24}
                color={hasPermission ? colors.online : colors.danger}
              />
              <View style={styles.permissionTextWrap}>
                <H3 style={styles.permissionTitle}>
                  {hasPermission
                    ? t(
                        'notification.permissions.enabled',
                        'Notifications enabled',
                      )
                    : t(
                        'notification.permissions.disabled',
                        'Notifications disabled',
                      )}
                </H3>
                <BloomText style={styles.permissionBody}>
                  {hasPermission
                    ? t(
                        'notification.permissions.enabled.description',
                        'You will receive notifications for enabled categories.',
                      )
                    : t(
                        'notification.permissions.disabled.description',
                        'Enable notifications to receive updates about properties, messages and more.',
                      )}
                </BloomText>
              </View>
            </View>
            {!hasPermission ? (
              <View style={styles.permissionAction}>
                <Button
                  variant="primary"
                  size="medium"
                  onPress={handleRequestPermissions}
                >
                  {t(
                    'notification.permissions.enable',
                    'Enable notifications',
                  )}
                </Button>
              </View>
            ) : null}
          </CardSurface>
        </View>

        <SettingsListGroup
          title={t('notification.settings.categories', 'Notification categories')}
        >
          {categoryRows.map((row) => (
            <SettingsListItem
              key={row.key}
              icon={<RowIcon name={row.icon} />}
              title={row.title}
              description={row.description}
              rightElement={
                <Switch
                  value={preferences[row.key]}
                  onValueChange={(value) =>
                    handlePreferenceChange(row.key, value)
                  }
                  disabled={isUpdating}
                />
              }
            />
          ))}
        </SettingsListGroup>

        <SettingsListGroup
          title={t('notification.settings.behavior', 'Notification behavior')}
        >
          {behaviorRows.map((row) => (
            <SettingsListItem
              key={row.key}
              icon={<RowIcon name={row.icon} />}
              title={row.title}
              description={row.description}
              rightElement={
                <Switch
                  value={preferences[row.key]}
                  onValueChange={(value) =>
                    handlePreferenceChange(row.key, value)
                  }
                  disabled={isUpdating}
                />
              }
            />
          ))}
        </SettingsListGroup>

        {hasPermission ? (
          <SettingsListGroup
            title={t('notification.settings.test', 'Test notifications')}
            footer={t(
              'notification.settings.test.description',
              'Send test notifications to verify your settings are working correctly.',
            )}
          >
            {testActions.map((action) => (
              <SettingsListItem
                key={action.label}
                icon={<RowIcon name={action.icon} />}
                title={action.label}
                onPress={() => runTest(action.run)}
              />
            ))}
          </SettingsListGroup>
        ) : null}

        <SettingsListGroup
          title={t('notification.settings.manage', 'Manage notifications')}
        >
          <SettingsListItem
            icon={<RowIcon name="trash-outline" destructive />}
            title={t('notification.settings.clearAll', 'Clear all notifications')}
            destructive
            onPress={() => setConfirmClear(true)}
          />
        </SettingsListGroup>

        {Platform.OS === 'ios' ? (
          <SettingsListGroup
            title={t('notification.settings.ios.title', 'iOS settings')}
            footer={t(
              'notification.settings.ios.description',
              "For more granular control, manage notifications in Settings > Notifications > Homiio.",
            )}
          >
            <SettingsListItem
              icon={<RowIcon name="information-circle-outline" />}
              title={t(
                'notification.settings.ios.openSettings',
                'Open system settings',
              )}
              onPress={() => {
                /* surfaced as guidance only */
              }}
              showChevron={false}
            />
          </SettingsListGroup>
        ) : null}

        {Platform.OS === 'android' ? (
          <SettingsListGroup
            title={t('notification.settings.android.title', 'Android settings')}
            footer={t(
              'notification.settings.android.description',
              "Manage notification channels in Settings > Apps > Homiio > Notifications.",
            )}
          >
            <SettingsListItem
              icon={<RowIcon name="information-circle-outline" />}
              title={t(
                'notification.settings.android.openSettings',
                'Open system settings',
              )}
              onPress={() => {
                /* surfaced as guidance only */
              }}
              showChevron={false}
            />
          </SettingsListGroup>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={confirmClear}
        title={t('notification.clearAll.title', 'Clear all notifications')}
        message={t(
          'notification.clearAll.message',
          'This will clear all notifications and reset the badge count. This action cannot be undone.',
        )}
        confirmLabel={t('common.clear', 'Clear all')}
        confirmDestructive
        loading={clearing}
        onConfirm={handleClearAll}
        onCancel={() => setConfirmClear(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  permissionWrap: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  permissionHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  permissionTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  permissionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  permissionBody: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  permissionAction: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
});
