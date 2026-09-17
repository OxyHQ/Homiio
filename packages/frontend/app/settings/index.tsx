/**
 * Settings — top-level personal preferences screen.
 *
 * Stream P polish: switched the hand-rolled grouped TouchableOpacity rows
 * to Bloom `SettingsListGroup` + `SettingsListItem`. Sections follow the
 * Clarity sidebar pattern: Account → Preferences → Notifications → Data
 * → Support → About → Sign out. Switches now use Bloom Switch; sign-out
 * uses Bloom Button via the destructive variant on SettingsListItem.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useOxy } from '@oxy.so/services';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { toast } from '@oxy.so/bloom/toast';

import { Switch } from '@oxy.so/bloom/switch';
import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxy.so/bloom/settings-list';

import { Header } from '@/components/Header';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useCurrency } from '@/hooks/useCurrency';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { LogoIcon } from '@/assets/logo';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface RowIconProps {
  name: IoniconName;
  destructive?: boolean;
}

/**
 * Small icon wrapper that matches Bloom SettingsListItem's leading slot
 * (20×20). Keeps icon color in sync with `destructive` semantics.
 */
const RowIcon: React.FC<RowIconProps> = ({ name, destructive }) => (
  <Ionicons
    name={name}
    size={20}
    color={destructive ? colors.danger : colors.muted}
  />
);

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, showBottomSheet, logout } = useOxy();
  const { getCurrentCurrency } = useCurrency();

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
    <View style={styles.root}>
      <Header
        options={{
          title: t('settings.title'),
          showBackButton: true,
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <SettingsListGroup title={t('settings.sections.account')}>
          <SettingsListItem
            icon={<RowIcon name="person" />}
            title={userDisplayName}
            description={user?.username ?? ''}
            onPress={() => showBottomSheet?.('ManageAccount')}
          />
          <SettingsListItem
            icon={<RowIcon name="folder" />}
            title={t('settings.account.files')}
            description={t('settings.account.filesDescription')}
            onPress={() => showBottomSheet?.('FileManagement')}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('settings.sections.preferences')}>
          <SettingsListItem
            icon={<RowIcon name="language" />}
            title={t('settings.language.title')}
            value={t('settings.language.subtitle')}
            onPress={() => router.push('/settings/language')}
          />
          <SettingsListItem
            icon={<RowIcon name="cash" />}
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
            icon={<RowIcon name="notifications" />}
            title={t('settings.preferences.notifications')}
            description={t('settings.preferences.notificationsDesc')}
            rightElement={
              <Switch value={notifications} onValueChange={setNotifications} />
            }
          />
          <SettingsListItem
            icon={<RowIcon name="options-outline" />}
            title={t('settings.notifications.detail')}
            description={t('settings.notifications.detailDesc')}
            onPress={() => router.push('/settings/notifications')}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('settings.sections.data')}>
          <SettingsListItem
            icon={<RowIcon name="sync" />}
            title={t('settings.preferences.autoSync')}
            description={t('settings.preferences.autoSyncDesc')}
            rightElement={
              <Switch value={autoSync} onValueChange={setAutoSync} />
            }
          />
          <SettingsListItem
            icon={<RowIcon name="cloud-offline" />}
            title={t('settings.preferences.offlineMode')}
            description={t('settings.preferences.offlineModeDesc')}
            rightElement={
              <Switch value={offlineMode} onValueChange={setOfflineMode} />
            }
          />
          <SettingsListItem
            icon={<RowIcon name="download" />}
            title={t('settings.data.exportData')}
            description={t('settings.data.exportDataDesc')}
            onPress={() => void handleExportData()}
          />
          <SettingsListItem
            icon={<RowIcon name="trash" destructive />}
            title={t('settings.data.clearCache')}
            description={t('settings.data.clearCacheDesc')}
            destructive
            onPress={() => void handleClearCache()}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('settings.sections.supportFeedback')}>
          <SettingsListItem
            icon={<RowIcon name="help-circle" />}
            title={t('settings.supportFeedback.helpSupport')}
            description={t('settings.supportFeedback.helpSupportDesc')}
            onPress={() => toast(t('settings.supportFeedback.helpSupportMessage'))}
          />
          <SettingsListItem
            icon={<RowIcon name="chatbubble" />}
            title={t('settings.supportFeedback.sendFeedback')}
            description={t('settings.supportFeedback.sendFeedbackDesc')}
            onPress={() => toast(t('settings.supportFeedback.sendFeedbackMessage'))}
          />
          <SettingsListItem
            icon={<RowIcon name="star" />}
            title={t('settings.supportFeedback.rateApp')}
            description={t('settings.supportFeedback.rateAppDesc')}
            onPress={() => toast(t('settings.supportFeedback.rateAppMessage'))}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('settings.sections.aboutHomiio')}>
          <SettingsListItem
            icon={<LogoIcon size={20} color={colors.primaryColor} />}
            title={t('settings.aboutHomiio.appName')}
            value={t('settings.aboutHomiio.version', {
              version: Constants.expoConfig?.version || '1.0.0',
            })}
          />
          <SettingsListItem
            icon={<RowIcon name="hammer" />}
            title={t('settings.aboutHomiio.build')}
            value={
              typeof Constants.expoConfig?.runtimeVersion === 'string'
                ? Constants.expoConfig.runtimeVersion
                : t('settings.aboutHomiio.buildVersion')
            }
          />
          <SettingsListItem
            icon={<RowIcon name="phone-portrait" />}
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
            icon={<RowIcon name="code-slash" />}
            title={t('settings.aboutHomiio.oxySDK')}
            value={(Constants as unknown as { oxyVersion?: string }).oxyVersion || 'Unknown'}
            onPress={() => showBottomSheet?.('AppInfo')}
          />
        </SettingsListGroup>

        <SettingsListGroup>
          <SettingsListItem
            icon={<RowIcon name="log-out" destructive />}
            title={t('settings.signOut')}
            description={t('settings.signOutDesc')}
            destructive
            onPress={() => void handleSignOut()}
          />
        </SettingsListGroup>

        <View style={styles.bottomPadding} />
      </ScrollView>
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
  bottomPadding: {
    height: spacing['4xl'],
  },
});
