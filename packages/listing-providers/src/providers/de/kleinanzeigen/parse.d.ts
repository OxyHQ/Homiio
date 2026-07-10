/**
 * Kleinanzeigen immobilien parsing — housing-only via shared classifieds + contact/html.
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
export interface KleinanzeigenSearchRef {
    sourceId: string;
    url: string;
    categoryId: string;
}
export interface KleinanzeigenRawListing {
    sourceId: string;
    url: string;
    categoryId: string;
    title?: string;
    description?: string;
    operation: 'rent' | 'sale';
    price?: number;
    currency: string;
    bedrooms?: number;
    squareMeters?: number;
    floor?: number;
    address: {
        street?: string;
        city?: string;
        neighborhood?: string;
        region?: string;
        lat?: number;
        lng?: number;
    };
    images: string[];
    contact?: NormalizedListingContact;
}
export declare function isKleinanzeigenHousingCategory(categoryId: string | undefined): boolean;
export declare function kleinanzeigenHousingSearchUrl(city: string, page?: number, categoryId?: string): string;
export declare function kleinanzeigenSourceIdFromUrl(url: string): string | undefined;
export declare function kleinanzeigenCategoryFromUrl(url: string): string | undefined;
export declare function isKleinanzeigenChallenge(html: string): boolean;
/** Parse housing search HTML — non-housing category links are skipped. */
export declare function parseKleinanzeigenSearch(html: string): KleinanzeigenSearchRef[];
export declare function parseKleinanzeigenDetail(html: string, url: string): KleinanzeigenRawListing;
