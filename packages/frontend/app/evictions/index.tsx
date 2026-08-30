/**
 * Eviction solidarity board (tablón) — the LOCAL list of upcoming evictions
 * (desahucios) neighbours can show up to stop.
 *
 * ## The board asks WHERE before it asks anything else
 *
 * There is no default feed. Until a scope is chosen the screen shows the scope
 * bar and an explanation, and the query does not run — `enabled: false`, not a
 * placeholder scope. The server refuses a scope-less request
 * (`LOCATION_SCOPE_REQUIRED`), and inventing `global` here to keep a spinner
 * moving would be exactly the silent widening ADR 0002 §2 forbids: *"a
 * geocoding failure never degrades into a worldwide feed"*.
 *
 * `?global=true` stays reachable, as a button somebody presses.
 *
 * ## List, map and count are ONE query
 *
 * The map draws markers built from the SAME `cases` array the list renders, and
 * the count is the `total` the same response carried. There is no second, wider
 * query for pins — which is the ordinary way a map and a list stop agreeing, and
 * on this board a pin the list does not explain is a place nobody can account
 * for.
 *
 * Layout: Header (+ auth-gated "Publicar") → scope bar → status and help-need
 * filters → sort → flat `EvictionCard` list → floating map toggle. Paginates
 * through BOTH infinite-scroll primitives (native `onScroll` + web
 * `LoadMoreSentinel`).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy, openAccountDialog } from '@oxyhq/services';

import {
  EvictionCaseStatus,
  EvictionHelpNeedType,
  type EvictionBoardScope,
  type EvictionBoardSort,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import Map from '@/components/Map';
import { MapFab } from '@/components/ui/MapFab';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { LocationScopeBar } from '@/components/location/LocationScopeBar';
import { useLocationScope } from '@/hooks/useLocationScope';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useEvictions } from '@/hooks/useEvictionQueries';
import { EvictionCard } from '@/components/evictions/EvictionCard';
import { selectionToBoardScope } from '@/components/evictions/evictionScope';
import { formatEvictionShortDate } from '@/components/evictions/evictionUtils';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

const EMPTY_ILLUSTRATION: ImageSourcePropType = require('@/assets/illustrations/empty-evictions.png');

/** Board filters — one paginated server status per chip (no all-status feed). */
const STATUS_FILTERS: { status: EvictionCaseStatus; i18nKey: string }[] = [
  { status: EvictionCaseStatus.UPCOMING, i18nKey: 'evictions.filter.upcoming' },
  { status: EvictionCaseStatus.STOPPED, i18nKey: 'evictions.filter.stopped' },
  { status: EvictionCaseStatus.POSTPONED, i18nKey: 'evictions.filter.postponed' },
  { status: EvictionCaseStatus.EXECUTED, i18nKey: 'evictions.filter.executed' },
  { status: EvictionCaseStatus.CANCELLED, i18nKey: 'evictions.filter.cancelled' },
];

const HELP_FILTERS: readonly EvictionHelpNeedType[] = [
  EvictionHelpNeedType.PRESENCE,
  EvictionHelpNeedType.LEGAL_SUPPORT,
  EvictionHelpNeedType.TRANSLATION,
  EvictionHelpNeedType.TRANSPORT,
  EvictionHelpNeedType.TEMPORARY_HOUSING,
  EvictionHelpNeedType.OUTREACH,
];

/** `distance` is offered only when the scope carries a centre — see below. */
const SORTS: readonly EvictionBoardSort[] = ['soonest', 'distance', 'recently_updated', 'newest'];

const BoardSkeleton: React.FC = () => (
  <View style={styles.listWrap}>
    {Array.from({ length: 4 }).map((_, idx) => (
      <View key={idx} style={styles.skeletonCard}>
        <Skeleton.Box width={60} height={60} borderRadius={radius.md} />
        <View style={styles.skeletonBody}>
          <Skeleton.Text style={{ width: 200, lineHeight: 18 }} />
          <Skeleton.Text style={{ width: 140, lineHeight: 14 }} />
          <Skeleton.Text style={{ width: 90, lineHeight: 14 }} />
        </View>
      </View>
    ))}
  </View>
);

