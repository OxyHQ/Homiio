/**
 * The alert history (#356) — in-app, and the visible source of truth.
 *
 * Grouped by DAY, because the issue asks for a history "agrupado por watch y
 * fecha" and the date is the axis a person actually scans; the watch is on every
 * row, so grouping by it as well would nest two lists inside each other for no
 * gain. `?watchId=` narrows the whole screen to one watch, which is how the
 * per-watch view is reached from the watch list.
 *
 * ## Every row says WHY, and suppressed rows say why NOT
 *
 * A suppressed alert is shown rather than hidden. "You have no alerts" and "we
 * held four back because this watch is muted" are different answers, and only
 * one of them tells somebody what to change — which is the whole reason
 * `suppression_reason` is a stored column instead of an inference.
 */

import React, { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card } from '@oxy.so/bloom/card';
import { RiMapPinLine, RiNotification3Line, RiPauseLine } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { useTheme } from '@oxy.so/bloom/theme';
import { H3, Text as BloomText } from '@oxy.so/bloom/typography';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertExplanationText } from '@/components/watches/AlertExplanationText';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { useHousingAlerts, type HousingAlert } from '@/hooks/useHousingAlerts';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { contentClamp, spacing } from '@/constants/styles';
import { useFormatting } from '@/utils/format';
import { deviceTimeZone, formatDate } from '@homiio/shared-types';

const ICON_SIZE = 18;

/** One day's worth of alerts, in the order the list renders them. */
interface DayGroup {
  readonly key: string;
  readonly label: string;
  readonly alerts: readonly HousingAlert[];
}

export default function AlertHistoryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale } = useFormatting();
  // The reader's own zone. A day boundary computed in UTC puts a 01:30 alert on
  // the previous date for everybody west of Greenwich, which reads as the
  // history being a day behind rather than as a formatting choice.
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const params = useLocalSearchParams<{ watchId?: string }>();
  const watchId = typeof params.watchId === 'string' ? params.watchId : undefined;

  const query = useHousingAlerts(watchId);
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = query;

  // Refetch on focus, matching the mailbox. There is no socket: this list is
  // written by a sweep on a two-minute cadence, so a focus refetch is both
  // sufficient and honest about the latency.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Both platforms are wired, and each only fires its own: the sentinel below
  // is inert on native, and this handler is what the screen's own ScrollView
  // uses there. `enabled` gates both on there being another page.
  const { onScroll } = useInfiniteScroll({
    onEndReached: loadMore,
    enabled: Boolean(hasNextPage) && !isFetchingNextPage,
  });

  const groups = useMemo<DayGroup[]>(() => {
    const alerts = data?.pages.flatMap((page) => page.alerts) ?? [];
    const byDay = new Map<string, HousingAlert[]>();
    for (const alert of alerts) {
      // The DAY in the reader's own zone, sliced off the ISO string only after
      // it has been through a Date — slicing the raw string would group by UTC
      // day and put a 01:30 alert on the previous date for anybody west of
      // Greenwich.
      const key = new Date(alert.createdAt).toDateString();
      const bucket = byDay.get(key);
      if (bucket) bucket.push(alert);
      else byDay.set(key, [alert]);
    }
    return [...byDay.entries()].map(([key, dayAlerts]) => ({
      key,
      label: formatDate(new Date(key), locale, timeZone, { dateStyle: 'medium' }),
      alerts: dayAlerts,
    }));
  }, [data, locale, timeZone]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Header options={{ title: t('alerts.history.title') }} />
        <Loading style={styles.loading} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header options={{ title: t('alerts.history.title') }} />
      <ScrollView contentContainerStyle={styles.content} onScroll={onScroll} scrollEventThrottle={16}>
        {groups.length === 0 ? (
          <EmptyState
            icon={RiNotification3Line}
            title={t('alerts.history.emptyTitle')}
            description={t('alerts.history.emptyDescription')}
          />
        ) : (
          groups.map((group) => (
            <View key={group.key}>
              <H3 style={styles.dayLabel}>
                {group.label}
              </H3>
              <View style={styles.dayList}>
                {group.alerts.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} />
                ))}
              </View>
            </View>
          ))
        )}
        <LoadMoreSentinel onLoadMore={loadMore} enabled={Boolean(hasNextPage)} />
      </ScrollView>
    </View>
  );
}

/** One alert: a pressable Bloom `Card` opening its "why did I get this?" screen. */
function AlertRow({ alert }: { readonly alert: HousingAlert }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const heldReason =
    alert.deliveryState === 'suppressed' && alert.suppressionReason
      ? t(`alerts.history.suppressed.${alert.suppressionReason}`)
      : alert.deliveryState === 'pending'
        ? t('alerts.history.pending')
        : null;

  return (
    <Card
      variant="outlined"
      radius="radius-16"
      onPress={() => router.push(`/saved/alerts/${alert.id}`)}
      accessibilityRole="button"
      accessibilityLabel={t('alerts.history.openReason')}
      style={styles.row}
    >
      <View style={styles.rowHeader}>
        <RiMapPinLine width={ICON_SIZE} height={ICON_SIZE} fill={theme.colors.textSecondary} />
        <BloomText style={{ color: theme.colors.textSecondary }}>
          {alert.explanation.watchName}
        </BloomText>
      </View>
      <AlertExplanationText
        detail={alert.explanation.detail}
        watchName={alert.explanation.watchName}
      />
      {heldReason ? (
        <View style={styles.rowHeader}>
          <RiPauseLine width={ICON_SIZE} height={ICON_SIZE} fill={theme.colors.warning} />
          <BloomText style={{ color: theme.colors.textSecondary }}>{heldReason}</BloomText>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: contentClamp.copy,
    alignSelf: 'center',
    padding: spacing.lg,
    paddingBottom: spacing['6xl'],
    gap: spacing['2xl'],
  },
  dayLabel: { marginBottom: spacing.sm },
  dayList: { gap: spacing.md },
  row: { padding: spacing.md, gap: spacing.sm },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  loading: { paddingVertical: spacing['2xl'] },
});
