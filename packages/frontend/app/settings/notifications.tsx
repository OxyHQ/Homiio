/**
 * Settings → Notifications. Uses Bloom SettingsList primitives for category
 * toggles, Bloom Switch for booleans, Bloom Button for the request-permission
 * CTA and shared ConfirmDialog for the destructive clear-all flow.
 */
import React, { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '@/lib/sonner';

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
    clearAllNotifications,
  } = useNotifications();

  const [isUpdating, setIsUpdating] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handlePreferenceChange = useCallback(
    async (key: keyof NotificationPreferences, value: boolean): Promise<void> => {
      try {
        setIsUpdating(true);
        await updatePreferences({ [key]: value });
        toast.success(t('notification.settings.updated'));
      } catch {
        toast.error(t('notification.settings.error'));
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
          t('notification.permissions.granted'),
        );
      } else {
        toast.error(
          t('notification.permissions.denied'),
        );
      }
    } catch {
      toast.error(
        t('notification.permissions.error'),
      );
    }
  }, [requestPermissions, t]);

  const handleClearAll = useCallback(async () => {
    try {
      setClearing(true);
      await clearAllNotifications();
      toast.success(
        t('notification.clearAll.success'),
      );
    } catch {
      toast.error(
        t('notification.clearAll.error'),
      );
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }, [clearAllNotifications, t]);

  const categoryRows: PreferenceRow[] = [
    {
      key: 'property',
      title: t('notification.settings.property.title'),
      description: t('notification.settings.property.description'),
      icon: 'home-outline',
    },
    {
      key: 'message',
      title: t('notification.settings.message.title'),
      description: t('notification.settings.message.description'),
      icon: 'chatbubble-outline',
    },
    {
      key: 'contract',
      title: t('notification.settings.contract.title'),
      description: t('notification.settings.contract.description'),
      icon: 'document-text-outline',
    },
    {
      key: 'payment',
      title: t('notification.settings.payment.title'),
      description: t('notification.settings.payment.description'),
      icon: 'card-outline',
    },
    {
      key: 'reminder',
      title: t('notification.settings.reminder.title'),
      description: t('notification.settings.reminder.description'),
      icon: 'alarm-outline',
    },
    {
      key: 'system',
      title: t('notification.settings.system.title'),
      description: t('notification.settings.system.description'),
      icon: 'settings-outline',
    },
    {
      key: 'marketing',
      title: t('notification.settings.marketing.title'),
      description: t('notification.settings.marketing.description'),
      icon: 'megaphone-outline',
    },
  ];

  const behaviorRows: PreferenceRow[] = [
    {
      key: 'sound',
      title: t('notification.settings.sound.title'),
      description: t('notification.settings.sound.description'),
      icon: 'volume-high-outline',
    },
    {
      key: 'badge',
      title: t('notification.settings.badge.title'),
      description: t('notification.settings.badge.description'),
      icon: 'notifications-outline',
    },
    {
      key: 'push',
      title: t('notification.settings.push.title'),
      description: t('notification.settings.push.description'),
      icon: 'phone-portrait-outline',
    },
  ];

  const testActions: { label: string; icon: IoniconName; run: () => Promise<unknown> }[] = [
    {
      label: t('notification.test.property'),
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
      label: t('notification.test.message'),
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
      label: t('notification.test.reminder'),
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
      label: t('notification.test.repeating'),
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
          t('notification.test.success'),
        );
      } catch {
        toast.error(
          t('notification.test.error'),
        );
      }
    },
    [t],
  );

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('notification.settings.title'),
          showBackButton: true,
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
                    ? t('notification.permissions.enabled.title')
                    : t('notification.permissions.disabled.title')}
                </H3>
                <BloomText style={styles.permissionBody}>
                  {hasPermission
                    ? t('notification.permissions.enabled.description')
                    : t('notification.permissions.disabled.description')}
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
                  {t('notification.permissions.enable')}
                </Button>
              </View>
            ) : null}
          </CardSurface>
        </View>

        <SettingsListGroup
          title={t('notification.settings.categories')}
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
          title={t('notification.settings.behavior')}
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

        {__DEV__ && hasPermission ? (
          <SettingsListGroup
            title={t('notification.settings.test.title')}
            footer={t('notification.settings.test.description')}
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
          title={t('notification.settings.manage')}
        >
          <SettingsListItem
            icon={<RowIcon name="trash-outline" destructive />}
            title={t('notification.settings.clearAll')}
            destructive
            onPress={() => setConfirmClear(true)}
          />
        </SettingsListGroup>

        {Platform.OS === 'ios' ? (
          <SettingsListGroup
            title={t('notification.settings.ios.title')}
            footer={t('notification.settings.ios.description')}
          >
            <SettingsListItem
              icon={<RowIcon name="information-circle-outline" />}
              title={t('notification.settings.ios.openSettings')}
              onPress={() => {
                /* surfaced as guidance only */
              }}
              showChevron={false}
            />
          </SettingsListGroup>
        ) : null}

        {Platform.OS === 'android' ? (
          <SettingsListGroup
            title={t('notification.settings.android.title')}
            footer={t('notification.settings.android.description')}
          >
            <SettingsListItem
              icon={<RowIcon name="information-circle-outline" />}
              title={t('notification.settings.android.openSettings')}
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
        title={t('notification.clearAll.title')}
        message={t('notification.clearAll.message')}
        confirmLabel={t('common.clear')}
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
    backgroundColor: colors.background,
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
