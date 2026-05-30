import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SearchQuery } from '@/components/search/types';

/** How many recent searches to retain. Older entries are dropped. */
const MAX_RECENT_SEARCHES = 8;

/**
 * A single recent-search entry: a short display label plus the full
 * {@link SearchQuery} needed to re-run it verbatim.
 */
export interface RecentSearch {
  /** Stable id (derived from the label + timestamp). */
  id: string;
  /** Short human label shown in the panel (e.g. "Barcelona · Apartment"). */
  label: string;
  /** Secondary line (e.g. the price/dates summary). */
  sublabel?: string;
  /** The full query to restore when the entry is tapped. */
  query: SearchQuery;
  /** Epoch ms the entry was recorded. */
  savedAt: number;
}

interface RecentSearchesState {
  searches: RecentSearch[];
  /**
   * Record a search. De-dupes by label (case-insensitive) so re-running the
   * same search just bumps it to the top, and clamps to {@link MAX_RECENT_SEARCHES}.
   */
  addSearch: (entry: Omit<RecentSearch, 'id' | 'savedAt'>) => void;
  /** Remove a single entry by id. */
  removeSearch: (id: string) => void;
  /** Clear the entire history. */
  clear: () => void;
}

/**
 * Persisted store of the user's recent searches, surfaced by the `SearchPanel`
 * when it opens with an empty "Where" input. Persisted via AsyncStorage so the
 * history survives reloads, mirroring the app's `uiStore` pattern.
 */
export const useRecentSearchesStore = create<RecentSearchesState>()(
  persist(
    (set) => ({
      searches: [],

      addSearch: (entry) =>
        set((state) => {
          const normalizedLabel = entry.label.trim().toLowerCase();
          if (!normalizedLabel) return state;

          const next: RecentSearch = {
            ...entry,
            id: `${normalizedLabel}-${Date.now()}`,
            savedAt: Date.now(),
          };

          const withoutDuplicate = state.searches.filter(
            (s) => s.label.trim().toLowerCase() !== normalizedLabel,
          );

          return {
            searches: [next, ...withoutDuplicate].slice(0, MAX_RECENT_SEARCHES),
          };
        }),

      removeSearch: (id) =>
        set((state) => ({
          searches: state.searches.filter((s) => s.id !== id),
        })),

      clear: () => set({ searches: [] }),
    }),
    {
      name: '@homiio/recent-searches',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ searches: state.searches }),
    },
  ),
);
