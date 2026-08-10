import {
  ExchangeMode,
  OfferingType,
  PropertyType,
  type PropertyFilters,
} from '@homiio/shared-types';

import type { HomeCategory } from './homeCategoryStore';

interface CategoryFilterContext {
  userLocation?: { latitude: number; longitude: number } | null;
  offering?: OfferingType;
}

/**
 * Radius for the "Near you" home-category lens, in **METRES**.
 *
 * It was `NEAR_YOU_RADIUS_KM = 25` and was sent verbatim as `radius`, which
 * every consumer of that parameter reads as metres (`PropertyFilters.radius`
 * now says so). So the lens asked for listings within 25 METRES of the device
 * and got a page ranked by an "inside 25 m" flag that is false for every
 * listing there has ever been. Nothing failed; the feed just stopped being
 * "near you" while still being labelled it.
 *
 * Correcting the unit fixes the RANKING. It does not make the lens filter:
 * `GET /api/properties`, which the home feed calls, builds no spatial predicate
 * at all and uses this only as a tiebreak. Closing that is ADR 0002 §14.3,
 * deliberately left to #353 rather than widened into here.
 */
const NEAR_YOU_RADIUS_METERS = 25_000;

/** Monthly rent floor for the merchandised "Luxury" long-term bucket. */
const LUXURY_MIN_RENT = 2500;

/** Sale-price floor for the merchandised "Luxury" buy bucket. */
const LUXURY_MIN_SALE_PRICE = 400_000;

/**
 * Maps a selected {@link HomeCategory} to API-backed {@link PropertyFilters}.
 * Returns an empty object when `category` is null ("all listings").
 */
export function getCategoryFilters(
  category: HomeCategory | null,
  context: CategoryFilterContext = {},
): Partial<PropertyFilters> {
  if (!category) return {};

  const offering = context.offering;

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
      if (offering === OfferingType.SALE) {
        return { minSalePrice: LUXURY_MIN_SALE_PRICE };
      }
      return { minRent: LUXURY_MIN_RENT };
    case 'new_listings':
      // Default list sort is `createdAt desc` — no extra filter required.
      return {};
    case 'near_you': {
      const loc = context.userLocation;
      if (!loc) return {};
      // Consumers must gate the feed when location is missing — see `isNearYouBlocked`.
      return { lat: loc.latitude, lng: loc.longitude, radius: NEAR_YOU_RADIUS_METERS };
    }
    case 'beachfront':
      return { amenities: ['waterfront_view'] };
    case 'cabins':
      return { amenities: ['fire_pit'] };
    case 'pools':
      return { amenities: ['swimming_pool'] };
    case 'mountain':
      return { amenities: ['nature_immersion'] };
    case 'city_breaks':
      return { type: PropertyType.APARTMENT };
    case 'countryside':
      return { amenities: ['garden_access'] };
    case 'instant_book':
      return { instantBook: true };
    case 'pet_friendly':
      return { petFriendly: true };
    case 'home_swap':
      return { exchangeMode: ExchangeMode.SWAP };
    case 'hosting':
      return { exchangeMode: ExchangeMode.HOST };
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}
