/**
 * Casa.it parsing — JSON search AJAX + JSON-LD detail (pure).
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
import { type ItSchemaListing } from '../../../parse/jsonLd';
export interface CasaItRaw {
    sourceId: string;
    url: string;
    listing: ItSchemaListing;
    contact?: NormalizedListingContact;
}
export declare function casaItSourceIdFromUrl(url: string): string | undefined;
export declare function casaItWarmSearchUrl(city: string, page?: number): string;
export declare function casaItSearchApiUrl(city: string, page?: number): string;
export declare function parseCasaItSearchJson(body: string): {
    sourceId: string;
    url: string;
}[];
export declare function parseCasaItSearch(html: string): {
    sourceId: string;
    url: string;
}[];
export declare function parseCasaItDetail(html: string, url: string): CasaItRaw;
