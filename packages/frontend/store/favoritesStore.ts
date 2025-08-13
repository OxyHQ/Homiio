import { create } from 'zustand';

// Types
export type FavoriteType = 'property' | 'room' | 'roommate';

export interface Favorite {
  id: string;
  type: FavoriteType;
  data: any;
  addedAt: string;
}

// Favorites State Interface
interface FavoritesState {
  // Data
  favorites: Favorite[];

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  addFavorite: (id: string, type: FavoriteType, data: any) => void;
  removeFavorite: (id: string) => void;
  clearFavorites: () => void;
  getFavoritesByType: (type: FavoriteType) => any[];
  isFavorite: (id: string) => boolean;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  // Initial state
  favorites: [],
  isLoading: false,
  error: null,

  // Actions
  addFavorite: (id, type, data) =>
    set((state) => {
      if (!id) {
        console.warn('favoritesStore: Cannot add favorite - missing ID');
        return state;
      }

      const existingIndex = state.favorites.findIndex((fav) => fav.id === id);
      if (existingIndex >= 0) {
        return state; // Already exists
      }

      return {
        favorites: [{ id, type, data, addedAt: new Date().toISOString() }, ...state.favorites],
      };
    }),

  removeFavorite: (id) =>
    set((state) => {
      if (!id) {
        console.warn('favoritesStore: Cannot remove favorite - missing ID');
        return state;
      }

      return {
        favorites: state.favorites.filter((fav) => fav.id !== id),
      };
    }),

  clearFavorites: () => set({ favorites: [] }),

  getFavoritesByType: (type) => {
    const state = get();
    return state.favorites.filter((fav) => fav.type === type).map((fav) => fav.data);
  },

  isFavorite: (id) => {
    if (!id) return false;
    const state = get();
    return state.favorites.some((fav) => fav.id === id);
  },

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),
}));

// Selector hooks for easier access
export const useFavoritesSelectors = () => {
  const favorites = useFavoritesStore((state) => state.favorites);
  const isLoading = useFavoritesStore((state) => state.isLoading);
  const error = useFavoritesStore((state) => state.error);
  const getFavoritesByType = useFavoritesStore((state) => state.getFavoritesByType);
  const isFavorite = useFavoritesStore((state) => state.isFavorite);

  return {
    favorites,
    isLoading,
    error,
    getFavoritesByType,
    isFavorite,
  };
};
