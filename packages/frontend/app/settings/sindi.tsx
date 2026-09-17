/**
 * Settings → Sindi (assistant preferences).
 *
 * Stream P polish: Bloom SettingsList primitives for rows + toggles, shared
 * Bloom `confirm()` for destructive flows. The previous version imported a
 * `sindiApi` member that does not exist in `@/utils/api`; the chat-history
 * UI is removed until a real service ships. The behaviour toggles and the
 * "reset" affordance remain available.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { toast } from '@oxy.so/bloom/toast';

import { Switch } from '@oxy.so/bloom/switch';
import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxy.so/bloom/settings-list';

import { Header } from '@/components/Header';
import { confirm } from '@oxy.so/bloom/surfaces';
import { SindiIcon } from '@/assets/icons';
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

export default function SindiSettingsScreen() {
  const { t } = useTranslation();
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
    <View style={styles.root}>
      <Header
        options={{
          title: t('sindi.settings.title'),
          showBackButton: true,
          leftComponents: [
            <View key="logo" style={styles.headerIcon}>
              <SindiIcon size={20} color={colors.sindiColor} />
            </View>,
          ],
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <SettingsListGroup
          title={t('sindi.settings.behavior')}
          footer={t('sindi.settings.behaviorFooter')}
        >
          <SettingsListItem
            icon={<RowIcon name="information-circle-outline" />}
            title={t('sindi.settings.tips')}
            description={t('sindi.settings.tipsDescription')}
            rightElement={
              <Switch value={showTips} onValueChange={setShowTips} />
            }
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('sindi.settings.actions')}>
          <SettingsListItem
            icon={<RowIcon name="refresh-outline" />}
            title={t('sindi.settings.reset')}
            onPress={() => void handleResetDefaults()}
          />
        </SettingsListGroup>
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
  headerIcon: {
    marginLeft: spacing.xs,
  },
});
