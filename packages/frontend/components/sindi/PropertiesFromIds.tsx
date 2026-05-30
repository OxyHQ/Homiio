import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { Property } from '@homiio/shared-types';
import { PropertyCard } from '@/components/PropertyCard';
import { propertyService } from '@/services/propertyService';
import { sindiStyles } from './styles';

/** Resolve the routable ID for a property (DB `_id` or external `id`). */
function propertyKey(property: Property): string | undefined {
  return property._id || property.id;
}

export interface PropertiesFromIdsProps {
  ids: string[];
}

/**
 * Fetch and render property cards from a list of IDs embedded in a chat message.
 *
 * Hydration goes through TanStack Query keyed on the ID set, so repeated renders
 * (including during streaming) reuse the cached result instead of re-fetching.
 * Missing/invalid IDs are skipped silently — the model occasionally references
 * properties that no longer exist.
 */
export const PropertiesFromIds = React.memo<PropertiesFromIdsProps>(({ ids }) => {
  const router = useRouter();

  const { data } = useQuery<Property[]>({
    queryKey: ['chat-properties', ...ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        ids.map((id) => propertyService.getPropertyById(id)),
      );
      return results.filter((property): property is Property => property !== null);
    },
  });

  const validProperties = (data ?? []).filter((property) => Boolean(propertyKey(property)));
  if (validProperties.length === 0) return null;

  return (
    <View style={sindiStyles.propertyCardsContainer}>
      {validProperties.map((property) => {
        const key = propertyKey(property);
        return (
          <PropertyCard
            key={key}
            property={property}
            orientation="horizontal"
            variant="compact"
            onPress={() => router.push(`/properties/${key}`)}
            showSaveButton={false}
          />
        );
      })}
    </View>
  );
});
PropertiesFromIds.displayName = 'PropertiesFromIds';
