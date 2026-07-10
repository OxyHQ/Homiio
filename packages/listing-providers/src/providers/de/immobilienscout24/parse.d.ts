/**
 * ImmobilienScout24 mobile-API parsing — pure JSON.
 * Reuses shared contact/html helpers (no local phone/euro/slug duplicates).
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
export interface Is24SearchRef {
    sourceId: string;
    url: string;
    title?: string;
    realEstateType?: string;
}
export interface Is24RawListing {
    sourceId: string;
    url: string;
    title?: string;
    description?: string;
    realEstateType?: string;
    operation: 'rent' | 'sale';
    price?: number;
    currency: string;
    bedrooms?: number;
    bathrooms?: number;
    squareMeters?: number;
    floor?: number;
    address: {
        street?: string;
        city?: string;
        postalCode?: string;
        neighborhood?: string;
        region?: string;
        lat?: number;
        lng?: number;
    };
    images: string[];
    contact?: NormalizedListingContact;
}
export declare function is24Geocode(city: string): string;
export declare function is24SearchListUrl(city: string, page?: number, operation?: 'rent' | 'sale'): string;
export declare function is24ExposeUrl(sourceId: string): string;
export declare function is24PublicUrl(sourceId: string): string;
export declare function is24SourceIdFromUrl(url: string): string | undefined;
export declare function parseIs24Search(body: string): Is24SearchRef[];
export declare function parseIs24Expose(body: string, fallbackUrl?: string): Is24RawListing;
