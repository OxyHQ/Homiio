/**
 * OnTheMarket JSON parsers (pure).
 *
 * Detail pages embed listing JSON in `__NEXT_DATA__.props.initialReduxState.property`.
 * Search pages expose `/details/<id>` links; housing-only filter rejects garages etc.
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
export interface OnTheMarketListingJson {
    sourceId: string;
    url: string;
    kind: 'rent' | 'sale';
    displayAddress?: string;
    addressLocality?: string;
    summary?: string;
    description?: string;
    bedrooms?: number;
    bathrooms?: number;
    propertyType?: string;
    propSubId?: string;
    priceAmount?: number;
    priceCurrency?: string;
    latitude?: number;
    longitude?: number;
    images: string[];
    contact?: NormalizedListingContact;
}
export declare function onthemarketSourceIdFromUrl(url: string): string | undefined;
export declare function onthemarketDetailUrl(sourceId: string): string;
export declare function onthemarketSearchUrl(city: string, page?: number): string;
/** De-duplicated housing detail refs from a search HTML page. */
export declare function parseOnTheMarketSearch(html: string): {
    sourceId: string;
    url: string;
}[];
/** Parse detail `__NEXT_DATA__` redux property JSON. */
export declare function parseOnTheMarketDetail(html: string, url: string): OnTheMarketListingJson;
