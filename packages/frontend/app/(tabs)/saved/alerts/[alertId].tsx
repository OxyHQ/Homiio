/**
 * "Why did I get this?" — one alert, explained (#356).
 *
 * The issue asks for this screen by name, and the substance of it is what it
 * DOES NOT do: it never re-derives the explanation from today's rules. The alert
 * row carries the sentence it was written with and the `ruleVersion` that
 * decided it, and both are shown as stored. An answer that quietly changed when
 * the rules changed would be a different kind of wrong from the one this screen
 * exists to prevent, but wrong all the same.
 *
 * ## The deep link is ADR 0002's own token
 *
 * "Ajustar regla desde la notificación" and "vuelve a la consulta correcta" are
 * both reachable from here: the watch's `locToken` is fed straight into
 * `/explore?loc=…`, so the app parses it with the same parser every other link
 * uses. A watch whose selection the grammar cannot express (a drawn polygon)
 * carries no token, and the button is simply absent rather than pointing at a
 * WIDER area than the one being watched.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button } from '@oxyhq/bloom/button';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { deviceTimeZone, formatDate } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertExplanationText } from '@/components/watches/AlertExplanationText';
import { useAlertReason } from '@/hooks/useHousingAlerts';
import { useFormatting } from '@/utils/format';

export default function AlertReasonScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale } = useFormatting();
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const params = useLocalSearchParams<{ alertId?: string }>();
  const alertId = typeof params.alertId === 'string' ? params.alertId : undefined;

  const { data, isLoading, isError } = useAlertReason(alertId);

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
          gap: 10,
        },
        meta: { gap: 4 },
        loading: { paddingVertical: 40, alignItems: 'center' },
      }),
    [theme],
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Header options={{ title: t('alerts.reason.title') }} />
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Header options={{ title: t('alerts.reason.title') }} />
        <EmptyState
          icon="help-circle-outline"
          title={t('alerts.reason.missingTitle')}
          description={t('alerts.reason.missingDescription')}
        />
      </View>
    );
  }

  const { alert, watch, event } = data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header options={{ title: t('alerts.reason.title') }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <H3>{t('alerts.reason.whatChanged')}</H3>
          <AlertExplanationText
            detail={alert.explanation.detail}
            watchName={alert.explanation.watchName}
          />
        </View>

        <View style={styles.card}>
          <H3>{t('alerts.reason.whyYou')}</H3>
          <BloomText>
            {t('alerts.reason.matchedWatch', { name: alert.explanation.watchName })}
          </BloomText>
          <View style={styles.meta}>
            <BloomText style={{ color: theme.colors.textSecondary }}>
              {t('alerts.reason.rule', { rule: t(`alerts.rules.${alert.ruleType}.name`) })}
            </BloomText>
            <BloomText style={{ color: theme.colors.textSecondary }}>
              {/* The rules AS THEY WERE, so a later change does not silently
                  re-describe an alert somebody already received. */}
              {t('alerts.reason.ruleVersion', { version: alert.ruleVersion })}
            </BloomText>
            <BloomText style={{ color: theme.colors.textSecondary }}>
              {t('alerts.reason.detectedAt', {
                when: formatDate(event?.occurredAt ?? alert.createdAt, locale, timeZone, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </BloomText>
            {!event ? (
              // A real answer, not an error: the fact expires on its own 90-day
              // retention while the alert keeps its explanation forever.
              <BloomText style={{ color: theme.colors.textSecondary }}>
                {t('alerts.reason.evidenceExpired')}
              </BloomText>
            ) : null}
          </View>
        </View>

        {watch?.locToken ? (
          <Button
            onPress={() => router.push(`/explore?loc=${encodeURIComponent(watch.locToken ?? '')}`)}
          >
            {t('alerts.reason.openArea')}
          </Button>
        ) : null}
        {watch ? (
          <Button variant="secondary" onPress={() => router.push(`/saved/watches/${watch.id}`)}>
            {t('alerts.reason.adjustRules')}
          </Button>
        ) : null}
      </ScrollView>
    </View>
  );
}
