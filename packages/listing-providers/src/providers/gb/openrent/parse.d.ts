/**
 * OpenRent parsers (housing-native private-landlord rentals).
 *
 * Search yields `/property-to-rent/.../<id>` links. Detail pages expose rent in
 * `<title>` and images via og:image; contact is often form-gated (best-effort).
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
export interface OpenRentListingJson {
    sourceId: string;
    url: string;
    title?: string;
    displayAddress?: string;
    description?: string;
    bedrooms?: number;
    bathrooms?: number;
    propertyType?: string;
    priceAmount?: number;
    priceCurrency?: string;
    images: string[];
    contact?: NormalizedListingContact;
}
export declare function openrentSourceIdFromUrl(url: string): string | undefined;
export declare function openrentSearchUrl(city: string, page?: number): string;
export declare function parseOpenRentSearch(html: string): {
    sourceId: string;
    url: string;
}[];
export declare function parseOpenRentDetail(html: string, url: string): OpenRentListingJson;
