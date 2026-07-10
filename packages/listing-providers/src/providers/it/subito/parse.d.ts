/**
 * Subito.it housing parsing — JSON-first with strict housing-category guards.
 *
 * Subito is a general classifieds portal. Discover URLs and normalize() MUST
 * reject non-housing categories (auto, lavoro, elettronica, …).
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
export interface SubitoRaw {
    sourceId: string;
    url: string;
    title?: string;
    description?: string;
    price?: number;
    currency: string;
    operation: 'rent' | 'sale';
    categoryUri: string;
    bedrooms?: number;
    bathrooms?: number;
    squareMeters?: number;
    city?: string;
    region?: string;
    images: string[];
    furnished?: boolean;
    contact?: NormalizedListingContact;
}
export declare function isSubitoHousingCategory(uriOrPath: string): boolean;
export declare function subitoSourceIdFromUrl(url: string): string | undefined;
export declare function subitoWarmSearchUrl(city: string, page?: number): string;
export declare function subitoSearchApiUrl(city: string, page?: number): string;
export declare function parseSubitoSearchJson(body: string): {
    sourceId: string;
    url: string;
}[];
export declare function parseSubitoSearch(html: string): {
    sourceId: string;
    url: string;
}[];
export declare function parseSubitoDetail(html: string, url: string): SubitoRaw;
