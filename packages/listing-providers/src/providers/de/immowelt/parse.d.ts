/**
 * Immowelt SERP JSON parsing — shared html/contact; LZ decompress for
 * `classified-serp-init-data` (no duplicated JSON.parse-blob extractor).
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
export interface ImmoweltSearchRef {
    sourceId: string;
    url: string;
}
export interface ImmoweltRawListing {
    sourceId: string;
    onlineId?: string;
    url: string;
    title?: string;
    description?: string;
    operation: 'rent' | 'sale';
    propertyType: string;
    price?: number;
    currency: string;
    bedrooms?: number;
    squareMeters?: number;
    floor?: number;
    address: {
        street?: string;
        city?: string;
        postalCode?: string;
        neighborhood?: string;
        countryCode?: string;
    };
    images: string[];
    contact?: NormalizedListingContact;
}
export declare function immoweltSearchUrl(city: string, page?: number): string;
export declare function immoweltExposeUrl(legacyId: string): string;
export declare function immoweltSourceIdFromUrl(url: string): string | undefined;
export declare function isImmoweltChallenge(body: string): boolean;
/** Decompress Immowelt SERP init cards via shared {@link extractJsonParseBlob}. */
export declare function parseImmoweltSearchCards(html: string): Record<string, unknown>[];
export declare function parseImmoweltSearch(html: string): ImmoweltSearchRef[];
export declare function parseImmoweltCard(card: Record<string, unknown>): ImmoweltRawListing;
export declare function parseImmoweltDetail(htmlOrJson: string, url: string): ImmoweltRawListing;
