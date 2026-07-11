/**
 * Address detail — properties + reviews at one address.
 *
 * The reviews tab has sub-tabs (Overall / Apartment / Management / Building /
 * Area): each non-overall tab shows a client-side aggregate distribution per
 * dimension (`DimensionBreakdown`) plus the reviews that carry that section's
 * fields, rendered with the shared `ReviewCard`. Authors are hydrated ONCE at
 * the screen level (`useOxyAvatars`). No fake confidence/evidence badges, no
 * Alert stubs — Helpful / Report are real inside `ReviewCard`.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { useTranslation } from 'react-i18next';

import { AddressDisplay } from '@/components/AddressDisplay';
import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { PropertyListSkeleton } from '@/components/ui/skeletons/PropertyListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { NeighborhoodRatingWidget } from '@/components/widgets/NeighborhoodRatingWidget';
import { ReviewCard } from '@/components/ReviewCard';
import { DimensionBreakdown } from '@/components/reviews/DimensionBreakdown';
import { ReviewTabPill } from '@/components/reviews/ReviewTabPill';
import { reviewHasSection, type ReviewSection } from '@/components/reviews/dimensions';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { reviewService } from '@/services/reviewService';
import { api } from '@/utils/api';
import type { Property, ReviewDTO } from '@homiio/shared-types';
import { radius, spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface AddressData {
  _id: string;
  street: string;
  postal_code?: string;
  cityName?: string;
  regionName?: string;
  countryName?: string;
  neighborhoodName?: string;
  coordinates?: {
    type: 'Point';
    coordinates: [number, number];
  };
  location?: string;
}

type ReviewTab = 'overall' | ReviewSection;
type ContentTab = 'properties' | 'reviews';

const REVIEW_TABS: { id: ReviewTab; labelKey: string }[] = [
  { id: 'overall', labelKey: 'addresses.detail.tabOverall' },
  { id: 'apartment', labelKey: 'addresses.detail.tabApartment' },
  { id: 'management', labelKey: 'addresses.detail.tabManagement' },
  { id: 'building', labelKey: 'addresses.detail.tabBuilding' },
  { id: 'area', labelKey: 'addresses.detail.tabArea' },
];

interface ContentTabButtonProps {
  label: string;
  icon: IoniconName;
  active: boolean;
  onPress: () => void;
}

const ContentTabButton: React.FC<ContentTabButtonProps> = ({ label, icon, active, onPress }) => {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.tabPill, active && styles.tabPillActive, pressed && styles.tabPillPressed]}
    >
      <Ionicons name={icon} size={16} color={active ? colors.white : colors.COLOR_BLACK_LIGHT_2} />
      <BloomText style={[styles.tabPillLabel, active && styles.tabPillLabelActive]}>
        {label}
      </BloomText>
    </Pressable>
  );
};

const computeSummary = (reviews: ReviewDTO[]) => {
  if (reviews.length === 0) {
    return { averageRating: 0, totalReviews: 0, recommendationPercentage: 0 };
  }
  const ratingSum = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
  const recommended = reviews.filter((r) => r.recommendation).length;
  return {
    averageRating: ratingSum / reviews.length,
    totalReviews: reviews.length,
    recommendationPercentage: (recommended / reviews.length) * 100,
  };
};

export default function AddressDetailsPage() {
  const { t } = useTranslation();
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const addressId = id;

  const [contentTab, setContentTab] = useState<ContentTab>(
    tab === 'reviews' ? 'reviews' : 'properties',
  );
  const [reviewTab, setReviewTab] = useState<ReviewTab>('overall');
  const [refreshing, setRefreshing] = useState(false);

  const addressQuery = useQuery<AddressData | null>({
    queryKey: ['address', addressId],
    enabled: Boolean(addressId),
    queryFn: async () => {
      const response = await api.get(`/api/addresses/${addressId}`);
      return (response.data?.address || response.data) as AddressData;
    },
  });

  const propertiesQuery = useQuery<Property[]>({
    queryKey: ['addressProperties', addressId],
    enabled: Boolean(addressId),
    queryFn: async () => {
      const response = await api.get('/api/properties/search', {
        params: { addressId, limit: 50 },
        requireAuth: false,
      });
      return (response.data?.data || response.data?.properties || []) as Property[];
    },
  });

  const reviewsQuery = useQuery<ReviewDTO[]>({
    queryKey: ['addressReviews', addressId],
    enabled: Boolean(addressId),
    queryFn: async () => {
      if (!addressId) return [];
      const result = await reviewService.getReviewsByAddress(addressId);
      return result.reviews;
    },
  });

  const address = addressQuery.data ?? null;
  const properties = propertiesQuery.data ?? [];
  const reviews = useMemo(() => reviewsQuery.data ?? [], [reviewsQuery.data]);

  const { usersById } = useOxyAvatars(reviews.map((review) => review.oxyUserId));

  const summary = useMemo(() => computeSummary(reviews), [reviews]);

  const filteredReviews = useMemo(() => {
    if (reviewTab === 'overall') return reviews;
    return reviews.filter((review) => reviewHasSection(review, reviewTab));
  }, [reviews, reviewTab]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        addressQuery.refetch(),
        propertiesQuery.refetch(),
        reviewsQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const getAddressTitle = () => {
    if (!address) return t('addresses.detail.title');
    const parts = [address.street, address.cityName, address.regionName].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
    if (address.location) return address.location;
    return t('addresses.detail.title');
  };

  const headerTitle = (() => {
    const raw = getAddressTitle();
    return raw.length > 35 ? `${raw.substring(0, 32)}...` : raw;
  })();

  const handleWriteReview = () => {
    router.push(`/reviews/write?addressId=${addressId}`);
  };

  if (addressQuery.isLoading && !refreshing) {
    return (
      <View style={styles.root}>
        <Header options={{ title: headerTitle, showBackButton: true }} />
        <ScrollView contentContainerStyle={styles.content}>
          <PropertyListSkeleton viewMode="list" />
        </ScrollView>
      </View>
    );
  }

  if (!address) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('addresses.detail.title'), showBackButton: true }} />
        <ErrorState
          icon="search-outline"
          title={t('addresses.detail.notFound')}
          description={t('addresses.detail.notFoundDescription')}
          onRetry={() => router.back()}
          retryLabel={t('common.goBack')}
        />
      </View>
    );
  }

  const addressForDisplay = {
    street: address.street,
    city: address.cityName ?? '',
    state: address.regionName ?? '',
    zipCode: address.postal_code ?? '',
    country: address.countryName,
    coordinates: address.coordinates
      ? { lat: address.coordinates.coordinates[1], lng: address.coordinates.coordinates[0] }
      : undefined,
  };

  return (
    <View style={styles.root}>
      <Header options={{ title: headerTitle, showBackButton: true }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primaryColor]}
            />
          }
        >
          <View style={styles.sectionCard}>
            <AddressDisplay address={addressForDisplay} variant="detailed" showActions />
          </View>

          {reviews.length > 0 ? (
            <View style={styles.sectionCard}>
              <SectionEyebrow>{t('addresses.detail.reviewsSection')}</SectionEyebrow>
              <View style={styles.metricsRow}>
                <View style={styles.metric}>
                  <BloomText style={styles.metricValue}>
                    {summary.averageRating.toFixed(1)}
                  </BloomText>
                  <BloomText style={styles.metricLabel}>
                    {t('addresses.detail.metricRating')}
                  </BloomText>
                </View>
                <View style={styles.metric}>
                  <BloomText style={styles.metricValue}>{summary.totalReviews}</BloomText>
                  <BloomText style={styles.metricLabel}>
                    {t('addresses.detail.metricReviews')}
                  </BloomText>
                </View>
                <View style={styles.metric}>
                  <BloomText style={styles.metricValue}>
                    {Math.round(summary.recommendationPercentage)}%
                  </BloomText>
                  <BloomText style={styles.metricLabel}>
                    {t('addresses.detail.metricRecommend')}
                  </BloomText>
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.sectionCard}>
            <NeighborhoodRatingWidget
              neighborhoodName={address.neighborhoodName || ''}
              city={address.cityName ?? ''}
              state={address.regionName ?? ''}
            />
          </View>

          <View style={styles.tabSwitcher}>
            <ContentTabButton
              label={t('addresses.detail.tabProperties', { count: properties.length })}
              icon="home-outline"
              active={contentTab === 'properties'}
              onPress={() => setContentTab('properties')}
            />
            <ContentTabButton
              label={t('addresses.detail.tabReviews', { count: reviews.length })}
              icon="chatbubbles-outline"
              active={contentTab === 'reviews'}
              onPress={() => setContentTab('reviews')}
            />
          </View>

          {contentTab === 'properties' ? (
            <View style={styles.sectionCard}>
              <H3 style={styles.cardHeading}>{t('addresses.detail.propertiesSection')}</H3>
              {properties.length === 0 ? (
                <EmptyState
                  icon="home-outline"
                  title={t('addresses.detail.emptyPropertiesTitle')}
                  description={t('addresses.detail.emptyPropertiesDescription')}
                />
              ) : (
                <View style={styles.propertiesList}>
                  {properties.map((property) => (
                    <PropertyCard
                      key={property._id}
                      property={property}
                      onPress={() => router.push(`/properties/${property._id}`)}
                      variant="compact"
                      orientation="horizontal"
                    />
                  ))}
                </View>
              )}
            </View>
          ) : (
            <View style={styles.sectionCard}>
              <View style={styles.reviewsHeader}>
                <View style={styles.headerText}>
                  <SectionEyebrow>{t('addresses.detail.reviewsSection')}</SectionEyebrow>
                  <H2 style={styles.cardHeading}>{t('addresses.detail.storiesTitle')}</H2>
                </View>
                <Button
                  variant="primary"
                  size="medium"
                  onPress={handleWriteReview}
                  icon={<Ionicons name="create-outline" size={16} color={colors.primaryForeground} />}
                >
                  {t('addresses.detail.writeReview')}
                </Button>
              </View>

              <View style={styles.reviewTabBar}>
                {REVIEW_TABS.map((entry) => (
                  <ReviewTabPill
                    key={entry.id}
                    label={t(entry.labelKey)}
                    active={reviewTab === entry.id}
                    onPress={() => setReviewTab(entry.id)}
                  />
                ))}
              </View>

              {reviewTab !== 'overall' && reviews.length > 0 ? (
                <DimensionBreakdown reviews={reviews} section={reviewTab} />
              ) : null}

              {filteredReviews.length === 0 ? (
                <EmptyState
                  icon="chatbubble-outline"
                  title={t('addresses.detail.emptyReviewsTitle')}
                  description={t('addresses.detail.emptyReviewsDescription')}
                />
              ) : (
                <View style={styles.reviewsList}>
                  {filteredReviews.map((review) => (
                    <ReviewCard
                      key={review.id}
                      review={review}
                      author={usersById.get(review.oxyUserId)}
                      onPressAgency={(slug) => router.push(`/agency/${slug}`)}
                    />
                  ))}
                </View>
              )}
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
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  sectionCard: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeading: {
    letterSpacing: -0.3,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.mutedSubtle,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.primaryColor,
    letterSpacing: -0.5,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  tabSwitcher: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.xs,
    backgroundColor: colors.mutedSubtle,
    borderRadius: radius.pill,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  tabPillActive: {
    backgroundColor: colors.COLOR_BLACK,
  },
  tabPillPressed: {
    opacity: 0.85,
  },
  tabPillLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  tabPillLabelActive: {
    color: colors.white,
  },
  propertiesList: {
    gap: spacing.md,
  },
  reviewsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  reviewTabBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  reviewsList: {
    gap: spacing.md,
  },
});
