/**
 * Settings → Sindi (assistant preferences).
 *
 * Bloom SettingsList primitives for rows + toggles, Remix row icons and
 * Bloom `confirm()` for destructive flows.
 *
 *  - "Show tips" is persisted on the device (`store/sindiPreferencesStore.ts`)
 *    and decides whether an empty conversation offers Sindi's starters.
 *  - "Reset" deletes the person's conversations with Sindi — Alia's, through
 *    the SDK, every page of `useConversations({ agentId })` — and puts the
 *    preferences back to their defaults.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@oxy.so/bloom/toast';
import { useConversations, useDeleteConversation } from '@alia.onl/sdk';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { RiInformationLine, RiRefreshLine } from '@oxy.so/bloom/icons';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Switch } from '@oxy.so/bloom/switch';
import { useTheme } from '@oxy.so/bloom/theme';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';

import { confirm } from '@oxy.so/bloom/surfaces';
import { SindiIcon } from '@/assets/icons';
import { spacing } from '@/constants/styles';
import { SettingsRowIcon, settingsScreenStyles } from '@/components/profile/SettingsRowIcon';
import { SINDI_AGENT_ID } from '@/components/sindi/sindiAgent';
import { useSindiPreferences } from '@/store/sindiPreferencesStore';
import { logger } from '@/utils/logger';

export default function SindiSettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const showTips = useSindiPreferences((state) => state.tips);
  const setShowTips = useSindiPreferences((state) => state.setTips);
  const resetPreferences = useSindiPreferences((state) => state.reset);
  const conversations = useConversations({ agentId: SINDI_AGENT_ID });
  const { mutateAsync: deleteConversation } = useDeleteConversation();
  const [resetting, setResetting] = useState(false);

  const handleResetDefaults = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: t('sindi.settings.resetTitle'),
      description: t('sindi.settings.resetMessage'),
      confirmLabel: t('common.reset'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      // Every page, not only the ones the list happens to have loaded.
      let { data } = await conversations.refetch();
      while (data?.pages.at(-1)?.hasMore) {
        ({ data } = await conversations.fetchNextPage());
      }
      const ids = data?.pages.flatMap((page) => page.conversations.map(({ id }) => id)) ?? [];
      for (const id of ids) await deleteConversation(id);
      // The per-agent list is its own cache entry; read it again, now empty.
      await conversations.refetch();
      resetPreferences();
      toast.success(t('sindi.settings.resetDone'));
    } catch (error) {
      logger.error('Failed to reset Sindi:', error);
      toast.error(t('sindi.settings.resetFailed'));
    } finally {
      setResetting(false);
    }
  }, [t, conversations, deleteConversation, resetPreferences]);

  return (
    <>
      <PageHeader
        title={t('sindi.settings.title')}
        titleAlign="center"
        leading={
          <>
            <AppShellMenuButton accessibilityLabel={t('sidebar.open')} />
            <View style={styles.headerIcon}>
              <SindiIcon size={20} color={colors.primarySubtleForeground} />
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
            disabled={resetting}
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
