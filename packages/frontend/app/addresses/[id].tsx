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
 * The review summary is Bloom's `PlaceReviewSummary` (`PlaceReviewsSummary`:
 * the real average and count, only when the address has reviews, with the
 * recommend and deposit-returned shares above the publication floor), and the
 * invitation to review is Bloom's `WriteReviewPrompt`.
 *
 * Sections sit on outlined Bloom `Card`s; the Properties/Reviews switch and the
 * review sub-tabs are Bloom `Tabs`.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Card } from '@oxy.so/bloom/card';
import { RiChat3Line, RiDiscussLine, RiHomeLine, RiSearchLine } from '@oxy.so/bloom/icons';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { WriteReviewPrompt } from '@oxy.so/bloom/place-reviews';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { H2, H3 } from '@oxy.so/bloom/typography';
import { useTranslation } from 'react-i18next';

import { AddressDisplay } from '@/components/AddressDisplay';
import { PropertyCard } from '@/components/PropertyCard';
import { PropertyListSkeleton } from '@/components/ui/skeletons/PropertyListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { NeighborhoodRatingWidget } from '@/components/widgets/NeighborhoodRatingWidget';
import { ReviewCard } from '@/components/ReviewCard';
import { DimensionBreakdown } from '@/components/reviews/DimensionBreakdown';
import { PlaceReviewsSummary, placeReviewStats } from '@/components/reviews/PlaceReviewsSummary';
import { reviewHasSection, type ReviewSection } from '@/components/reviews/dimensions';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { reviewService } from '@/services/reviewService';
import { api } from '@/utils/api';
import type { Property, ReviewDTO } from '@homiio/shared-types';
import { spacing } from '@/constants/styles';

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

export default function AddressDetailsPage() {
  const { t } = useTranslation();
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const addressId = id;

  const [contentTab, setContentTab] = useState<ContentTab>(
    tab === 'reviews' ? 'reviews' : 'properties',
  );
  const [reviewTab, setReviewTab] = useState<ReviewTab>('overall');

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

  const summary = useMemo(() => placeReviewStats(reviews), [reviews]);

  const filteredReviews = useMemo(() => {
    if (reviewTab === 'overall') return reviews;
    return reviews.filter((review) => reviewHasSection(review, reviewTab));
  }, [reviews, reviewTab]);

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

  const header = (
    <PageHeader
      title={headerTitle}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  );

  if (addressQuery.isLoading) {
    return (
      <>
        {header}
        <View style={styles.content}>
          <PropertyListSkeleton viewMode="list" />
        </View>
      </>
    );
  }

  if (!address) {
    return (
      <>
        {header}
        <ErrorState
          icon={RiSearchLine}
          title={t('addresses.detail.notFound')}
          description={t('addresses.detail.notFoundDescription')}
          onRetry={() => router.back()}
          retryLabel={t('common.goBack')}
        />
      </>
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
    <>
      {header}
      <View style={styles.content}>
        <Card radius="radius-16" style={styles.sectionCard} appearance="outline">
          <AddressDisplay address={addressForDisplay} variant="detailed" showActions />
        </Card>

        {reviews.length > 0 ? (
          <Card radius="radius-16" style={styles.sectionCard} appearance="outline">
            <SectionEyebrow>{t('addresses.detail.reviewsSection')}</SectionEyebrow>
            <PlaceReviewsSummary stats={summary} />
          </Card>
        ) : null}

        <Card radius="radius-16" style={styles.sectionCard} appearance="outline">
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
          <Card radius="radius-16" style={styles.sectionCard} appearance="outline">
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
          <Card radius="radius-16" style={styles.sectionCard} appearance="outline">
            <View style={styles.headerText}>
              <SectionEyebrow>{t('addresses.detail.reviewsSection')}</SectionEyebrow>
              <H2 style={styles.cardHeading}>{t('addresses.detail.storiesTitle')}</H2>
            </View>

            <WriteReviewPrompt
              buildingTitle={address.street || getAddressTitle()}
              title={t('reviews.prompt.title')}
              description={
                address.street
                  ? t('reviews.prompt.description', { place: address.street })
                  : t('addresses.detail.emptyReviewsDescription')
              }
              actionLabel={t('addresses.detail.writeReview')}
              onStart={handleWriteReview}
            />

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
                    author={review.oxyUserId ? usersById.get(review.oxyUserId) : undefined}
                    onPressAgency={(slug) => router.push(`/agency/${slug}`)}
                  />
                ))}
              </View>
            )}
          </Card>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
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
  headerText: {
    gap: spacing.xs,
  },
  reviewsList: {
    gap: spacing.md,
  },
});
