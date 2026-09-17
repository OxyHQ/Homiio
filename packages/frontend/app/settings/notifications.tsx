/**
 * Settings → Notifications. Bloom SettingsList primitives for category
 * toggles, Bloom Switch for booleans, a Bloom `Admonition` (with its enable
 * button) while permission is missing, and `confirm()` for clear-all.
 */
import React, { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { toast } from '@oxy.so/bloom/toast';

import {
  AdmonitionButton,
  AdmonitionContent,
  AdmonitionIcon,
  AdmonitionRoot,
  AdmonitionRow,
  AdmonitionText,
} from '@oxy.so/bloom/admonition';
import {
  RiBankCardLine,
  RiChat3Line,
  RiCheckboxCircleFill,
  RiDeleteBinLine,
  RiFileTextLine,
  RiHomeLine,
  RiInformationLine,
  RiMegaphoneLine,
  RiNotification3Line,
  RiRepeatLine,
  RiSettings3Line,
  RiSmartphoneLine,
  RiTimeLine,
  RiVolumeUpLine,
} from '@oxy.so/bloom/icons';
import { Switch } from '@oxy.so/bloom/switch';
import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxy.so/bloom/settings-list';
import { useTheme } from '@oxy.so/bloom/theme';

import { Header } from '@/components/Header';
import { confirm } from '@oxy.so/bloom/surfaces';
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
import {
  SettingsRowIcon,
  settingsScreenStyles,
  type SettingsIconComponent,
} from '@/components/profile/SettingsRowIcon';
import { spacing } from '@/constants/styles';

interface PreferenceRow {
  key: keyof NotificationPreferences;
  title: string;
  description: string;
  icon: SettingsIconComponent;
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
  const { colors: theme } = useTheme();

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
    const ok = await confirm({
      title: t('notification.clearAll.title'),
      description: t('notification.clearAll.message'),
      confirmLabel: t('common.clear'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await clearAllNotifications();
      toast.success(
        t('notification.clearAll.success'),
      );
    } catch {
      toast.error(
        t('notification.clearAll.error'),
      );
    }
  }, [clearAllNotifications, t]);

  const categoryRows: PreferenceRow[] = [
    {
      key: 'property',
      title: t('notification.settings.property.title'),
      description: t('notification.settings.property.description'),
      icon: RiHomeLine,
    },
    {
      key: 'message',
      title: t('notification.settings.message.title'),
      description: t('notification.settings.message.description'),
      icon: RiChat3Line,
    },
    {
      key: 'contract',
      title: t('notification.settings.contract.title'),
      description: t('notification.settings.contract.description'),
      icon: RiFileTextLine,
    },
    {
      key: 'payment',
      title: t('notification.settings.payment.title'),
      description: t('notification.settings.payment.description'),
      icon: RiBankCardLine,
    },
    {
      key: 'reminder',
      title: t('notification.settings.reminder.title'),
      description: t('notification.settings.reminder.description'),
      icon: RiTimeLine,
    },
    {
      key: 'system',
      title: t('notification.settings.system.title'),
      description: t('notification.settings.system.description'),
      icon: RiSettings3Line,
    },
    {
      key: 'marketing',
      title: t('notification.settings.marketing.title'),
      description: t('notification.settings.marketing.description'),
      icon: RiMegaphoneLine,
    },
  ];

  const behaviorRows: PreferenceRow[] = [
    {
      key: 'sound',
      title: t('notification.settings.sound.title'),
      description: t('notification.settings.sound.description'),
      icon: RiVolumeUpLine,
    },
    {
      key: 'badge',
      title: t('notification.settings.badge.title'),
      description: t('notification.settings.badge.description'),
      icon: RiNotification3Line,
    },
    {
      key: 'push',
      title: t('notification.settings.push.title'),
      description: t('notification.settings.push.description'),
      icon: RiSmartphoneLine,
    },
  ];

  const testActions: { label: string; icon: SettingsIconComponent; run: () => Promise<unknown> }[] = [
    {
      label: t('notification.test.property'),
      icon: RiHomeLine,
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
      icon: RiChat3Line,
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
      icon: RiTimeLine,
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
      icon: RiRepeatLine,
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
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Header
        options={{
          title: t('notification.settings.title'),
          showBackButton: true,
        }}
      />
      <ScrollView contentContainerStyle={settingsScreenStyles.content}>
        {hasPermission ? (
          <SettingsListGroup>
            <SettingsListItem
              icon={<RiCheckboxCircleFill width={20} height={20} fill={theme.success} />}
              title={t('notification.permissions.enabled.title')}
              description={t('notification.permissions.enabled.description')}
            />
          </SettingsListGroup>
        ) : (
          <AdmonitionRoot type="warning" style={styles.permission}>
            <AdmonitionRow>
              <AdmonitionIcon />
              <AdmonitionContent>
                <AdmonitionText style={styles.permissionTitle}>
                  {t('notification.permissions.disabled.title')}
                </AdmonitionText>
                <AdmonitionText>{t('notification.permissions.disabled.description')}</AdmonitionText>
                <AdmonitionButton onPress={() => void handleRequestPermissions()}>
                  {t('notification.permissions.enable')}
                </AdmonitionButton>
              </AdmonitionContent>
            </AdmonitionRow>
          </AdmonitionRoot>
        )}

        <SettingsListGroup
          title={t('notification.settings.categories')}
        >
          {categoryRows.map((row) => (
            <SettingsListItem
              key={row.key}
              icon={<SettingsRowIcon icon={row.icon} />}
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
              icon={<SettingsRowIcon icon={row.icon} />}
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
                icon={<SettingsRowIcon icon={action.icon} />}
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
            icon={<SettingsRowIcon icon={RiDeleteBinLine} destructive />}
            title={t('notification.settings.clearAll')}
            destructive
            onPress={() => void handleClearAll()}
          />
        </SettingsListGroup>

        {Platform.OS === 'ios' ? (
          <SettingsListGroup
            title={t('notification.settings.ios.title')}
            footer={t('notification.settings.ios.description')}
          >
            <SettingsListItem
              icon={<SettingsRowIcon icon={RiInformationLine} />}
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
              icon={<SettingsRowIcon icon={RiInformationLine} />}
              title={t('notification.settings.android.openSettings')}
              onPress={() => {
                /* surfaced as guidance only */
              }}
              showChevron={false}
            />
          </SettingsListGroup>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  permission: {
    marginBottom: spacing.lg,
  },
  permissionTitle: {
    fontWeight: '700',
  },
});
