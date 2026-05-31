/**
 * Shared types for the Airbnb-2026 search experience.
 *
 * These describe the *active search query* (what the user is looking for) in a
 * map-friendly, store-serialisable shape, plus the small value objects the
 * expanding `SearchPanel` and the `SearchResultsView` exchange. They are pure
 * data (no React) so both the Zustand stores and the components can depend on
 * them without a cycle.
 */
import type { ListingIntent, PropertyType, RentMode } from '@homiio/shared-types';

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
 * optional except `rentMode` so an empty (default) query is valid.
 */
export interface SearchQuery {
  /** Long-term (default) vs vacation experience. */
  rentMode: RentMode;
  /** Resolved "Where" selection, if any. */
  location?: SearchLocation;
  /**
   * Listing type to scope to (rent / sale / exchange). Undefined = any
   * (default). When `sale`, the price range below is interpreted as the SALE
   * price range by the search hook (the backend ignores rent price for sale).
   */
  intent?: ListingIntent;
  /** Selected property types (empty = any). */
  propertyTypes: PropertyType[];
  /** Minimum price (per-month long-term, per-night vacation). */
  priceMin?: number;
  /** Maximum price. */
  priceMax?: number;
  /** Minimum bedrooms. */
  bedrooms?: number;
  /** Minimum bathrooms. */
  bathrooms?: number;
  /** Amenity slugs the listing must include. */
  amenities: string[];
  /** Vacation-only date range. */
  dates?: SearchDateRange;
  /** Vacation-only guest count. */
  guests?: number;
  /** Sort field. */
  sortBy: SearchSortBy;
  /** Sort direction. */
  sortOrder: SearchSortOrder;
}

/** The ordered steps the panel walks through (Dates only in vacation mode). */
export type SearchStep = 'where' | 'type' | 'dates' | 'price';
