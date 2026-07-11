/**
 * Review explore — landing. An intro, a "Write a review" CTA, and the list of
 * cities that have reviews (name + review count + average rating). Tapping a
 * city drills into its neighborhoods.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ExploreRow } from '@/components/reviews/ExploreRow';
import { useExploreCities } from '@/hooks/useExploreReviews';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

export default function ReviewExploreScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const citiesQuery = useExploreCities();
  const cities = citiesQuery.data ?? [];

  return (
    <View style={styles.root}>
      <Header options={{ title: t('reviews.explore.title'), showBackButton: true }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.intro}>
            <H1 style={styles.introTitle}>{t('reviews.explore.heroTitle')}</H1>
            <BloomText style={styles.introText}>{t('reviews.explore.heroSubtitle')}</BloomText>
            <Button
              variant="primary"
              size="large"
              onPress={() => router.push('/reviews/write')}
              icon={<Ionicons name="create-outline" size={18} color={colors.primaryForeground} />}
              style={styles.cta}
            >
              {t('reviews.explore.writeCta')}
            </Button>
          </View>

          <BloomText style={styles.sectionTitle}>{t('reviews.explore.citiesTitle')}</BloomText>

          {citiesQuery.isLoading ? (
            <View style={styles.list}>
              {Array.from({ length: 4 }).map((_, idx) => (
                <Skeleton.Box key={idx} width="100%" height={56} borderRadius={radius.md} />
              ))}
            </View>
          ) : citiesQuery.isError ? (
            <ErrorState
              icon="cloud-offline-outline"
              title={t('reviews.explore.errorTitle')}
              description={t('reviews.explore.errorDescription')}
              retryLabel={t('common.tryAgain')}
              onRetry={() => citiesQuery.refetch()}
            />
          ) : cities.length === 0 ? (
            <EmptyState
              icon="map-outline"
              title={t('reviews.explore.emptyCitiesTitle')}
              description={t('reviews.explore.emptyCitiesDescription')}
            />
          ) : (
            <View style={styles.list}>
              {cities.map((city) => (
                <ExploreRow
                  key={city.cityId}
                  title={city.name}
                  subtitle={t('reviews.explore.reviewCount', { count: city.reviewCount })}
                  rightLabel={`${city.averageRating.toFixed(1)} ★`}
                  onPress={() => router.push(`/reviews/city/${city.cityId}`)}
                />
              ))}
            </View>
          )}
        </ScrollView>
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
    gap: spacing.xl,
    paddingBottom: spacing['4xl'],
  },
  intro: {
    gap: spacing.sm,
  },
  introTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -0.6,
  },
  introText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  cta: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -0.3,
  },
  list: {
    gap: spacing.sm,
  },
});
