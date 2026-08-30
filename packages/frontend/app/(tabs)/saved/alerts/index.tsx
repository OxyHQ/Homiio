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

import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@oxyhq/bloom/theme';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertExplanationText } from '@/components/watches/AlertExplanationText';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { useHousingAlerts, type HousingAlert } from '@/hooks/useHousingAlerts';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        content: { padding: 16, paddingBottom: 80, gap: 24 },
        dayLabel: { marginBottom: 8 },
        row: {
          padding: 14,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card,
          gap: 8,
        },
        rowPressed: { backgroundColor: theme.colors.backgroundSecondary },
        rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        held: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        loading: { paddingVertical: 24, alignItems: 'center' },
      }),
    [theme],
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <Header options={{ title: t('alerts.history.title') }} />
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header options={{ title: t('alerts.history.title') }} />
      <ScrollView contentContainerStyle={styles.content} onScroll={onScroll} scrollEventThrottle={16}>
        {groups.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title={t('alerts.history.emptyTitle')}
            description={t('alerts.history.emptyDescription')}
          />
        ) : (
          groups.map((group) => (
            <View key={group.key}>
              <H3 style={styles.dayLabel}>
                {group.label}
              </H3>
              <View style={{ gap: 12 }}>
                {group.alerts.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} styles={styles} />
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

/**
 * One alert.
 *
 * Its own component because it owns a `pressed` state, and a hook cannot run
 * inside `.map()`. It uses a static style array plus `onPressIn`/`onPressOut`
 * rather than the function form of `style`, which the css-interop swallows.
 */
function AlertRow({
  alert,
  styles,
}: {
  readonly alert: HousingAlert;
  readonly styles: ReturnType<typeof StyleSheet.create>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [pressed, setPressed] = useState(false);

  const heldReason =
    alert.deliveryState === 'suppressed' && alert.suppressionReason
      ? t(`alerts.history.suppressed.${alert.suppressionReason}`)
      : alert.deliveryState === 'pending'
        ? t('alerts.history.pending')
        : null;

  return (
    <Pressable
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => router.push(`/saved/alerts/${alert.id}`)}
      accessibilityRole="button"
      accessibilityLabel={t('alerts.history.openReason')}
      style={[styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowHeader}>
        <Ionicons name="pricetag-outline" size={ICON_SIZE} color={theme.colors.textSecondary} />
        <BloomText style={{ color: theme.colors.textSecondary }}>
          {alert.explanation.watchName}
        </BloomText>
      </View>
      <AlertExplanationText
        detail={alert.explanation.detail}
        watchName={alert.explanation.watchName}
      />
      {heldReason ? (
        <View style={styles.held}>
          <Ionicons name="pause-circle-outline" size={ICON_SIZE} color={theme.colors.warning} />
          <BloomText style={{ color: theme.colors.textSecondary }}>
            {heldReason}
          </BloomText>
        </View>
      ) : null}
    </Pressable>
  );
}
