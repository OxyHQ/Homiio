/**
 * SimilarHomesSection — "Similar homes nearby" horizontal carousel on the
 * property detail screen (companion to the price-transparency block).
 *
 * A Bloom `Shelf` row of `PropertyCard`s, like the home sections.
 *
 * Sourced from `useAreaInsights(propertyId).comparables` (same React Query key
 * as `PriceRangeSection`, so the request is deduped). Renders nothing when
 * there are no comparables, the call errors, or while loading — the price block
 * above already owns the section's loading/empty affordances.
 */
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { Shelf } from '@oxy.so/bloom/media-shelf';
import { PropertyCard } from '@/components/PropertyCard';
import { SECTION_GUTTER } from '@/components/property/Section';
import { useAreaInsights } from '@/hooks';
import type { Property } from '@homiio/shared-types';

interface SimilarHomesSectionProps {
  propertyId: string;
}

export const SimilarHomesSection: React.FC<SimilarHomesSectionProps> = ({ propertyId }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { insights, loading, error } = useAreaInsights(propertyId);

  // Fail soft: the price block above surfaces loading/error; here we simply
  // don't render the carousel until we have real comparables to show.
  if (error || loading || !insights || insights.comparables.length === 0) {
    return null;
  }

  return (
    <Shelf title={t('property.similarHomes.title')} itemWidth={240} contentInset={SECTION_GUTTER}>
      {insights.comparables.map((item: Property) => (
        <PropertyCard
          key={item.id}
          property={item}
          showSaveButton={false}
          onPress={() => router.push(`/properties/${item.id}`)}
        />
      ))}
    </Shelf>
  );
};
