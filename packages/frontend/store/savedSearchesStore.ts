import { create } from 'zustand';

/**
 * Arbitrary filter criteria attached to a saved search (price range, property
 * type, amenities, etc.). The shape is determined by the search UI and is
 * persisted/round-tripped verbatim, so it is intentionally a loose record.
 */
export type SavedSearchFilters = Record<string, unknown>;

// Saved Search Interface
export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters?: SavedSearchFilters;
  notifications: boolean;
  /**
   * Mirror of {@link SavedSearch.notifications} kept for downstream components
   * that read the backend's `notificationsEnabled` field name.
   */
  notificationsEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

// Saved Searches State Interface
interface SavedSearchesState {
  // Data
  searches: SavedSearch[];

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  setSearches: (searches: SavedSearch[]) => void;
  addSearch: (search: SavedSearch) => void;
  updateSearch: (id: string, updates: Partial<SavedSearch>) => void;
  removeSearch: (id: string) => void;
  toggleNotifications: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useSavedSearchesStore = create<SavedSearchesState>()((set, get) => ({
  // Initial state
  searches: [],
  isLoading: false,
  error: null,

  // Actions
  setSearches: (searches) => set({ searches }),
  addSearch: (search) =>
    set((state) => ({
      searches: [...state.searches, search],
    })),
  updateSearch: (id, updates) =>
    set((state) => ({
      searches: state.searches.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),
  removeSearch: (id) =>
    set((state) => ({
      searches: state.searches.filter((s) => s.id !== id),
    })),
  toggleNotifications: (id) =>
    set((state) => ({
      searches: state.searches.map((s) =>
        s.id === id ? { ...s, notifications: !s.notifications } : s,
      ),
    })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
}));

// Selector hooks for easier access
export const useSavedSearchesSelectors = () => {
  const searches = useSavedSearchesStore((state) => state.searches);
  const isLoading = useSavedSearchesStore((state) => state.isLoading);
  const error = useSavedSearchesStore((state) => state.error);

  return {
    searches,
    isLoading,
    error,
  };
};
