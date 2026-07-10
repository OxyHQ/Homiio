/**
 * Settings → Sindi (assistant preferences).
 *
 * Stream P polish: Bloom SettingsList primitives for rows + toggles, shared
 * ConfirmDialog for destructive flows. The previous version imported a
 * `sindiApi` member that does not exist in `@/utils/api`; the chat-history
 * UI is removed until a real service ships. The behaviour toggles and the
 * "reset" affordance remain available.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '@/lib/sonner';

import { Switch } from '@oxyhq/bloom/switch';
import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxyhq/bloom/settings-list';

import { Header } from '@/components/Header';
import { ConfirmDialog } from '@/components/ConfirmDialog';
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
  const [pendingDialog, setPendingDialog] = useState<'reset' | null>(null);

  const handleResetDefaults = useCallback((): void => {
    setShowTips(true);
    toast.success(t('sindi.settings.resetDone'));
    setPendingDialog(null);
  }, [t]);

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('sindi.settings.title'),
          showBackButton: true,
          titlePosition: 'center',
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
            onPress={() => setPendingDialog('reset')}
          />
        </SettingsListGroup>
      </ScrollView>

      <ConfirmDialog
        visible={pendingDialog === 'reset'}
        title={t('sindi.settings.resetTitle')}
        message={t('sindi.settings.resetMessage')}
        confirmLabel={t('common.reset')}
        confirmDestructive
        onConfirm={handleResetDefaults}
        onCancel={() => setPendingDialog(null)}
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
  headerIcon: {
    marginLeft: spacing.xs,
  },
});
