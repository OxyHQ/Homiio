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
import type {
  ExchangeMode,
  LocationSelection,
  PlaceLabel,
  PropertyType,
} from '@homiio/shared-types';

/**
 * The currency a search's `priceMin`/`priceMax` are expressed in.
 *
 * A numeric price filter has no listing to take a currency from, and the backend
 * compares the number against listing amounts WITHOUT converting — so the filter
 * has always had exactly one implicit currency, and it was euros: the price
 * chips are euro bands and `resolvePrimaryOffering` falls back to `EUR` for a
 * block that names none. This constant only makes that assumption say its own
 * name, so the filter labels can be formatted properly instead of being built
 * from a hardcoded `€`. Comparing a filter against listings priced in several
 * currencies is a modelling gap this does not close.
 */
export const SEARCH_PRICE_CURRENCY = 'EUR';

/**
 * The display label for a committed selection, or `null` when the selection
 * has no name of its own.
 *
 * `current_location` is the `null` case and deliberately so: the device's
 * position is not a place and never acquires a name, so the caller supplies a
 * translated "Near you" rather than this module inventing one. Keeping i18n out
 * of here is what lets the same function serve the pill, the results heading
 * and the saved-search default name.
 *
 * `label.split(',')[0]` is what this replaces. That assumed a comma-separated
 * Western ordering and mangled every address format and script that does not
 * use one; `PlaceLabel` arrives already split by whoever knew how.
 */
export function selectionLabel(selection: LocationSelection | null): PlaceLabel | null {
  if (!selection) return null;
  return selection.kind === 'current_location' ? null : selection.label;
}

/**
 * The one-line label shown in the pill, the summary bar and the results
 * heading.
 *
 * Every branch is translated, including the two that have no place name:
 * `current_location` has no label at all (the device's position is not a place)
 * and `map_bounds` carries a GENERATED label whose `primary` is an i18n key
 * rather than a name. That is what keeps a generated label out of everywhere a
 * place label goes — it is not a string anyone would mistake for a city.
 *
 * `primary` only. The administrative parent belongs in the disambiguation list
 * and in a saved search's name (see {@link savedSearchName}), not in a pill
 * that has to fit on a phone.
 */
export function locationDisplayLabel(
  selection: LocationSelection | null,
  t: (key: string) => string,
): string {
  if (!selection) return t('search.summary.anywhere');
  if (selection.kind === 'current_location') return t('search.summary.nearYou');
  const label = selection.label;
  return label.kind === 'generated' ? t(label.primary) : label.primary;
}

/**
 * The default name offered when saving a search, or `null` when the selection
 * has no name to offer.
 *
 * `primary · secondary`, not `primary` alone. `saved_searches` is UNIQUE on
 * `(oxy_user_id, name)` and the default used to be the short label, so a person
 * who saved "Barcelona" in Catalonia and then "Barcelona" in Anzoátegui
 * collided on that key — one silently replacing the other, since the two are
 * indistinguishable by name and distinguishable only by id. Including the
 * administrative parent is what makes the two defaults differ; a collision that
 * still happens is surfaced as a prompt to rename, never as an overwrite.
 *
 * A `map_bounds` selection returns `null` deliberately: its label is
 * `kind: 'generated'`, and a generated label is never a place's name, never
 * re-geocoded and never written where a place label goes.
 */
export function savedSearchName(selection: LocationSelection | null): string | null {
  const label = selectionLabel(selection);
  if (!label || label.kind === 'generated') return null;
  return label.secondary ? `${label.primary} · ${label.secondary}` : label.primary;
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
export type SearchSortBy = 'relevance' | 'price' | 'createdAt' | 'fairness';
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
  /**
   * The committed geographic scope, or `null` for "everywhere".
   *
   * ATOMIC: replaced whole or not at all. There is no API anywhere for mutating
   * one field of it, which is what makes "the old city with the new bounds"
   * unrepresentable rather than merely discouraged — that combination was the
   * single largest source of wrong results, and it was reachable because the
   * store exposed a `setBounds` that merged a box onto whatever place was
   * already there.
   */
  location: LocationSelection | null;
  /**
   * What the user TYPED, and nothing else. `null` when they typed nothing.
   *
   * A different dimension from {@link location}, not a fallback for it. A place
   * label is never copied in here: doing that made a text search and a place
   * search the same request, so "Barcelona" the word was matched against
   * listing content while the Madrid box filtered the rows, and the honest
   * answer to that question is zero — which reads as "this area is empty".
   *
   * Both may be set at once and both are then meant: "loft with a terrace",
   * inside Barcelona.
   */
  queryText: string | null;
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
  /** When true, only listings with `priceEthics.isFairPrice`. */
  fairPrice?: boolean;
  /**
   * Short-term-only: restrict to instant-bookable listings. Carried here (not
   * only in the filters sheet) so a home category like "Instant book" can seed
   * the endless feed through the same query path.
   */
  instantBook?: boolean;
  /** Restrict to pet-friendly listings (home "Pet friendly" category lens). */
  petFriendly?: boolean;
  /**
   * Exchange-only: restrict to a swap/host exchange mode. Only meaningful when
   * `offering` is {@link OfferingType.EXCHANGE}; the backend ignores it otherwise.
   */
  exchangeMode?: ExchangeMode;
}

/**
 * The ordered steps the panel walks through. `dates` and `guests` exist only in
 * short-term (vacation) mode; long-term never mounts them.
 */
export type SearchStep = 'where' | 'type' | 'dates' | 'guests' | 'price';

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
