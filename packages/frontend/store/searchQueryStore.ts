import { create } from 'zustand';
import {
  OfferingType,
  PropertyType,
  type GeoBounds,
  type LocationSelection,
} from '@homiio/shared-types';
import type {
  SearchDateRange,
  SearchQuery,
  SearchSortBy,
  SearchSortOrder,
} from '@/components/search/types';

/**
 * Active-search store.
 *
 * Holds the single, in-flight {@link SearchQuery} the expanding `SearchPanel`
 * writes and the `SearchResultsView` reads. Intentionally NOT persisted — it is
 * "what the user is looking at right now". The persisted history lives in
 * `recentSearchesStore`, and the authoritative copy of a committed query lives
 * in the URL (`utils/searchUrl.ts`), which this store is a cache of.
 *
 * ## The geographic dimension is atomic, and that is the point of this file
 *
 * There is no `setBounds`, and its absence is load-bearing rather than an
 * oversight. It used to merge a new box onto whatever location was already
 * committed:
 *
 * ```ts
 * setBounds: (bounds) => ({ query: { ...query, location: { ...location, bounds } } })
 * ```
 *
 * — so panning from Barcelona to Madrid and pressing "Search this area" left a
 * selection reading "Barcelona, centred on Barcelona, bounded by Madrid". Every
 * layer downstream then did something defensible with it and the result was
 * wrong: the label went out as free text, the box went out as the filter, and
 * the honest answer to "Barcelona-matching listings inside Madrid" is zero,
 * which the UI rendered as "this area is empty".
 *
 * {@link SearchQueryState.commitLocation} replaces the selection WHOLE. A
 * partial geographic update is not discouraged here, it is unspeakable: no
 * action accepts less than a complete {@link LocationSelection}.
 *
 * ## A pending viewport is not a query
 *
 * Panning the map writes {@link SearchQueryState.pendingViewport} and nothing
 * else. It changes no results, no request and no URL until the user presses
 * "Search this area", at which point it becomes a `map_bounds` selection and is
 * cleared. It also clears the moment the selection changes by any other route,
 * so a box the user has visibly navigated away from can never be committed.
 */
export const DEFAULT_SEARCH_QUERY: SearchQuery = {
  offering: OfferingType.LONG_TERM_RENT,
  location: null,
  queryText: null,
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
  fairPrice: undefined,
};

/**
 * The generated label a confirmed map viewport carries.
 *
 * `kind: 'generated'` is what stops it being treated as a place: a generated
 * label is never sent as free text, never re-geocoded, and never used as a
 * saved search's name. The visible string is translated at the render site —
 * a store is the wrong place to hold a user-facing sentence, and this value
 * has to survive a language change without being re-committed.
 */
export const MAP_AREA_LABEL = { primary: 'search.summary.mapArea', kind: 'generated' } as const;

/** Build the `map_bounds` selection for a confirmed viewport. */
export function mapBoundsSelection(bounds: GeoBounds): LocationSelection {
  return {
    kind: 'map_bounds',
    bounds,
    center: {
      longitude: (bounds.west + bounds.east) / 2,
      latitude: (bounds.south + bounds.north) / 2,
    },
    label: MAP_AREA_LABEL,
    precision: 'area',
  };
}

/**
 * The filter dimensions the panel may patch.
 *
 * `location` and `queryText` are deliberately EXCLUDED. They are committed
 * through their own actions so that no caller can reach them via a shallow
 * merge — a `patchQuery({ location: … })` is exactly the shape that lets half
 * a location survive, and a type that permits it is a type that will see it.
 */
export type SearchFilterPatch = Partial<
  Omit<SearchQuery, 'location' | 'queryText' | 'offering'>
>;

interface SearchQueryState {
  /** The current active query. */
  query: SearchQuery;
  /**
   * A finalised map viewport the user has not confirmed. NOT part of the query
   * and never sent anywhere.
   */
  pendingViewport: GeoBounds | null;

  /** Replace the entire query (applying a saved or recent search, or a URL). */
  replaceSearch: (query: SearchQuery) => void;
  /** Patch the non-geographic filters. Cannot reach `location` or `queryText`. */
  patchFilters: (patch: SearchFilterPatch) => void;

  /**
   * Commit a geographic scope, replacing any previous one WHOLE.
   *
   * Everything about the previous selection goes: its id, label, centre,
   * bounds, provider and country. `queryText` is untouched, because it is a
   * different dimension and the user did not retract it.
   */
  commitLocation: (selection: LocationSelection) => void;
  /** Drop the geographic scope entirely ("everywhere"). */
  clearLocation: () => void;
  /** Set the free-text dimension. Never derived from a place label. */
  setQueryText: (text: string | null) => void;

  /** Record a finalised map viewport. Changes no results until confirmed. */
  setPendingViewport: (bounds: GeoBounds | null) => void;
  /** Promote the pending viewport to the committed selection. */
  commitPendingViewport: () => void;

  /**
   * Switch the active offering. Preserves `location` and `queryText` — someone
   * looking at Barcelona who switches to vacation still means Barcelona — and
   * clears only the dimensions whose meaning is offering-specific.
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

  /** Reset to {@link DEFAULT_SEARCH_QUERY}, preserving the current offering. */
  reset: () => void;
}

export const useSearchQueryStore = create<SearchQueryState>()((set) => ({
  query: DEFAULT_SEARCH_QUERY,
  pendingViewport: null,

  // Replacing the query wholesale discards any pending viewport: it was a box
  // over the PREVIOUS query's map and means nothing against this one.
  replaceSearch: (query) => set({ query, pendingViewport: null }),

  patchFilters: (patch) => set((state) => ({ query: { ...state.query, ...patch } })),

  commitLocation: (selection) =>
    set((state) => ({
      query: { ...state.query, location: selection },
      pendingViewport: null,
    })),

  clearLocation: () =>
    set((state) => ({
      query: { ...state.query, location: null },
      pendingViewport: null,
    })),

  setQueryText: (text) =>
    set((state) => ({
      // Empty and whitespace-only text is absence, not a query for nothing.
      query: { ...state.query, queryText: text && text.trim() ? text : null },
    })),

  setPendingViewport: (bounds) => set({ pendingViewport: bounds }),

  commitPendingViewport: () =>
    set((state) => {
      const bounds = state.pendingViewport;
      if (!bounds) return state;
      return {
        query: { ...state.query, location: mapBoundsSelection(bounds) },
        pendingViewport: null,
      };
    }),

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

  reset: () =>
    set((state) => ({
      query: { ...DEFAULT_SEARCH_QUERY, offering: state.query.offering },
      pendingViewport: null,
    })),
}));
