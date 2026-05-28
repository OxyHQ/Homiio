import { create } from 'zustand';

/**
 * Categories shown in the Airbnb-style icon strip at the top of the home screen.
 *
 * These are NOT the same as `PropertyType` — they are merchandised buckets
 * that map onto property filters. A category like `'co_living'` corresponds
 * to `type=room` + amenity hints, while `'near_you'` is purely a location
 * filter. The mapping lives in `getCategoryFilters()` so that consumers can
 * stay agnostic of how each bucket is computed.
 */
export type HomeCategory =
  // Long-term
  | 'studios'
  | 'apartments'
  | 'houses'
  | 'rooms'
  | 'coliving'
  | 'luxury'
  | 'new_listings'
  | 'near_you'
  // Vacation
  | 'beachfront'
  | 'cabins'
  | 'pools'
  | 'mountain'
  | 'city_breaks'
  | 'countryside'
  | 'instant_book'
  | 'pet_friendly';

interface HomeCategoryState {
  /** Currently selected category, or null for "all". */
  category: HomeCategory | null;
  setCategory: (category: HomeCategory | null) => void;
  clearCategory: () => void;
}

export const useHomeCategoryStore = create<HomeCategoryState>((set) => ({
  category: null,
  setCategory: (category) => set({ category }),
  clearCategory: () => set({ category: null }),
}));
