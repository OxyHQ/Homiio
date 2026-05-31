/**
 * Shared types for the Airbnb-2026 search experience.
 *
 * These describe the *active search query* (what the user is looking for) in a
 * map-friendly, store-serialisable shape, plus the small value objects the
 * expanding `SearchPanel` and the `SearchResultsView` exchange. They are pure
 * data (no React) so both the Zustand stores and the components can depend on
 * them without a cycle.
 */
import { ListingIntent, RentMode } from '@homiio/shared-types';
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

/**
 * The single top-level "what am I browsing for" selection the global mode
 * toggle (sidebar + hero) drives. It unifies the two axes the app already
 * filters on — the rent experience ({@link RentMode}: long-term | vacation) and
 * the listing {@link ListingIntent} (rent / sale / exchange) — into one typed
 * value, WITHOUT forking the filtering logic: a `BrowseMode` is just a named
 * alias over a `(rentMode, intent)` pair (see {@link BROWSE_MODE_MAP}).
 *
 *  - `long_term` / `vacation` → rent intent left undefined ("any", so legacy
 *    rent-only listings still surface), keeping today's behaviour unchanged.
 *  - `buy`      → `sale` intent.
 *  - `exchange` → `exchange` intent.
 *
 * Pure data (no React) so the search store, the `RentalModeContext`, the
 * sidebar toggle, and the `SearchPanel` can all share one mapping.
 */
export type BrowseMode = 'long_term' | 'vacation' | 'buy' | 'exchange';

/** The two filter axes a {@link BrowseMode} decomposes into. */
export interface BrowseModeAxes {
  /** Rent experience (drives price unit + vacation-only fields). */
  rentMode: RentMode;
  /**
   * Listing intent to scope to. `undefined` for the rent modes so legacy
   * rent-only listings (no stored `intents`) still surface; `sale`/`exchange`
   * for the dedicated buy/exchange browse modes.
   */
  intent: ListingIntent | undefined;
}

/**
 * Canonical decomposition of every {@link BrowseMode} into its
 * `(rentMode, intent)` axes. The ONE source of truth shared by the toggle, the
 * context, the search store, and the panel.
 */
export const BROWSE_MODE_MAP: Record<BrowseMode, BrowseModeAxes> = {
  long_term: { rentMode: RentMode.LONG_TERM, intent: undefined },
  vacation: { rentMode: RentMode.VACATION, intent: undefined },
  buy: { rentMode: RentMode.LONG_TERM, intent: ListingIntent.SALE },
  exchange: { rentMode: RentMode.LONG_TERM, intent: ListingIntent.EXCHANGE },
};

/**
 * Invert {@link BROWSE_MODE_MAP}: pick the {@link BrowseMode} implied by a
 * `(rentMode, intent)` pair. Intent wins when set (`sale` ⇒ buy, `exchange` ⇒
 * exchange); otherwise the rent experience selects long-term vs vacation. Used
 * by the `SearchPanel` toggle, whose draft stores the two axes rather than a
 * browse mode.
 */
export function browseModeFromAxes(
  rentMode: RentMode,
  intent: ListingIntent | undefined,
): BrowseMode {
  if (intent === ListingIntent.SALE) return 'buy';
  if (intent === ListingIntent.EXCHANGE) return 'exchange';
  return rentMode === RentMode.VACATION ? 'vacation' : 'long_term';
}
