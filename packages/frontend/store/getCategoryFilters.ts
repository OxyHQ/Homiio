import { PropertyType, type PropertyFilters } from '@homiio/shared-types';

import type { HomeCategory } from './homeCategoryStore';

interface CategoryFilterContext {
  userLocation?: { latitude: number; longitude: number } | null;
}

/** Radius (km) for the "Near you" home-category lens. */
const NEAR_YOU_RADIUS_KM = 25;

/** Monthly rent floor for the merchandised "Luxury" long-term bucket. */
const LUXURY_MIN_RENT = 2500;

/**
 * Maps a selected {@link HomeCategory} to API-backed {@link PropertyFilters}.
 * Returns an empty object when `category` is null ("all listings").
 */
export function getCategoryFilters(
  category: HomeCategory | null,
  context: CategoryFilterContext = {},
): Partial<PropertyFilters> {
  if (!category) return {};

  switch (category) {
    case 'studios':
      return { type: PropertyType.STUDIO };
    case 'apartments':
      return { type: PropertyType.APARTMENT };
    case 'houses':
      return { type: PropertyType.HOUSE };
    case 'rooms':
      return { type: PropertyType.ROOM };
    case 'coliving':
      return { type: PropertyType.COLIVING };
    case 'luxury':
      return { minRent: LUXURY_MIN_RENT };
    case 'new_listings':
      // Default list sort is `createdAt desc` — no extra filter required.
      return {};
    case 'near_you': {
      const loc = context.userLocation;
      if (!loc) return {};
      return { lat: loc.latitude, lng: loc.longitude, radius: NEAR_YOU_RADIUS_KM };
    }
    case 'beachfront':
      return { amenities: ['waterfront_view'] };
    case 'cabins':
      return { type: PropertyType.HOUSE };
    case 'pools':
      return { amenities: ['swimming_pool'] };
    case 'mountain':
      return { type: PropertyType.HOUSE };
    case 'city_breaks':
      return { type: PropertyType.APARTMENT };
    case 'countryside':
      return { type: PropertyType.HOUSE };
    case 'instant_book':
      return { instantBook: true };
    case 'pet_friendly':
      return { petFriendly: true };
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}