export default function EvictionsBoardScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { isAuthenticated } = useOxy();

  // The APP-WIDE scope (#353), not a board-local one. Home and this board read
  // the same ladder, so two surfaces cannot disagree about where the user is —
  // and `canQuery` is the single flag that answers "may I fetch?", rather than
  // each screen re-deriving it from a combination one of them will get wrong.
  const scope = useLocationScope();
  const [status, setStatus] = useState<EvictionCaseStatus>(EvictionCaseStatus.UPCOMING);
  const [helpNeed, setHelpNeed] = useState<EvictionHelpNeedType | undefined>(undefined);
  const [sort, setSort] = useState<EvictionBoardSort>('soonest');
  const [showMap, setShowMap] = useState(false);

  /**
   * The board scope, from the shared selection or the EXPLICIT global mode.
   *
   * `isGlobal` rather than `selection === null`: "everywhere" is a decision
   * somebody made and "nothing chosen yet" is the state that must never look
   * like one. A device failure leaves this `undefined`, which is what stops the
   * board answering with the world.
   */
  const boardScope: EvictionBoardScope | undefined = useMemo(
    () => (scope.isGlobal ? { kind: 'global' } : selectionToBoardScope(scope.selection)),
    [scope.isGlobal, scope.selection],
  );

  const hasCentre = boardScope?.kind === 'radius' || boardScope?.kind === 'bbox';
  // Asking for a distance sort without a centre is a 400, so the control that
  // could produce one is not offered — the server's refusal is the backstop, not
  // the interaction.
  const effectiveSort: EvictionBoardSort = sort === 'distance' && !hasCentre ? 'soonest' : sort;

  const params = useMemo(
    () =>
      boardScope
        ? { scope: boardScope, status, helpNeed, sort: effectiveSort }
        : // Never dispatched: the query below is disabled without a scope. The
          // placeholder exists only because the params object is memoised above
          // the enabled check.
          { scope: { kind: 'global' } as EvictionBoardScope, status, helpNeed, sort: effectiveSort },
    [boardScope, status, helpNeed, effectiveSort],
  );

  const {
    cases,
    total,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useEvictions(params, { enabled: scope.canQuery && Boolean(boardScope) });

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const { onScroll } = useInfiniteScroll({ onEndReached: handleEndReached, enabled: hasNextPage });

  /**
   * Map markers, from the SAME array the list renders.
   *
   * A case under a precautionary hold publishes no coordinate at all, so it has
   * no marker — and that is correct rather than a gap: the list still shows it,
   * and the map does not point at a place the server refused to state.
   */
  const markers = useMemo(
    () =>
      cases
        .map((eviction) => {
          const coords = eviction.location.approximateCoordinates;
          if (!coords) return null;
          return {
            id: eviction.id,
            coordinates: [coords[0], coords[1]] as [number, number],
            priceLabel: formatEvictionShortDate(eviction.scheduledAt, i18n.language),
          };
        })
        .filter(
          (marker): marker is { id: string; coordinates: [number, number]; priceLabel: string } =>
            marker !== null,
        ),
    [cases, i18n.language],
  );

  const openDetail = useCallback((id: string) => router.push(`/evictions/${id}`), [router]);

  const handlePublish = useCallback(() => {
    if (!isAuthenticated) {
      openAccountDialog();
      return;
    }
    router.push('/evictions/new');
  }, [isAuthenticated, router]);

  const publishButton = (
    <Button
      key="publish"
      variant="primary"
      size="small"
      onPress={handlePublish}
      icon={<Ionicons name="add" size={16} color={colors.primaryForeground} />}
      iconPosition="left"
      accessibilityLabel={t('evictions.publishCta')}
    >
      {t('evictions.publishCta')}
    </Button>
  );

  const scopePrompt = (
    <View style={styles.scopePrompt}>
      <Ionicons name="compass-outline" size={28} color={colors.textSecondary} />
      <H3 style={styles.emptyTitle}>{t('evictions.scope.title')}</H3>
      <BloomText style={styles.emptyMessage}>{t('evictions.scope.subtitle')}</BloomText>
      <View style={styles.scopeActions}>
        <Button
          variant="primary"
          size="medium"
          onPress={scope.useCurrentLocation}
          icon={<Ionicons name="navigate" size={16} color={colors.primaryForeground} />}
          iconPosition="left"
        >
          {t('evictions.scope.useMyLocation')}
        </Button>
        <Button variant="outline" size="medium" onPress={scope.exploreGlobal}>
          {t('evictions.scope.browseGlobal')}
        </Button>
      </View>
    </View>
  );

  const listBody = () => {
    if (!boardScope) return scopePrompt;
    if (isLoading && cases.length === 0) return <BoardSkeleton />;
    if (isError) {
      return (
        <ErrorState
          icon="cloud-offline-outline"
          title={t('evictions.loadError')}
          description={error?.message ?? t('common.tryAgain')}
          onRetry={() => void refetch()}
        />
      );
    }
    if (cases.length === 0) {
      return (
        <View style={styles.emptyWrap}>
          <Image
            source={EMPTY_ILLUSTRATION}
            style={styles.emptyImage}
            contentFit="contain"
            accessibilityIgnoresInvertColors
          />
          <H3 style={styles.emptyTitle}>{t('evictions.empty.title')}</H3>
          <BloomText style={styles.emptyMessage}>
            {/* The empty state names the AREA, so "nothing here" cannot be
                mistaken for "nothing anywhere". */}
            {t('evictions.empty.scoped')}
          </BloomText>
          <Button
            variant="primary"
            size="medium"
            onPress={handlePublish}
            icon={<Ionicons name="add" size={18} color={colors.primaryForeground} />}
            iconPosition="left"
            style={styles.emptyCta}
          >
            {t('evictions.publishCta')}
          </Button>
        </View>
      );
    }
    return (
      <View style={styles.listWrap}>
        {cases.map((eviction) => (
          <EvictionCard
            key={eviction.id}
            eviction={eviction}
            locale={i18n.language}
            onPress={() => openDetail(eviction.id)}
          />
        ))}
        {isFetchingNextPage ? <BoardSkeleton /> : null}
        <LoadMoreSentinel enabled={hasNextPage} onLoadMore={handleEndReached} />
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <Header options={{ title: t('evictions.title'), rightComponents: [publishButton] }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        {showMap && boardScope ? (
          <View style={styles.mapPanel}>
            <Map
              style={styles.mapFill}
              screenId="evictions-map"
              markers={markers}
              onMarkerPress={({ id }) => openDetail(id)}
              cluster={{ enabled: true }}
            />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.titleBlock}>
              <SectionEyebrow>{t('evictions.eyebrow')}</SectionEyebrow>
              <H2 style={styles.title}>{t('evictions.title')}</H2>
              <BloomText style={styles.subtitle}>{t('evictions.subtitle')}</BloomText>
            </View>

            <LocationScopeBar
              selection={scope.selection}
              resolution={scope.resolution}
              onChange={(next) => {
                if (next) scope.choose(next);
              }}
              onExploreGlobal={scope.isGlobal ? undefined : scope.exploreGlobal}
              isGlobal={scope.isGlobal}
              nearbyPlace={scope.nearbyPlace}
              deviceUnavailable={scope.deviceIssue !== null}
              {...(scope.source === 'device' ? {} : { onUseCurrentLocation: scope.useCurrentLocation })}
            />

            {boardScope ? (
              <>
                <BloomText style={styles.count} accessibilityRole="header">
                  {t('evictions.countInScope', { count: total })}
                </BloomText>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}
                >
                  {STATUS_FILTERS.map((entry) => {
                    const isActive = status === entry.status;
                    return (
                      <Chip
                        key={entry.status}
                        onPress={() => setStatus(entry.status)}
                        variant={isActive ? 'solid' : 'outlined'}
                        color={isActive ? 'primary' : 'default'}
                        selected={isActive}
                      >
                        {t(entry.i18nKey)}
                      </Chip>
                    );
                  })}
                </ScrollView>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}
                >
                  {HELP_FILTERS.map((need) => {
                    const isActive = helpNeed === need;
                    return (
                      <Chip
                        key={need}
                        onPress={() => setHelpNeed(isActive ? undefined : need)}
                        variant={isActive ? 'solid' : 'outlined'}
                        color={isActive ? 'primary' : 'default'}
                        selected={isActive}
                      >
                        {t(`evictions.help.need.${need}`)}
                      </Chip>
                    );
                  })}
                </ScrollView>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}
                >
                  {SORTS.filter((entry) => entry !== 'distance' || hasCentre).map((entry) => {
                    const isActive = effectiveSort === entry;
                    return (
                      <Chip
                        key={entry}
                        onPress={() => setSort(entry)}
                        variant={isActive ? 'solid' : 'outlined'}
                        color={isActive ? 'primary' : 'default'}
                        selected={isActive}
                      >
                        {t(`evictions.sort.${entry}`)}
                      </Chip>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}

            {listBody()}
          </ScrollView>
        )}

        {boardScope ? (
          <MapFab
            onPress={() => setShowMap((prev) => !prev)}
            label={showMap ? t('evictions.showList') : t('evictions.showMap')}
            icon={showMap ? 'list' : 'map'}
          />
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  titleBlock: {
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  count: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  listWrap: {
    gap: spacing.md,
  },
  skeletonCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  scopePrompt: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.lg,
  },
  scopeActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['5xl'],
    paddingHorizontal: spacing['2xl'],
  },
  emptyImage: {
    width: 200,
    height: 200,
    marginBottom: spacing.xl,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emptyMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
    marginBottom: spacing.lg,
  },
  emptyCta: {
    alignSelf: 'center',
  },
  mapPanel: {
    flex: 1,
    position: 'relative',
  },
  mapFill: {
    ...StyleSheet.absoluteFill,
  },
});
