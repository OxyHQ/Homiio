/**
 * Zoopla parsers (United Kingdom).
 *
 * Zoopla fronts Cloudflare — cold HTTP usually 403. Prefer a warmed Playwright
 * session, then parse `__NEXT_DATA__` / listing JSON when present, else
 * `/to-rent/details/<id>/` link scrape for discover.
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
export interface ZooplaListingJson {
    sourceId: string;
    url: string;
    kind: 'rent' | 'sale';
    displayAddress?: string;
    summary?: string;
    description?: string;
    bedrooms?: number;
    bathrooms?: number;
    propertyType?: string;
    priceAmount?: number;
    priceCurrency?: string;
    latitude?: number;
    longitude?: number;
    images: string[];
    contact?: NormalizedListingContact;
}
export declare function zooplaSourceIdFromUrl(url: string): string | undefined;
export declare function zooplaDetailUrl(sourceId: string, kind?: 'rent' | 'sale'): string;
export declare function zooplaSearchUrl(city: string, page?: number): string;
export declare function parseZooplaSearch(html: string): {
    sourceId: string;
    url: string;
    kind: 'rent' | 'sale';
}[];
export declare function parseZooplaDetail(html: string, url: string, kindHint?: 'rent' | 'sale'): ZooplaListingJson;
