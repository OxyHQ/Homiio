import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { locationKey } from '@homiio/shared-types';
import type { SearchQuery } from '@/components/search/types';

/** How many recent searches to retain. Older entries are dropped. */
const MAX_RECENT_SEARCHES = 8;

/**
 * The persist key, bumped from `@homiio/recent-searches`.
 *
 * A bump rather than a migration, deliberately. Recent searches are a
 * device-local convenience with no authority over anything, so the cheapest
 * correct answer is to let the old entries expire — and it is also the only one
 * that reliably drops the EXACT COORDINATES the old shape had been writing to
 * disk. A migration would have to decide what to do with a stored `center` it
 * cannot re-identify, and the honest answer to that is "discard it", which is
 * what this does in one line.
 */
const PERSIST_KEY = '@homiio/recent-searches-v2';

/**
 * A single recent-search entry.
 *
 * ## What it no longer holds
 *
 * It used to persist the whole `SearchQuery`, which meant a full-precision
 * `center` — including a device fix — written to AsyncStorage and kept there
 * indefinitely. ADR 0002 §8.2 forbids an exact coordinate reaching a persisted
 * client store, and the fix is structural rather than a sweep: what is stored
 * is the {@link locationKey}, which has no coordinate branch for
 * `current_location` and grids a bounding box to 3 dp.
 *
 * Re-running an entry therefore RESOLVES its key rather than replaying a cached
 * position, which is also the behaviour a person expects — "near me" means near
 * where they are now, not near where they were last week.
 */
export interface RecentSearch {
  /** Stable id, derived from the location key + timestamp. */
  id: string;
  /** Short display label shown in the panel (e.g. "Barcelona"). */
  label: string;
  /** Secondary line (e.g. the price/dates summary). */
  sublabel?: string;
  /**
   * The location's stable identity — an id, or a gridded box, or `here:<r>`.
   * Never a coordinate. `'none'` for a text-only search.
   */
  locationKey: string;
  /** The non-geographic half of the query, replayed verbatim. */
  filters: Omit<SearchQuery, 'location'>;
  /** Epoch ms the entry was recorded. */
  savedAt: number;
}

interface RecentSearchesState {
  searches: RecentSearch[];
  /**
   * Record a search.
   *
   * De-dupes by {@link RecentSearch.locationKey}, NOT by label. Two different
   * cities called Barcelona have the same label and different ids, so a label
   * comparison collapsed them into one entry — the second silently overwriting
   * the first, and the user's history then offering to reopen a city they never
   * searched.
   */
  addSearch: (query: SearchQuery, display: { label: string; sublabel?: string }) => void;
  /** Remove a single entry by id. */
  removeSearch: (id: string) => void;
  /** Clear the entire history. */
  clear: () => void;
}

/**
 * Persisted store of the user's recent searches, surfaced by the `SearchPanel`
 * when it opens with an empty "Where" input.
 */
export const useRecentSearchesStore = create<RecentSearchesState>()(
  persist(
    (set) => ({
      searches: [],

      addSearch: (query, display) =>
        set((state) => {
          const label = display.label.trim();
          if (!label) return state;

          const key = locationKey(query.location);
          const { location: _location, ...filters } = query;

          const next: RecentSearch = {
            id: `${key}-${Date.now()}`,
            label,
            sublabel: display.sublabel,
            locationKey: key,
            filters,
            savedAt: Date.now(),
          };

          const withoutDuplicate = state.searches.filter((s) => s.locationKey !== key);

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
      name: PERSIST_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ searches: state.searches }),
    },
  ),
);
