import type { BrowseMode } from '@/components/search/types';
import type { RentalMode } from '@/context/RentalModeContext';

import type { HomeCategory } from './homeCategoryStore';

export interface HomeCategoryDef {
  id: HomeCategory;
  labelKey: string;
}

const LONG_TERM_CATEGORIES: HomeCategoryDef[] = [
  { id: 'studios', labelKey: 'home.category.studios' },
  { id: 'apartments', labelKey: 'home.category.apartments' },
  { id: 'houses', labelKey: 'home.category.houses' },
  { id: 'rooms', labelKey: 'home.category.rooms' },
  { id: 'coliving', labelKey: 'home.category.coliving' },
  { id: 'luxury', labelKey: 'home.category.luxury' },
  { id: 'new_listings', labelKey: 'home.category.newListings' },
  { id: 'near_you', labelKey: 'home.category.nearYou' },
];

const VACATION_CATEGORIES: HomeCategoryDef[] = [
  { id: 'beachfront', labelKey: 'home.category.beachfront' },
  { id: 'cabins', labelKey: 'home.category.cabins' },
  { id: 'pools', labelKey: 'home.category.pools' },
  { id: 'mountain', labelKey: 'home.category.mountain' },
  { id: 'city_breaks', labelKey: 'home.category.cityBreaks' },
  { id: 'countryside', labelKey: 'home.category.countryside' },
  { id: 'instant_book', labelKey: 'home.category.instantBook' },
  { id: 'pet_friendly', labelKey: 'home.category.petFriendly' },
];

const BUY_CATEGORIES: HomeCategoryDef[] = [
  { id: 'studios', labelKey: 'home.category.studios' },
  { id: 'apartments', labelKey: 'home.category.apartments' },
  { id: 'houses', labelKey: 'home.category.houses' },
  { id: 'luxury', labelKey: 'home.category.luxury' },
  { id: 'new_listings', labelKey: 'home.category.newListings' },
  { id: 'near_you', labelKey: 'home.category.nearYou' },
  { id: 'pet_friendly', labelKey: 'home.category.petFriendly' },
];

const EXCHANGE_CATEGORIES: HomeCategoryDef[] = [
  { id: 'houses', labelKey: 'home.category.houses' },
  { id: 'apartments', labelKey: 'home.category.apartments' },
  { id: 'home_swap', labelKey: 'home.category.homeSwap' },
  { id: 'hosting', labelKey: 'home.category.hosting' },
  { id: 'beachfront', labelKey: 'home.category.beachfront' },
  { id: 'city_breaks', labelKey: 'home.category.cityBreaks' },
  { id: 'countryside', labelKey: 'home.category.countryside' },
  { id: 'pet_friendly', labelKey: 'home.category.petFriendly' },
  { id: 'near_you', labelKey: 'home.category.nearYou' },
];

export function homeCategoriesForMode(
  browseMode: BrowseMode,
  mode: RentalMode,
): readonly HomeCategoryDef[] {
  if (browseMode === 'buy') return BUY_CATEGORIES;
  if (browseMode === 'exchange') return EXCHANGE_CATEGORIES;
  if (mode === 'vacation') return VACATION_CATEGORIES;
  return LONG_TERM_CATEGORIES;
}

/** Ignore a stored category that does not belong to the active browse mode. */
export function resolveHomeCategory(
  category: HomeCategory | null,
  browseMode: BrowseMode,
  mode: RentalMode,
): HomeCategory | null {
  if (!category) return null;
  return homeCategoriesForMode(browseMode, mode).some((item) => item.id === category)
    ? category
    : null;
}
