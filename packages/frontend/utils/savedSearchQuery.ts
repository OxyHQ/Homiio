/**
 * A saved search, read back as the search it describes.
 *
 * The Saved screen draws every saved search as a Bloom `SavedSearchCard` whose
 * press RE-RUNS it. That needs the same three answers `/explore` needs when a
 * saved search is applied over the event bus: which query it is, whether it can
 * run at all, and how to say what it looks for.
 *
 * ## A saved search that cannot say WHERE never runs (ADR 0002)
 *
 * {@link savedSearchTarget} has three outcomes and only one of them navigates:
 *
 * - `href` — a resolved location the URL grammar can carry. The link is built
 *   by `exploreHref`, the one writer of a search URL, so a saved search reopens
 *   exactly the way a shared link does.
 * - `needs_place` — a LEGACY row: it predates the location column and holds
 *   only a place LABEL in `query`. Running it would be a global feed under a
 *   city's name, and re-geocoding the label is the homonym bug; the person who
 *   saved it is asked to choose the place again instead.
 * - `unshareable` — a location the grammar cannot express (a drawn polygon).
 *   Navigating without it would reopen as a global search, so nothing opens.
 */
import type { TFunction } from 'i18next';

import { OfferingType, type PropertyType } from '@homiio/shared-types';

import { locationDisplayLabel, type SearchQuery } from '@/components/search/types';
import {
  datesLabel,
  guestsLabel,
  priceLabel,
  typeLabel,
} from '@/components/search/searchLabels';
import { DEFAULT_SEARCH_QUERY } from '@/store/searchQueryStore';
import type { SavedSearch } from '@/store/savedSearchesStore';
import { exploreHref } from '@/utils/searchUrl';

const OFFERINGS = Object.values(OfferingType) as string[];

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * The query a saved search's stored filters describe, WITHOUT its location.
 *
 * Mirrors the reader `/explore` applies to a saved-search event, including the
 * older field spellings (`type`, `minPrice`, `checkIn`) rows were written with.
 */
export function savedSearchFiltersToQuery(search: Pick<SavedSearch, 'filters' | 'query'>): SearchQuery {
  const filters = search.filters ?? {};

  const offeringRaw = readString(filters.offering);
  const offering =
    offeringRaw !== undefined && OFFERINGS.includes(offeringRaw)
      ? (offeringRaw as OfferingType)
      : OfferingType.LONG_TERM_RENT;

  const propertyTypesRaw = filters.propertyTypes ?? filters.type;
  const propertyTypes = Array.isArray(propertyTypesRaw)
    ? propertyTypesRaw.filter((value): value is PropertyType => typeof value === 'string')
    : [];

  const dates = filters.dates;
  const dateRange =
    dates && typeof dates === 'object'
      ? (dates as { start?: unknown; end?: unknown })
      : { start: filters.checkIn, end: filters.checkOut };

  return {
    ...DEFAULT_SEARCH_QUERY,
    offering,
    propertyTypes,
    priceMin: readNumber(filters.priceMin) ?? readNumber(filters.minPrice),
    priceMax: readNumber(filters.priceMax) ?? readNumber(filters.maxPrice),
    bedrooms: readNumber(filters.bedrooms),
    bathrooms: readNumber(filters.bathrooms),
    amenities: Array.isArray(filters.amenities)
      ? filters.amenities.filter((amenity): amenity is string => typeof amenity === 'string')
      : [],
    guests: readNumber(filters.guests),
    dates:
      offering === OfferingType.SHORT_TERM_RENT &&
      typeof dateRange.start === 'string' &&
      typeof dateRange.end === 'string'
        ? { start: dateRange.start, end: dateRange.end }
        : undefined,
    queryText: readString(search.query) ?? null,
  };
}

export type SavedSearchTarget =
  | { readonly kind: 'href'; readonly href: string }
  | { readonly kind: 'needs_place' }
  | { readonly kind: 'unshareable' };

/** Where pressing a saved search goes — or why it goes nowhere. */
export function savedSearchTarget(search: SavedSearch): SavedSearchTarget {
  if (search.locationStatus !== 'resolved' || !search.location) return { kind: 'needs_place' };
  const href = exploreHref({ ...savedSearchFiltersToQuery(search), location: search.location });
  return href ? { kind: 'href', href } : { kind: 'unshareable' };
}

/** i18n key of each offering's short label, as the browse-mode switch names it. */
export const OFFERING_LABEL_KEYS: Record<OfferingType, string> = {
  [OfferingType.LONG_TERM_RENT]: 'search.mode.longTerm',
  [OfferingType.SHORT_TERM_RENT]: 'search.mode.vacation',
  [OfferingType.SALE]: 'search.mode.buy',
  [OfferingType.EXCHANGE]: 'search.mode.exchange',
};

/**
 * What the saved search looks for, as short chips: the place first (always
 * stated, ADR 0002), then the mode, then only the dimensions it narrows by.
 *
 * A legacy row's place is its stored LABEL — shown as saved, not re-resolved.
 */
export function savedSearchCriteria(search: SavedSearch, t: TFunction, locale: string): string[] {
  const query = savedSearchFiltersToQuery(search);
  const place =
    search.location
      ? locationDisplayLabel(search.location, t)
      : search.query.trim() || t('search.summary.anywhere');

  const chips = [place, t(OFFERING_LABEL_KEYS[query.offering])];
  const price = priceLabel(query, t, locale);
  if (price) chips.push(price);
  const types = typeLabel(query, t);
  if (types) chips.push(types);
  if (query.bedrooms) chips.push(t('listing.card.beds', { count: query.bedrooms }));
  if (query.bathrooms) chips.push(t('listing.card.baths', { count: query.bathrooms }));
  const dates = datesLabel(query, locale);
  if (dates) chips.push(dates);
  const guests = guestsLabel(query, t);
  if (guests) chips.push(guests);
  // Free text only when it is NOT the legacy place label already shown first.
  if (search.location && query.queryText) chips.push(`“${query.queryText}”`);
  return chips;
}
