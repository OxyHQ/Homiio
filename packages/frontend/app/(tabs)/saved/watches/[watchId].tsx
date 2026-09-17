/**
 * Alert settings for one saved area (#356).
 *
 * The screen where the issue's "el usuario controla reglas, cadencia y canales"
 * becomes something a person can actually do.
 *
 * ## It never renders a switch that does nothing
 *
 * `availableRuleTypes` comes from the server, and a rule outside it is shown as
 * UNAVAILABLE with its reason rather than as an off switch. The two look
 * identical to a user and mean opposite things: one is "I have not turned this
 * on", the other is "turning this on would achieve nothing". The server refuses
 * to enable an unavailable rule anyway, so a dead switch would produce a 400
 * nobody could act on.
 *
 * ## It warns about a watch that cannot fire BEFORE the user turns it on
 *
 * `alertStatus` and `hasArea` are separate fields for exactly this: a watch may
 * be switched off AND have no derivable area, and somebody needs to know the
 * second before flipping the first and finding out nothing happens.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Admonition } from '@oxy.so/bloom/admonition';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { RiCheckLine, RiSearchLine } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { RadioGroup } from '@oxy.so/bloom/radio';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { Switch } from '@oxy.so/bloom/switch';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { useTheme } from '@oxy.so/bloom/theme';
import { H3, Text as BloomText } from '@oxy.so/bloom/typography';
import {
  HOUSING_ALERT_RULE_SPECS,
  HOUSING_ALERT_RULE_TYPES,
  WATCH_CADENCES,
  type HousingAlertRule,
  type HousingAlertRuleType,
  type WatchCadence,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { contentClamp, spacing } from '@/constants/styles';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import type { SavedSearch } from '@/store/savedSearchesStore';

/** How long "pause" pauses for. One week — long enough to be a real break. */
const MUTE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export default function WatchAlertSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ watchId?: string }>();
  const watchId = typeof params.watchId === 'string' ? params.watchId : undefined;

  const { searches, isLoading, getSearchById, updateAlertSettings, setPrimaryArea } =
    useSavedSearches();
  const watch = watchId ? getSearchById(watchId) : undefined;

  const rulesByType = useMemo(() => {
    const map = new Map<HousingAlertRuleType, HousingAlertRule>();
    for (const rule of watch?.alertRules ?? []) map.set(rule.type, rule);
    return map;
  }, [watch?.alertRules]);

  const available = useMemo(
    () => new Set(watch?.availableRuleTypes ?? []),
    [watch?.availableRuleTypes],
  );

  const setCadence = useCallback(
    (cadence: WatchCadence) => {
      if (watchId) void updateAlertSettings(watchId, { cadence });
    },
    [watchId, updateAlertSettings],
  );

  const toggleRule = useCallback(
    (type: HousingAlertRuleType, enabled: boolean) => {
      if (!watchId || !watch) return;
      // The whole set is sent, not one rule: the endpoint REPLACES the rule set,
      // so posting a single entry would delete the others. That is the right
      // shape for the endpoint — a partial set is how a client says "the rest
      // are gone" — and this is where it has to be respected.
      const next: HousingAlertRule[] = [...available].map((ruleType) => {
        const current = rulesByType.get(ruleType);
        return ruleType === type
          ? { type: ruleType, enabled, ...(current?.threshold === undefined ? {} : { threshold: current.threshold }) }
          : { type: ruleType, enabled: current?.enabled ?? false, ...(current?.threshold === undefined ? {} : { threshold: current.threshold }) };
      });
      void updateAlertSettings(watchId, { alertRules: next });
    },
    [watchId, watch, available, rulesByType, updateAlertSettings],
  );

  const muted = Boolean(watch?.mutedUntil && new Date(watch.mutedUntil) > new Date());

  const toggleMute = useCallback(() => {
    if (!watchId) return;
    void updateAlertSettings(watchId, {
      mutedUntil: muted ? null : new Date(Date.now() + MUTE_DURATION_MS).toISOString(),
    });
  }, [watchId, muted, updateAlertSettings]);

  const cadenceOptions = useMemo(
    () => WATCH_CADENCES.map((cadence) => ({ value: cadence, label: t(`alerts.cadence.${cadence}`) })),
    [t],
  );

  if (isLoading && searches.length === 0) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Header options={{ title: t('alerts.settings.title') }} />
        <Loading style={styles.loading} />
      </View>
    );
  }

  if (!watch) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        <Header options={{ title: t('alerts.settings.title') }} />
        <EmptyState
          icon={RiSearchLine}
          title={t('alerts.settings.missingTitle')}
          description={t('alerts.settings.missingDescription')}
        />
      </View>
    );
  }

  const inactiveReason =
    watch.alertStatus?.status === 'inactive' ? watch.alertStatus.reason : undefined;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Header options={{ title: watch.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Shown BEFORE the switches, so a watch that cannot fire says so while
            somebody is deciding rather than after they have finished. */}
        {inactiveReason && inactiveReason !== 'cadence_off' ? (
          <Admonition type="warning">{t(`alerts.settings.inactive.${inactiveReason}`)}</Admonition>
        ) : null}

        {/* Keyed on the watch so the field seeds from the loaded row. */}
        <RenameCard key={watch.id} watch={watch} />

        <Card variant="outlined" radius="radius-16" style={styles.card}>
          <H3>{t('alerts.settings.cadence')}</H3>
          <BloomText style={{ color: theme.colors.textSecondary }}>
            {t('alerts.settings.cadenceHint')}
          </BloomText>
          <RadioGroup<WatchCadence>
            label={t('alerts.settings.cadence')}
            value={watch.cadence}
            onValueChange={setCadence}
            options={cadenceOptions}
          />
        </Card>

        <SettingsListGroup title={t('alerts.settings.rules')}>
          {HOUSING_ALERT_RULE_TYPES.map((type) => {
            const usable = available.has(type);
            const rule = rulesByType.get(type);
            const name = t(`alerts.rules.${type}.name`);
            return (
              <SettingsListItem
                key={type}
                title={name}
                description={
                  usable
                    ? t(`alerts.rules.${type}.description`)
                    : // The rule's own recorded reason, not a generic "coming
                      // soon" — the point of storing the reason is that it is
                      // shown rather than paraphrased.
                      HOUSING_ALERT_RULE_SPECS[type].availability.status === 'unavailable'
                      ? t('alerts.settings.ruleUnavailableShort')
                      : undefined
                }
                rightElement={
                  <Switch
                    accessibilityLabel={name}
                    value={Boolean(rule?.enabled)}
                    disabled={!usable}
                    onValueChange={(next: boolean) => toggleRule(type, next)}
                  />
                }
              />
            );
          })}
        </SettingsListGroup>

        <SettingsListGroup title={t('alerts.settings.pause')} footer={t('alerts.settings.pauseHint')}>
          <SettingsListItem
            title={t('alerts.settings.pauseAction')}
            rightElement={
              <Switch
                accessibilityLabel={t('alerts.settings.pauseAction')}
                value={muted}
                onValueChange={toggleMute}
              />
            }
          />
        </SettingsListGroup>

        <SettingsListGroup
          title={t('alerts.settings.primaryArea')}
          footer={t('alerts.settings.primaryAreaHint')}
        >
          <SettingsListItem
            title={
              watch.isPrimaryArea
                ? t('alerts.settings.primaryAreaCurrent')
                : t('alerts.settings.primaryAreaAction')
            }
            disabled={watch.isPrimaryArea}
            showChevron={!watch.isPrimaryArea}
            rightElement={
              watch.isPrimaryArea ? (
                <RiCheckLine width={20} height={20} fill={theme.colors.primary} />
              ) : undefined
            }
            onPress={watch.isPrimaryArea ? undefined : () => watchId && void setPrimaryArea(watchId)}
          />
        </SettingsListGroup>

        <Button
          variant="secondary"
          onPress={() => router.push(`/saved/alerts?watchId=${watch.id}`)}
        >
          {t('alerts.settings.viewHistory')}
        </Button>
      </ScrollView>
    </View>
  );
}

/** The saved search's name — the one field the old rail edit dialog had that this screen lacked. */
function RenameCard({ watch }: { watch: SavedSearch }) {
  const { t } = useTranslation();
  const { updateSearch } = useSavedSearches();
  const [name, setName] = useState(watch.name);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();

  const save = async () => {
    setSaving(true);
    try {
      // The hook toasts success, a taken name and any other failure.
      await updateSearch(watch.id, { name: trimmed });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="outlined" radius="radius-16" style={styles.card}>
      <TextFieldInput
        label={t('common.name')}
        value={name}
        onChangeText={setName}
        maxLength={60}
        disabled={saving}
      />
      <Button
        variant="secondary"
        onPress={() => void save()}
        loading={saving}
        disabled={saving || !trimmed || trimmed === watch.name}
        style={styles.saveName}
      >
        {t('common.save')}
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: contentClamp.copy,
    alignSelf: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['6xl'],
  },
  card: { padding: spacing.lg, gap: spacing.md },
  saveName: { alignSelf: 'flex-start' },
  loading: { paddingVertical: spacing['3xl'] },
});
