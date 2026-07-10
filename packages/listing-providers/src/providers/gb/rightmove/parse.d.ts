/**
 * Rightmove JSON parsers (pure).
 *
 * Discover prefers typeahead JSON + search-page `__NEXT_DATA__` properties
 * array. Detail prefers `window.__PAGE_MODEL` (compressed JSON graph) which
 * carries address, price, images, and contactInfo — not DOM scraping.
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
/** Flatten Rightmove's compressed `__PAGE_MODEL` integer-pointer graph. */
export declare function resolvePageModelGraph(data: unknown[]): Record<string, unknown> | undefined;
export interface RightmoveListingJson {
    sourceId: string;
    url: string;
    kind: 'rent' | 'sale';
    displayAddress?: string;
    summary?: string;
    description?: string;
    bedrooms?: number;
    bathrooms?: number;
    propertySubType?: string;
    priceAmount?: number;
    priceCurrency?: string;
    priceFrequency?: string;
    countryCode?: string;
    outcode?: string;
    incode?: string;
    latitude?: number;
    longitude?: number;
    images: string[];
    contact?: NormalizedListingContact;
}
export declare function rightmoveSourceIdFromUrl(url: string): string | undefined;
export declare function rightmoveDetailUrl(sourceId: string): string;
/** Parse typeahead JSON into the first REGION^id locationIdentifier. */
export declare function parseRightmoveTypeahead(body: string): string | undefined;
/** Extract listing refs (+ optional card JSON) from search `__NEXT_DATA__`. */
export declare function parseRightmoveSearchJson(html: string): {
    sourceId: string;
    url: string;
    kind: 'rent' | 'sale';
    card?: RightmoveListingJson;
}[];
/** Parse a detail page's `__PAGE_MODEL` into a listing JSON payload. */
export declare function parseRightmoveDetail(html: string, url: string): RightmoveListingJson;
export declare function rightmoveTypeaheadUrl(city: string): string;
export declare function rightmoveSearchUrl(locationIdentifier: string, kind: 'rent' | 'sale', index?: number): string;
