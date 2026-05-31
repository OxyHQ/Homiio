/**
 * SimilarHomesSection — "Similar homes nearby" horizontal carousel on the
 * property detail screen (companion to the price-transparency block).
 *
 * Reuses the home-page `HomeCarouselSection` row (same gutter/bleed + snap
 * behaviour) and `PropertyCard`. Cards pass `enableImageCarousel={false}` so an
 * in-card photo pager never fights the row swipe — the established rule for
 * cards inside a horizontal scroller.
 *
 * Sourced from `useAreaInsights(propertyId).comparables` (same React Query key
 * as `PriceRangeSection`, so the request is deduped). Renders nothing when
 * there are no comparables, the call errors, or while loading — the price block
 * above already owns the section's loading/empty affordances.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { PropertyCard } from '@/components/PropertyCard';
import { useAreaInsights } from '@/hooks';
import type { Property } from '@homiio/shared-types';

interface SimilarHomesSectionProps {
  propertyId: string;
}

export const SimilarHomesSection: React.FC<SimilarHomesSectionProps> = ({
  propertyId,
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { insights, loading, error } = useAreaInsights(propertyId);

  // Fail soft: the price block above surfaces loading/error; here we simply
  // don't render the carousel until we have real comparables to show.
  if (error || loading || !insights || insights.comparables.length === 0) {
    return null;
  }

  return (
    <HomeCarouselSection<Property>
      title={t('property.similarHomes.title')}
      items={insights.comparables}
      loading={false}
      renderItem={(item) => (
        <PropertyCard
          property={item}
          variant="default"
          enableImageCarousel={false}
          showSaveButton={false}
          showRating={false}
          onPress={() => router.push(`/properties/${item._id || item.id}`)}
        />
      )}
    />
  );
};

export default SimilarHomesSection;
