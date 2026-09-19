/**
 * The words the search surfaces show for a query, in one place.
 *
 * The wide `StaySearchBar`, the narrow `StaySearchCompact` trigger, the step
 * cards of the mobile sheet and the recent-search label all describe the SAME
 * query, so they read these rather than each formatting its own — a pill that
 * says "Any price" while the sheet says "€0–€5,000" is two surfaces disagreeing
 * about one search.
 *
 * Pure: `t` and `locale` come in, strings go out. No React.
 */
import type { TFunction } from 'i18next';

import {
  OfferingType,
  PropertyType,
  formatDate,
  formatDateRange,
  formatMoney,
  formatMoneyRange,
} from '@homiio/shared-types';

import { SEARCH_PRICE_CURRENCY, type SearchQuery } from './types';

/** i18n key for a single property type label. */
export const PROPERTY_TYPE_LABEL_KEYS: Record<PropertyType, string> = {
  [PropertyType.APARTMENT]: 'properties.titles.types.apartment',
  [PropertyType.HOUSE]: 'properties.titles.types.house',
  [PropertyType.ROOM]: 'properties.titles.types.room',
  [PropertyType.STUDIO]: 'properties.titles.types.studio',
  [PropertyType.COUCHSURFING]: 'search.propertyType.couchsurfing',
  [PropertyType.ROOMMATES]: 'search.propertyType.roommates',
  [PropertyType.COLIVING]: 'search.propertyType.coliving',
  [PropertyType.HOSTEL]: 'search.propertyType.hostel',
  [PropertyType.GUESTHOUSE]: 'search.propertyType.guesthouse',
  [PropertyType.CAMPSITE]: 'search.propertyType.campsite',
  [PropertyType.BOAT]: 'search.propertyType.boat',
  [PropertyType.TREEHOUSE]: 'search.propertyType.treehouse',
  [PropertyType.YURT]: 'search.propertyType.yurt',
  [PropertyType.OTHER]: 'search.propertyType.other',
};

const money = (amount: number, locale: string, currency: string): string =>
  formatMoney(amount, currency, locale, { maximumFractionDigits: 0 });

/** Whether the query carries a price bound. */
export function hasPrice(query: SearchQuery): boolean {
  return query.priceMin !== undefined || query.priceMax !== undefined;
}

/**
 * The price range: an explicit min–max, a one-sided bound, or `null` when there
 * is none (the caller picks its own placeholder).
 *
 * The bounds go through the shared formatter rather than being pasted after a
 * `€`, so a Spanish reader gets `1.200 €`.
 *
 * The currency is the QUERY's, because that is the one the filter is applied in
 * — a chip reading `1.200 €` over a search filtering złoty would be a label
 * describing a different search from the one that ran. It falls back to
 * {@link SEARCH_PRICE_CURRENCY} only where the query carries none, which means
 * no scope has answered yet; the chip is then formatted in the app's default
 * and the results screen states the real one once it arrives.
 */
export function priceLabel(query: SearchQuery, t: TFunction, locale: string): string | null {
  const currency = query.priceCurrency ?? SEARCH_PRICE_CURRENCY;
  if (query.priceMin !== undefined && query.priceMax !== undefined) {
    return formatMoneyRange(query.priceMin, query.priceMax, currency, locale, {
      maximumFractionDigits: 0,
    });
  }
  if (query.priceMax !== undefined) {
    return t('format.range.upTo', { value: money(query.priceMax, locale, currency) });
  }
  if (query.priceMin !== undefined) {
    return t('format.range.from', { value: money(query.priceMin, locale, currency) });
  }
  return null;
}

/** The chosen property type(s), or `null` for any. */
export function typeLabel(query: SearchQuery, t: TFunction): string | null {
  if (query.propertyTypes.length === 0) return null;
  if (query.propertyTypes.length === 1) return t(PROPERTY_TYPE_LABEL_KEYS[query.propertyTypes[0]]);
  return t('search.summary.typeCount', { count: query.propertyTypes.length });
}

/**
 * The stay's dates, or `null`.
 *
 * `SearchDateRange` holds CIVIL dates (`YYYY-MM-DD`). They are rendered
 * zone-independently on purpose (the `UTC` argument is inert for a civil date;
 * see `formatDate`), so a check-in never slides to the day before for a reader
 * west of Greenwich.
 */
export function datesLabel(query: SearchQuery, locale: string): string | null {
  if (!query.dates?.start) return null;
  return query.dates.end
    ? formatDateRange(query.dates.start, query.dates.end, locale, 'UTC')
    : formatDate(query.dates.start, locale, 'UTC');
}

/** The guest count (and the pets flag it carries), or `null`. */
export function guestsLabel(query: SearchQuery, t: TFunction): string | null {
  const parts: string[] = [];
  if (query.guests && query.guests > 0) parts.push(t('search.summary.guestCount', { count: query.guests }));
  if (query.petFriendly) parts.push(t('home.category.petFriendly'));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Whether the query is a short-term stay, the only offering with dates and guests. */
export function isStayQuery(query: SearchQuery): boolean {
  return query.offering === OfferingType.SHORT_TERM_RENT;
}

/**
 * The secondary line under the place: dates and guests for a stay, price and
 * type for everything else. Each half falls back to its own placeholder, so the
 * line always says what the search is NOT narrowed by as well.
 */
export function summaryLine(query: SearchQuery, t: TFunction, locale: string): string {
  if (isStayQuery(query)) {
    return [
      datesLabel(query, locale) ?? t('search.summary.anyWeek'),
      guestsLabel(query, t) ?? t('search.summary.addGuests'),
    ].join(' · ');
  }
  return [
    priceLabel(query, t, locale) ?? t('search.summary.anyPrice'),
    typeLabel(query, t) ?? t('search.summary.anyType'),
  ].join(' · ');
}
