import { create } from 'zustand';
import { OfferingType, PropertyType } from '@homiio/shared-types';
import type {
  SearchBounds,
  SearchDateRange,
  SearchLocation,
  SearchQuery,
  SearchSortBy,
  SearchSortOrder,
} from '@/components/search/types';

/**
 * Active-search store.
 *
 * Holds the single, in-flight {@link SearchQuery} the expanding `SearchPanel`
 * writes and the `SearchResultsView` reads. This is intentionally transient
 * (NOT persisted) — it represents "what the user is looking at right now". The
 * persisted history lives in `recentSearchesStore`.
 *
 * The store is the contract between the (separate) hero/results routes and the
 * search components, so the integration step can `setQuery(...)` from the hero
 * and the results screen reads `useSearchQueryStore((s) => s.query)`.
 */
export const DEFAULT_SEARCH_QUERY: SearchQuery = {
  offering: OfferingType.LONG_TERM_RENT,
  location: undefined,
  propertyTypes: [],
  priceMin: undefined,
  priceMax: undefined,
  bedrooms: undefined,
  bathrooms: undefined,
  amenities: [],
  dates: undefined,
  guests: undefined,
  sortBy: 'relevance',
  sortOrder: 'desc',
};

interface SearchQueryState {
  /** The current active query. */
  query: SearchQuery;

  /** Replace the entire query (used when applying a saved/recent search). */
  setQuery: (query: SearchQuery) => void;
  /** Shallow-merge a partial patch into the query. */
  patchQuery: (patch: Partial<SearchQuery>) => void;

  /** Set/clear the resolved "Where" location. */
  setLocation: (location: SearchLocation | undefined) => void;
  /**
   * Switch the active offering (long-term / short-term / sale / exchange).
   * Clears the short-term-only fields (dates/guests) when leaving short-term,
   * and clears the price range since it is denominated per-offering.
   */
  setOffering: (offering: OfferingType) => void;
  /** Toggle a property type in/out of the selection. */
  togglePropertyType: (type: PropertyType) => void;
  /** Set the inclusive price range (either bound may be undefined to clear). */
  setPriceRange: (min: number | undefined, max: number | undefined) => void;
  /** Set the date range (or clear it). */
  setDates: (dates: SearchDateRange | undefined) => void;
  /** Set the guest count. */
  setGuests: (guests: number | undefined) => void;
  /** Update the sort field + direction together. */
  setSort: (sortBy: SearchSortBy, sortOrder: SearchSortOrder) => void;
  /** Replace just the bounding box on the active location (map "search this area"). */
  setBounds: (bounds: SearchBounds) => void;

  /** Reset to {@link DEFAULT_SEARCH_QUERY}, preserving the current offering. */
  reset: () => void;
}

export const useSearchQueryStore = create<SearchQueryState>()((set) => ({
  query: DEFAULT_SEARCH_QUERY,

  setQuery: (query) => set({ query }),

  patchQuery: (patch) => set((state) => ({ query: { ...state.query, ...patch } })),

  setLocation: (location) =>
    set((state) => ({ query: { ...state.query, location } })),

  setOffering: (offering) =>
    set((state) => ({
      query: {
        ...state.query,
        offering,
        // The price range is per-offering (monthly vs nightly vs sale), so a
        // range carried over from another offering would be nonsensical.
        priceMin: undefined,
        priceMax: undefined,
        // Short-term-only fields are meaningless for the other offerings.
        ...(offering === OfferingType.SHORT_TERM_RENT
          ? {}
          : { dates: undefined, guests: undefined }),
      },
    })),

  togglePropertyType: (type) =>
    set((state) => {
      const current = state.query.propertyTypes;
      const next = current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type];
      return { query: { ...state.query, propertyTypes: next } };
    }),

  setPriceRange: (min, max) =>
    set((state) => ({
      query: { ...state.query, priceMin: min, priceMax: max },
    })),

  setDates: (dates) => set((state) => ({ query: { ...state.query, dates } })),

  setGuests: (guests) => set((state) => ({ query: { ...state.query, guests } })),

  setSort: (sortBy, sortOrder) =>
    set((state) => ({ query: { ...state.query, sortBy, sortOrder } })),

  setBounds: (bounds) =>
    set((state) => {
      const location = state.query.location;
      if (!location) return state;
      return {
        query: { ...state.query, location: { ...location, bounds } },
      };
    }),

  reset: () =>
    set((state) => ({
      query: { ...DEFAULT_SEARCH_QUERY, offering: state.query.offering },
    })),
}));
