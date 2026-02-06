import { create } from 'zustand';

/**
 * @deprecated This monolithic store is deprecated. Use domain-specific stores instead:
 * - usePropertyStore (store/propertyStore.ts)
 * - useProfileStore (store/profileStore.ts)
 * - useSavedPropertiesStore (store/savedPropertiesStore.ts)
 * - useRecentlyViewedStore (store/recentlyViewedStore.ts)
 * - useTrustScoreStore (store/trustScoreStore.ts)
 * - useCurrencyStore (store/currencyStore.ts)
 * - useRoommateStore (store/roommateStore.ts)
 *
 * This file is kept for backwards compatibility but will be removed in a future release.
 */
interface StoreState {
  trends: any;
  analytics: any;
  properties: any;
  rooms: any;
  recentlyViewed: any;
  trustScore: any;
  savedProperties: any;
  savedSearches: any;
  searchStatistics: any;
  propertyList: any;
  location: any;
  neighborhood: any;
  currency: any;
  createPropertyForm: any;
  roommate: any;
  setTrends: (trends: any) => void;
  setAnalytics: (analytics: any) => void;
  setProperties: (properties: any) => void;
  setRooms: (rooms: any) => void;
  setRecentlyViewed: (recentlyViewed: any) => void;
  setTrustScore: (trustScore: any) => void;
  setSavedProperties: (savedProperties: any) => void;
  setSavedSearches: (savedSearches: any) => void;
  setSearchStatistics: (searchStatistics: any) => void;
  setPropertyList: (propertyList: any) => void;
  setLocation: (location: any) => void;
  setNeighborhood: (neighborhood: any) => void;
  setCurrency: (currency: any) => void;
  setCreatePropertyForm: (createPropertyForm: any) => void;
  setRoommate: (roommate: any) => void;
}

/** @deprecated Use domain-specific stores instead */
export const useStore = create<StoreState>((set) => ({
  trends: null,
  analytics: null,
  properties: null,
  rooms: null,
  recentlyViewed: null,
  trustScore: null,
  savedProperties: null,
  savedSearches: null,
  searchStatistics: null,
  propertyList: null,
  location: null,
  neighborhood: null,
  currency: null,
  createPropertyForm: null,
  roommate: null,
  setTrends: (trends) => set({ trends }),
  setAnalytics: (analytics) => set({ analytics }),
  setProperties: (properties) => set({ properties }),
  setRooms: (rooms) => set({ rooms }),
  setRecentlyViewed: (recentlyViewed) => set({ recentlyViewed }),
  setTrustScore: (trustScore) => set({ trustScore }),
  setSavedProperties: (savedProperties) => set({ savedProperties }),
  setSavedSearches: (savedSearches) => set({ savedSearches }),
  setSearchStatistics: (searchStatistics) => set({ searchStatistics }),
  setPropertyList: (propertyList) => set({ propertyList }),
  setLocation: (location) => set({ location }),
  setNeighborhood: (neighborhood) => set({ neighborhood }),
  setCurrency: (currency) => set({ currency }),
  setCreatePropertyForm: (createPropertyForm) => set({ createPropertyForm }),
  setRoommate: (roommate) => set({ roommate }),
}));
