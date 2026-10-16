/**
 * Settings → Sindi (assistant preferences).
 *
 * Bloom SettingsList primitives for rows + toggles, Remix row icons and
 * Bloom `confirm()` for destructive flows. The previous version imported a
 * `sindiApi` member that does not exist in `@/utils/api`; the chat-history
 * UI is removed until a real service ships. The behaviour toggles and the
 * "reset" affordance remain available.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@oxy.so/bloom/toast';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { RiInformationLine, RiRefreshLine } from '@oxy.so/bloom/icons';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Switch } from '@oxy.so/bloom/switch';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';

import { confirm } from '@oxy.so/bloom/surfaces';
import { SindiIcon } from '@/assets/icons';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { SettingsRowIcon, settingsScreenStyles } from '@/components/profile/SettingsRowIcon';

export default function SindiSettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [showTips, setShowTips] = useState(true);
  const handleResetDefaults = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: t('sindi.settings.resetTitle'),
      description: t('sindi.settings.resetMessage'),
      confirmLabel: t('common.reset'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setShowTips(true);
    toast.success(t('sindi.settings.resetDone'));
  }, [t]);

  return (
    <>
      <PageHeader
        title={t('sindi.settings.title')}
        titleAlign="center"
        leading={
          <>
            <AppShellMenuButton accessibilityLabel={t('sidebar.open')} />
            <View style={styles.headerIcon}>
              <SindiIcon size={20} color={colors.sindiColor} />
            </View>
          </>
        }
        onBack={router.canGoBack() ? router.back : undefined}
        backLabel={t('goBack')}
      />
      <View style={settingsScreenStyles.content}>
        <SettingsListGroup
          title={t('sindi.settings.behavior')}
          footer={t('sindi.settings.behaviorFooter')}
        >
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiInformationLine} />}
            title={t('sindi.settings.tips')}
            description={t('sindi.settings.tipsDescription')}
            rightElement={<Switch checked={showTips} onCheckedChange={setShowTips} />}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('sindi.settings.actions')}>
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiRefreshLine} />}
            title={t('sindi.settings.reset')}
            onPress={() => void handleResetDefaults()}
          />
        </SettingsListGroup>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  headerIcon: {
    marginLeft: spacing.xs,
  },
});
