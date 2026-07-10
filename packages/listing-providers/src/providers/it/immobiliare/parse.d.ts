/**
 * Immobiliare.it JSON / `__NEXT_DATA__` parsing (pure, JSON-first).
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
export interface ImmobiliareRaw {
    sourceId: string;
    url: string;
    title?: string;
    description?: string;
    price?: number;
    currency: string;
    operation: 'rent' | 'sale';
    propertyType?: string;
    bedrooms?: number;
    bathrooms?: number;
    squareMeters?: number;
    floor?: number;
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    neighborhood?: string;
    coordinates?: {
        lat: number;
        lng: number;
    };
    images: string[];
    amenities: string[];
    furnished?: boolean;
    contact?: NormalizedListingContact;
}
export declare function immobiliareSourceIdFromUrl(url: string): string | undefined;
export declare function immobiliareWarmSearchUrl(city: string, page?: number): string;
/** Candidate search-list AJAX URLs tried after warm-up (JSON-first). */
export declare function immobiliareSearchApiUrls(city: string, page?: number): string[];
/** Parse search-list AJAX JSON into de-duplicated refs (and optional rich rows). */
export declare function parseImmobiliareSearchJson(body: string): {
    sourceId: string;
    url: string;
}[];
/** Parse search HTML: prefer `__NEXT_DATA__`, merge with `/annunci/<id>/` links. */
export declare function parseImmobiliareSearch(html: string): {
    sourceId: string;
    url: string;
}[];
/** Parse detail HTML — `__NEXT_DATA__` is required (JSON-first). */
export declare function parseImmobiliareDetail(html: string, url: string): ImmobiliareRaw;
