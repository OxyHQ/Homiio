/**
 * Eviction solidarity board (tablón) — the public list of upcoming evictions
 * (desahucios) neighbours can show up to stop.
 *
 * Layout: Header (+ auth-gated "Publicar" CTA) → Bloom Chip status filter →
 * flat `EvictionCard` list → floating map toggle (`MapFab`) revealing the pins.
 * Paginates through BOTH infinite-scroll primitives (native `onScroll` +
 * web `LoadMoreSentinel`). Public browse: no auth needed to read.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';

import { EvictionCaseStatus } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import Map from '@/components/Map';
import { MapFab } from '@/components/ui/MapFab';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useEvictions } from '@/hooks/useEvictionQueries';
import { EvictionCard } from '@/components/evictions/EvictionCard';
import { formatEvictionShortDate } from '@/components/evictions/evictionUtils';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

const EMPTY_ILLUSTRATION: ImageSourcePropType = require('@/assets/illustrations/empty-inbox.png');

/** Board filters — one paginated server status per chip (no all-status feed). */
const FILTERS: { status: EvictionCaseStatus; i18nKey: string }[] = [
  { status: EvictionCaseStatus.UPCOMING, i18nKey: 'evictions.filter.upcoming' },
  { status: EvictionCaseStatus.STOPPED, i18nKey: 'evictions.filter.stopped' },
  { status: EvictionCaseStatus.POSTPONED, i18nKey: 'evictions.filter.postponed' },
  { status: EvictionCaseStatus.EXECUTED, i18nKey: 'evictions.filter.executed' },
];

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

  const [status, setStatus] = useState<EvictionCaseStatus>(EvictionCaseStatus.UPCOMING);
  const [showMap, setShowMap] = useState(false);

  const params = useMemo(() => ({ status }), [status]);
  const {
    cases,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useEvictions(params);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const { onScroll } = useInfiniteScroll({ onEndReached: handleEndReached, enabled: hasNextPage });

  const markers = useMemo(
    () =>
      cases
        .map((eviction) => {
          const coords = eviction.location?.coordinates?.coordinates;
          if (
            !coords ||
            coords.length !== 2 ||
            typeof coords[0] !== 'number' ||
            typeof coords[1] !== 'number' ||
            (coords[0] === 0 && coords[1] === 0)
          ) {
            return null;
          }
          return {
            id: eviction.id,
            coordinates: [coords[0], coords[1]] as [number, number],
            priceLabel: formatEvictionShortDate(eviction.scheduledAt, i18n.language),
          };
        })
        .filter(
          (m): m is { id: string; coordinates: [number, number]; priceLabel: string } =>
            m !== null,
        ),
    [cases, i18n.language],
  );

  const openDetail = useCallback(
    (id: string) => router.push(`/evictions/${id}`),
    [router],
  );

  const handlePublish = useCallback(() => {
    if (!isAuthenticated) {
      showSignInModal();
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

  const listBody = () => {
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
          <BloomText style={styles.emptyMessage}>{t('evictions.empty.subtitle')}</BloomText>
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
      <Header
        options={{
          title: t('evictions.title'),
          rightComponents: [publishButton],
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        {showMap ? (
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

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {FILTERS.map((entry) => {
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

            {listBody()}
          </ScrollView>
        )}

        <MapFab
          onPress={() => setShowMap((prev) => !prev)}
          label={showMap ? t('evictions.showList') : t('evictions.showMap')}
          icon={showMap ? 'list' : 'map'}
        />
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
