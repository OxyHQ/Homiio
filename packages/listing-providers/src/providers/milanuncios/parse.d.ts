/**
 * milanuncios JSON parsers + housing guards.
 */
import { type NormalizedListing, type NormalizedListingContact } from '@homiio/shared-types';
export interface MilanunciosRaw {
    sourceId: string;
    url: string;
    categorySlug: string;
    categoryId?: string;
    title: string;
    description?: string;
    price: number;
    currency: string;
    operation: 'rent' | 'sale';
    typology?: string;
    rooms?: number;
    bathrooms?: number;
    squareMeters?: number;
    city: string;
    neighborhood?: string;
    province?: string;
    images: string[];
    contact?: NormalizedListingContact;
}
export declare function milanunciosSourceIdFromUrl(url: string): string | undefined;
/**
 * Parse a list/search AJAX JSON body into detail refs. Only housing-category
 * adverts are yielded.
 */
export declare function parseMilanunciosSearchJson(body: string): {
    sourceId: string;
    url: string;
}[];
/** Parse a single advert JSON object into {@link MilanunciosRaw}. */
export declare function parseMilanunciosAdvert(payload: unknown, fallbackUrl?: string): MilanunciosRaw;
/**
 * Map a raw advert onto {@link NormalizedListing}, hard-rejecting non-housing.
 */
export declare function normalizeMilanunciosRaw(raw: MilanunciosRaw): NormalizedListing;
