/**
 * Address detail — properties + reviews at one address. Keyed by the ADDRESS
 * id (ADR 0001: the dwelling is the permanent identity; listings point at it).
 *
 * The reviews tab has sub-tabs (Overall / Apartment / Management / Building /
 * Area): each non-overall tab shows a client-side aggregate distribution per
 * dimension (`DimensionBreakdown`) plus the reviews that carry that section's
 * fields, rendered with the shared `ReviewCard`. Authors are hydrated ONCE at
 * the screen level (`useOxyAvatars`). No fake confidence/evidence badges, no
 * Alert stubs — Helpful / Report are real inside `ReviewCard`.
 *
 * The review summary is a Bloom `Rating` (real average + count, only when the
 * address has reviews) over a `RatingBar` for the recommend share.
 *
 * Sections sit on outlined Bloom `Card`s; the Properties/Reviews switch and the
 * review sub-tabs are Bloom `Tabs`.
 */
import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import {
  RiChat3Line,
  RiDiscussLine,
  RiEditBoxLine,
  RiHomeLine,
  RiSearchLine,
} from '@oxy.so/bloom/icons';
import { Rating, RatingBar } from '@oxy.so/bloom/rating';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { H2, H3 } from '@oxy.so/bloom/typography';
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
import { reviewHasSection, type ReviewSection } from '@/components/reviews/dimensions';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { reviewService } from '@/services/reviewService';
import { api } from '@/utils/api';
import type { Property, ReviewDTO } from '@homiio/shared-types';
import { spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

interface AddressData {
  id: string;
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
          icon={RiSearchLine}
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
          <Card variant="outlined" radius="radius-16" style={styles.sectionCard}>
            <AddressDisplay address={addressForDisplay} variant="detailed" showActions />
          </Card>

          {reviews.length > 0 ? (
            <Card variant="outlined" radius="radius-16" style={styles.sectionCard}>
              <SectionEyebrow>{t('addresses.detail.reviewsSection')}</SectionEyebrow>
              <Rating
                value={summary.averageRating}
                count={summary.totalReviews}
                accessibilityLabel={`${t('reviews.ratingA11y', {
                  rating: Number(summary.averageRating.toFixed(2)),
                })}, ${t('reviews.explore.reviewCount', { count: summary.totalReviews })}`}
              />
              <RatingBar
                label={t('addresses.detail.metricRecommend')}
                value={summary.recommendationPercentage}
                max={100}
                display={`${Math.round(summary.recommendationPercentage)}%`}
              />
            </Card>
          ) : null}

          <Card variant="outlined" radius="radius-16" style={styles.sectionCard}>
            <NeighborhoodRatingWidget
              neighborhoodName={address.neighborhoodName || ''}
              city={address.cityName ?? ''}
              state={address.regionName ?? ''}
            />
          </Card>

          <Tabs
            variant="pill"
            fullWidth
            value={contentTab}
            onValueChange={(next) => setContentTab(next as ContentTab)}
          >
            <TabsTrigger
              value="properties"
              label={t('addresses.detail.tabProperties', { count: properties.length })}
              leadingIcon={RiHomeLine}
            />
            <TabsTrigger
              value="reviews"
              label={t('addresses.detail.tabReviews', { count: reviews.length })}
              leadingIcon={RiDiscussLine}
            />
          </Tabs>

          {contentTab === 'properties' ? (
            <Card variant="outlined" radius="radius-16" style={styles.sectionCard}>
              <H3 style={styles.cardHeading}>{t('addresses.detail.propertiesSection')}</H3>
              {properties.length === 0 ? (
                <EmptyState
                  icon={RiHomeLine}
                  title={t('addresses.detail.emptyPropertiesTitle')}
                  description={t('addresses.detail.emptyPropertiesDescription')}
                />
              ) : (
                <View style={styles.propertiesList}>
                  {properties.map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      onPress={() => router.push(`/properties/${property.id}`)}
                      variant="compact"
                      orientation="horizontal"
                    />
                  ))}
                </View>
              )}
            </Card>
          ) : (
            <Card variant="outlined" radius="radius-16" style={styles.sectionCard}>
              <View style={styles.reviewsHeader}>
                <View style={styles.headerText}>
                  <SectionEyebrow>{t('addresses.detail.reviewsSection')}</SectionEyebrow>
                  <H2 style={styles.cardHeading}>{t('addresses.detail.storiesTitle')}</H2>
                </View>
                <Button
                  variant="primary"
                  size="medium"
                  onPress={handleWriteReview}
                  leadingIcon={RiEditBoxLine}
                >
                  {t('addresses.detail.writeReview')}
                </Button>
              </View>

              <Tabs
                variant="filled"
                value={reviewTab}
                onValueChange={(next) => setReviewTab(next as ReviewTab)}
              >
                {REVIEW_TABS.map((entry) => (
                  <TabsTrigger key={entry.id} value={entry.id} label={t(entry.labelKey)} />
                ))}
              </Tabs>

              {reviewTab !== 'overall' && reviews.length > 0 ? (
                <DimensionBreakdown reviews={reviews} section={reviewTab} />
              ) : null}

              {filteredReviews.length === 0 ? (
                <EmptyState
                  icon={RiChat3Line}
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
            </Card>
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
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeading: {
    letterSpacing: -0.3,
  },
  propertiesList: {
    gap: spacing.md,
  },
  reviewsHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 180,
    gap: spacing.xs,
  },
  reviewsList: {
    gap: spacing.md,
  },
});
