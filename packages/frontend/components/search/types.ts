/**
 * Shared types for the Airbnb-2026 search experience.
 *
 * These describe the *active search query* (what the user is looking for) in a
 * map-friendly, store-serialisable shape, plus the small value objects the
 * expanding `SearchPanel` and the `SearchResultsView` exchange. They are pure
 * data (no React) so both the Zustand stores and the components can depend on
 * them without a cycle.
 */
import { OfferingType } from '@homiio/shared-types';
import type { PropertyType } from '@homiio/shared-types';

/**
 * A geographic bounding box in the same `{ west, south, east, north }` shape the
 * `Map` component emits via `onRegionChange` and the search hook forwards to the
 * backend as `swLat/swLng/neLat/neLng`.
 */
export interface SearchBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * A resolved "Where" selection: the human label plus its center point and an
 * optional bounding box. Coordinates follow the GeoJSON `[lng, lat]` order used
 * everywhere in this codebase (Map, Address.coordinates).
 */
export interface SearchLocation {
  /** Full human-readable place name (Nominatim `display_name`). */
  label: string;
  /** Short primary label used in the collapsed pill (e.g. "Barcelona"). */
  shortLabel: string;
  /** [longitude, latitude] center of the selection. */
  center: [number, number];
  /** Optional bounding box around the selection (degrees). */
  bounds?: SearchBounds;
}

/**
 * An inclusive date range used by the vacation "Dates" step. Stored as ISO-8601
 * date strings (`YYYY-MM-DD`) so they round-trip through the persisted store and
 * map directly onto the backend `checkIn`/`checkOut` params.
 */
export interface SearchDateRange {
  /** Check-in date, ISO-8601 (`YYYY-MM-DD`). */
  start: string;
  /** Check-out date, ISO-8601 (`YYYY-MM-DD`). */
  end: string;
}

/** Sort options exposed by the results `SortControl`. */
export type SearchSortBy = 'relevance' | 'price' | 'createdAt';
export type SearchSortOrder = 'asc' | 'desc';

/**
 * The full, serialisable active search query. This is the single source of
 * truth the results view reads and the `SearchPanel` writes. Every field is
 * optional except `offering` so an empty (default) query is valid.
 */
export interface SearchQuery {
  /**
   * The offering the user is browsing (`long_term_rent` by default). Selects
   * BOTH the feed filter (`offering=<type>`) and which priced block the price
   * range applies to — long-term → monthly amount, short-term → nightly rate,
   * sale → sale price. The unit is fixed per offering and never reinterpreted.
   */
  offering: OfferingType;
  /** Resolved "Where" selection, if any. */
  location?: SearchLocation;
  /** Selected property types (empty = any). */
  propertyTypes: PropertyType[];
  /**
   * Minimum price, interpreted against the active offering's price field
   * (monthly for long-term, nightly for short-term, sale price for buy).
   */
  priceMin?: number;
  /** Maximum price (same per-offering interpretation as {@link priceMin}). */
  priceMax?: number;
  /** Minimum bedrooms. */
  bedrooms?: number;
  /** Minimum bathrooms. */
  bathrooms?: number;
  /** Amenity slugs the listing must include. */
  amenities: string[];
  /** Short-term-only date range. */
  dates?: SearchDateRange;
  /** Short-term-only guest count. */
  guests?: number;
  /** Sort field. */
  sortBy: SearchSortBy;
  /** Sort direction. */
  sortOrder: SearchSortOrder;
}

/** The ordered steps the panel walks through (Dates only in short-term mode). */
export type SearchStep = 'where' | 'type' | 'dates' | 'price';

/**
 * The single top-level "what am I browsing for" selection the global mode
 * toggle (sidebar + hero) drives. It maps 1:1 onto an {@link OfferingType}: a
 * `BrowseMode` is just the user-facing alias for "which offering am I looking
 * at", and the active mode selects both the feed filter (`offering: <type>`)
 * and the price field (see {@link BROWSE_MODE_OFFERING}).
 *
 *  - `long_term` → {@link OfferingType.LONG_TERM_RENT} (monthly rent)
 *  - `vacation`  → {@link OfferingType.SHORT_TERM_RENT} (per-night rent)
 *  - `buy`       → {@link OfferingType.SALE}
 *  - `exchange`  → {@link OfferingType.EXCHANGE}
 *
 * Pure data (no React) so the search store, the `RentalModeContext`, the
 * sidebar toggle, and the `SearchPanel` can all share one mapping.
 */
export type BrowseMode = 'long_term' | 'vacation' | 'buy' | 'exchange';

/**
 * Canonical 1:1 mapping of every {@link BrowseMode} to its {@link OfferingType}.
 * The ONE source of truth shared by the toggle, the context, the search store,
 * and the panel.
 */
export const BROWSE_MODE_OFFERING: Record<BrowseMode, OfferingType> = {
  long_term: OfferingType.LONG_TERM_RENT,
  vacation: OfferingType.SHORT_TERM_RENT,
  buy: OfferingType.SALE,
  exchange: OfferingType.EXCHANGE,
};

/** Inverse of {@link BROWSE_MODE_OFFERING}: the browse mode for an offering. */
export const OFFERING_BROWSE_MODE: Record<OfferingType, BrowseMode> = {
  [OfferingType.LONG_TERM_RENT]: 'long_term',
  [OfferingType.SHORT_TERM_RENT]: 'vacation',
  [OfferingType.SALE]: 'buy',
  [OfferingType.EXCHANGE]: 'exchange',
};

/**
 * Pick the {@link BrowseMode} implied by an {@link OfferingType}. Used by the
 * `SearchPanel` toggle, whose draft stores the active offering rather than a
 * browse mode.
 */
export function browseModeFromOffering(offering: OfferingType): BrowseMode {
  return OFFERING_BROWSE_MODE[offering];
}
