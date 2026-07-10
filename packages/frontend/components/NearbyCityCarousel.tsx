import React from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import type { City, Property } from '@homiio/shared-types';

import { PropertyCard } from '@/components/PropertyCard';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { usePropertiesByCity } from '@/hooks/useCityQueries';

interface NearbyCityCarouselProps {
  city: City;
}

export function NearbyCityCarousel({ city }: NearbyCityCarouselProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { data } = usePropertiesByCity(city._id, { limit: 8 });
  const cityProperties = (data?.properties as Property[] | undefined) ?? [];

  if (cityProperties.length === 0) return null;

  return (
    <HomeCarouselSection
      title={t('home.nearby.title', { city: city.name })}
      items={cityProperties}
      loading={false}
      renderItem={(property) => (
        <PropertyCard
          property={property}
          variant="featured"
          enableImageCarousel={false}
          onPress={() => router.push(`/properties/${property._id || property.id}`)}
        />
      )}
    />
  );
}
