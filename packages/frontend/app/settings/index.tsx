/**
 * Settings — top-level personal preferences screen.
 *
 * Bloom `SettingsListGroup` + `SettingsListItem` rows with Remix leading
 * icons (`SettingsRowIcon`), Bloom `Switch` toggles and `confirm()` before
 * destructive actions. Sections: Account → Preferences → Notifications →
 * Data → Support → About → Sign out.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useOxy } from '@oxy.so/services';
import Constants from 'expo-constants';
import { toast } from '@oxy.so/bloom/toast';

import {
  RiChat3Line,
  RiCodeSSlashLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiEyeOffLine,
  RiFolderLine,
  RiGlobalLine,
  RiCoinsLine,
  RiLogoutBoxRLine,
  RiNotification3Line,
  RiEqualizerLine,
  RiQuestionLine,
  RiRefreshLine,
  RiSmartphoneLine,
  RiStarLine,
  RiUserLine,
  RiWrenchLine,
} from '@oxy.so/bloom/icons';
import { Switch } from '@oxy.so/bloom/switch';
import { useTheme } from '@oxy.so/bloom/theme';
import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxy.so/bloom/settings-list';

import { Header } from '@/components/Header';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useCurrency } from '@/hooks/useCurrency';
import { SettingsRowIcon, settingsScreenStyles } from '@/components/profile/SettingsRowIcon';
import { LogoIcon } from '@/assets/logo';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, showBottomSheet, logout } = useOxy();
  const { getCurrentCurrency } = useCurrency();
  const { colors: theme } = useTheme();

  const [notifications, setNotifications] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);


  const userDisplayName =
    typeof user?.name === 'string'
      ? user.name
      : user?.name?.full || user?.name?.first || user?.username || 'User';
  const currentCurrencyInfo = getCurrentCurrency();

  const handleSignOut = async () => {
    const ok = await confirm({
      title: t('settings.signOut'),
      description: t('settings.signOutMessage'),
      confirmLabel: t('settings.signOut'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await logout();
      router.replace('/');
      toast.success(t('settings.signOutSuccess'));
    } catch {
      toast.error(t('settings.signOutFailed'));
    }
  };

  const handleClearCache = async () => {
    const ok = await confirm({
      title: t('settings.data.clearCache'),
      description: t('settings.data.clearCacheMessage'),
      confirmLabel: t('common.clear'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    // Implementation would clear app cache here.
    toast.success(t('settings.data.clearCacheSuccess'));
  };

  const handleExportData = async () => {
    const ok = await confirm({
      title: t('settings.data.exportData'),
      description: t('settings.data.exportDataMessage'),
      confirmLabel: t('common.export'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    toast.success(t('settings.data.exportDataSuccess'));
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Header
        options={{
          title: t('settings.title'),
          showBackButton: true,
        }}
      />
      <ScrollView contentContainerStyle={settingsScreenStyles.content}>
        <SettingsListGroup title={t('settings.sections.account')}>
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiUserLine} />}
            title={userDisplayName}
            description={user?.username ?? ''}
            onPress={() => showBottomSheet?.('ManageAccount')}
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiFolderLine} />}
            title={t('settings.account.files')}
            description={t('settings.account.filesDescription')}
            onPress={() => showBottomSheet?.('FileManagement')}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('settings.sections.preferences')}>
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiGlobalLine} />}
            title={t('settings.language.title')}
            value={t('settings.language.subtitle')}
            onPress={() => router.push('/settings/language')}
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiCoinsLine} />}
            title={t('settings.preferences.currency')}
            value={`${currentCurrencyInfo.symbol} ${currentCurrencyInfo.code}`}
            onPress={() => router.push('/settings/currency')}
          />
          {/*
            Dark mode toggle intentionally omitted: the app currently renders a
            single light theme (static `colors.ts` is light-only; Bloom is pinned
            to light in app/_layout.tsx). A live toggle would be misleading until
            the reactive color migration lands. Re-add a wired Switch here once
            components consume `useColors()` for live light/dark values.
          */}
        </SettingsListGroup>

        <SettingsListGroup title={t('settings.sections.notifications')}>
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiNotification3Line} />}
            title={t('settings.preferences.notifications')}
            description={t('settings.preferences.notificationsDesc')}
            rightElement={
              <Switch value={notifications} onValueChange={setNotifications} />
            }
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiEqualizerLine} />}
            title={t('settings.notifications.detail')}
            description={t('settings.notifications.detailDesc')}
            onPress={() => router.push('/settings/notifications')}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('settings.sections.data')}>
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiRefreshLine} />}
            title={t('settings.preferences.autoSync')}
            description={t('settings.preferences.autoSyncDesc')}
            rightElement={
              <Switch value={autoSync} onValueChange={setAutoSync} />
            }
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiEyeOffLine} />}
            title={t('settings.preferences.offlineMode')}
            description={t('settings.preferences.offlineModeDesc')}
            rightElement={
              <Switch value={offlineMode} onValueChange={setOfflineMode} />
            }
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiDownloadLine} />}
            title={t('settings.data.exportData')}
            description={t('settings.data.exportDataDesc')}
            onPress={() => void handleExportData()}
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiDeleteBinLine} destructive />}
            title={t('settings.data.clearCache')}
            description={t('settings.data.clearCacheDesc')}
            destructive
            onPress={() => void handleClearCache()}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('settings.sections.supportFeedback')}>
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiQuestionLine} />}
            title={t('settings.supportFeedback.helpSupport')}
            description={t('settings.supportFeedback.helpSupportDesc')}
            onPress={() => toast(t('settings.supportFeedback.helpSupportMessage'))}
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiChat3Line} />}
            title={t('settings.supportFeedback.sendFeedback')}
            description={t('settings.supportFeedback.sendFeedbackDesc')}
            onPress={() => toast(t('settings.supportFeedback.sendFeedbackMessage'))}
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiStarLine} />}
            title={t('settings.supportFeedback.rateApp')}
            description={t('settings.supportFeedback.rateAppDesc')}
            onPress={() => toast(t('settings.supportFeedback.rateAppMessage'))}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('settings.sections.aboutHomiio')}>
          <SettingsListItem
            icon={<LogoIcon size={20} color={theme.primary} />}
            title={t('settings.aboutHomiio.appName')}
            value={t('settings.aboutHomiio.version', {
              version: Constants.expoConfig?.version || '1.0.0',
            })}
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiWrenchLine} />}
            title={t('settings.aboutHomiio.build')}
            value={
              typeof Constants.expoConfig?.runtimeVersion === 'string'
                ? Constants.expoConfig.runtimeVersion
                : t('settings.aboutHomiio.buildVersion')
            }
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiSmartphoneLine} />}
            title={t('settings.aboutHomiio.platform')}
            value={
              Constants.platform?.ios
                ? 'iOS'
                : Constants.platform?.android
                  ? 'Android'
                  : 'Web'
            }
          />
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiCodeSSlashLine} />}
            title={t('settings.aboutHomiio.oxySDK')}
            value={(Constants as unknown as { oxyVersion?: string }).oxyVersion || 'Unknown'}
            onPress={() => showBottomSheet?.('AppInfo')}
          />
        </SettingsListGroup>

        <SettingsListGroup>
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiLogoutBoxRLine} destructive />}
            title={t('settings.signOut')}
            description={t('settings.signOutDesc')}
            destructive
            onPress={() => void handleSignOut()}
          />
        </SettingsListGroup>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
