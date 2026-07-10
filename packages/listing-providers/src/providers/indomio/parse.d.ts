/**
 * indomio.es JSON parsers (pure).
 */
import { type NormalizedListing, type NormalizedListingContact } from '@homiio/shared-types';
export interface IndomioRaw {
    sourceId: string;
    url: string;
    title: string;
    description?: string;
    price: number;
    currency: string;
    operation: 'rent' | 'sale';
    rooms?: number;
    bathrooms?: number;
    squareMeters?: number;
    street: string;
    city: string;
    province?: string;
    neighborhood?: string;
    images: string[];
    contact?: NormalizedListingContact;
}
export declare function indomioSourceIdFromUrl(url: string): string | undefined;
export declare function parseIndomioSearchJson(body: string): {
    sourceId: string;
    url: string;
}[];
export declare function parseIndomioDetailJson(payload: unknown, fallbackUrl?: string): IndomioRaw;
export declare function normalizeIndomioRaw(raw: IndomioRaw): NormalizedListing;
