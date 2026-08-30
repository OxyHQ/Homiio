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

import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button } from '@oxyhq/bloom/button';
import { Switch } from '@oxyhq/bloom/switch';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';
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
import { useSavedSearches } from '@/hooks/useSavedSearches';

const ICON_SIZE = 18;
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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        content: { padding: 16, gap: 20, paddingBottom: 60 },
        card: {
          padding: 16,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card,
          gap: 12,
        },
        warning: {
          padding: 14,
          borderRadius: 16,
          backgroundColor: theme.colors.backgroundSecondary,
          flexDirection: 'row',
          gap: 10,
          alignItems: 'flex-start',
        },
        ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
        ruleText: { flex: 1, gap: 2 },
        cadenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        loading: { paddingVertical: 40, alignItems: 'center' },
      }),
    [theme],
  );

  if (isLoading && searches.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Header options={{ title: t('alerts.settings.title') }} />
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (!watch) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Header options={{ title: t('alerts.settings.title') }} />
        <EmptyState
          icon="search-outline"
          title={t('alerts.settings.missingTitle')}
          description={t('alerts.settings.missingDescription')}
        />
      </View>
    );
  }

  const inactiveReason =
    watch.alertStatus?.status === 'inactive' ? watch.alertStatus.reason : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header options={{ title: watch.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Shown BEFORE the switches, so a watch that cannot fire says so while
            somebody is deciding rather than after they have finished. */}
        {inactiveReason && inactiveReason !== 'cadence_off' ? (
          <View style={styles.warning}>
            <Ionicons name="warning-outline" size={ICON_SIZE} color={theme.colors.warning} />
            <BloomText style={{ flex: 1 }}>
              {t(`alerts.settings.inactive.${inactiveReason}`)}
            </BloomText>
          </View>
        ) : null}

        <View style={styles.card}>
          <H3>{t('alerts.settings.cadence')}</H3>
          <BloomText style={{ color: theme.colors.textSecondary }}>
            {t('alerts.settings.cadenceHint')}
          </BloomText>
          <View style={styles.cadenceRow}>
            {WATCH_CADENCES.map((cadence) => (
              <Button
                key={cadence}
                variant={watch.cadence === cadence ? 'primary' : 'secondary'}
                onPress={() => setCadence(cadence)}
              >
                {t(`alerts.cadence.${cadence}`)}
              </Button>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <H3>{t('alerts.settings.rules')}</H3>
          {HOUSING_ALERT_RULE_TYPES.map((type) => {
            const usable = available.has(type);
            const rule = rulesByType.get(type);
            return (
              <View key={type} style={styles.ruleRow}>
                <View style={styles.ruleText}>
                  <BloomText>{t(`alerts.rules.${type}.name`)}</BloomText>
                  <BloomText style={{ color: theme.colors.textSecondary }}>
                    {usable
                      ? t(`alerts.rules.${type}.description`)
                      : // The rule's own recorded reason, not a generic "coming
                        // soon" — the point of storing the reason is that it is
                        // shown rather than paraphrased.
                        HOUSING_ALERT_RULE_SPECS[type].availability.status === 'unavailable'
                        ? t('alerts.settings.ruleUnavailableShort')
                        : ''}
                  </BloomText>
                </View>
                <Switch
                  value={Boolean(rule?.enabled)}
                  disabled={!usable}
                  onValueChange={(next: boolean) => toggleRule(type, next)}
                />
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <H3>{t('alerts.settings.pause')}</H3>
          <BloomText style={{ color: theme.colors.textSecondary }}>
            {t('alerts.settings.pauseHint')}
          </BloomText>
          <Button variant={muted ? 'primary' : 'secondary'} onPress={toggleMute}>
            {muted ? t('alerts.settings.resume') : t('alerts.settings.pauseAction')}
          </Button>
        </View>

        <View style={styles.card}>
          <H3>{t('alerts.settings.primaryArea')}</H3>
          <BloomText style={{ color: theme.colors.textSecondary }}>
            {t('alerts.settings.primaryAreaHint')}
          </BloomText>
          <Button
            variant={watch.isPrimaryArea ? 'primary' : 'secondary'}
            disabled={watch.isPrimaryArea}
            onPress={() => watchId && void setPrimaryArea(watchId)}
          >
            {watch.isPrimaryArea
              ? t('alerts.settings.primaryAreaCurrent')
              : t('alerts.settings.primaryAreaAction')}
          </Button>
        </View>

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
