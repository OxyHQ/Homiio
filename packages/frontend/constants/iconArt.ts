import type { ImageSourcePropType } from 'react-native';

/**
 * Central registry for isometric PNG art across Homiio — home categories,
 * amenity catalog ids, property-feature ids, and nearby-service keys share
 * one visual source per id (`pet_friendly`, `gym`, `pools`/`swimming_pool`, …).
 * Ids without art return `undefined` so consumers fall back to Ionicons.
 */
export const ICON_ART: Partial<Record<string, ImageSourcePropType>> = {
  // Home categories (long-term + vacation)
  studios: require('@/assets/icon-art/studios.png'),
  rooms: require('@/assets/icon-art/rooms.png'),
  luxury: require('@/assets/icon-art/luxury.png'),
  near_you: require('@/assets/icon-art/near_you.png'),
  beachfront: require('@/assets/icon-art/beachfront.png'),
  cabins: require('@/assets/icon-art/cabins.png'),
  pools: require('@/assets/icon-art/pools.png'),
  mountain: require('@/assets/icon-art/mountain.png'),
  pet_friendly: require('@/assets/icon-art/pet_friendly.png'),
  home_swap: require('@/assets/icon-art/tent.png'),
  hosting: require('@/assets/icon-art/breakfast.png'),

  // Reserved home / feature art (no consumer yet)
  beach_chair: require('@/assets/icon-art/beach_chair.png'),
  breakfast: require('@/assets/icon-art/breakfast.png'),
  piano: require('@/assets/icon-art/piano.png'),
  tent: require('@/assets/icon-art/tent.png'),
  three_wheel_van: require('@/assets/icon-art/three_wheel_van.png'),

  // Amenity catalog + property-feature ids
  wifi: require('@/assets/icon-art/wifi.png'),
  heating: require('@/assets/icon-art/heating.png'),
  washing_machine: require('@/assets/icon-art/washing_machine.png'),
  dishwasher: require('@/assets/icon-art/dishwasher.png'),
  air_conditioning: require('@/assets/icon-art/air_conditioning.png'),
  elevator: require('@/assets/icon-art/elevator.png'),
  balcony: require('@/assets/icon-art/balcony.png'),
  gym: require('@/assets/icon-art/gym.png'),
  secure_entry: require('@/assets/icon-art/secure_entry.png'),
  parking_space: require('@/assets/icon-art/parking_space.png'),
  kitchen: require('@/assets/icon-art/kitchen.png'),
  swimming_pool: require('@/assets/icon-art/pools.png'),
  smart_home: require('@/assets/icon-art/smart_home.png'),
  rooftop_deck: require('@/assets/icon-art/rooftop_deck.png'),
  refrigerator: require('@/assets/icon-art/refrigerator.png'),
  furnished: require('@/assets/icon-art/furnished.png'),
  public_transit_access: require('@/assets/icon-art/public_transit_access.png'),
  dog_park: require('@/assets/icon-art/dog_park.png'),

  // Nearby service keys
  pharmacy: require('@/assets/icon-art/pharmacy.png'),
  school: require('@/assets/icon-art/school.png'),
  hospital: require('@/assets/icon-art/hospital.png'),
  police: require('@/assets/icon-art/police.png'),
  fire_station: require('@/assets/icon-art/fire_station.png'),
  supermarket: require('@/assets/icon-art/supermarket.png'),
  transit: require('@/assets/icon-art/transit.png'),
  park: require('@/assets/icon-art/park.png'),
  bank: require('@/assets/icon-art/bank.png'),
  restaurant: require('@/assets/icon-art/restaurant.png'),
  spa: require('@/assets/icon-art/spa.png'),
};

export const getIconArt = (id: string): ImageSourcePropType | undefined => ICON_ART[id];

/** Placeholder for home categories that do not have dedicated art yet. */
export const ICON_ART_PLACEHOLDER: ImageSourcePropType = require('@/assets/icon-art/isometric-icon.png');
