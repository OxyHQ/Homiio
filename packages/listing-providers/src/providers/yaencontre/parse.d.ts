/**
 * yaencontre.com JSON parsers (pure).
 */
import { type NormalizedListing, type NormalizedListingContact } from '@homiio/shared-types';
export interface YaencontreRaw {
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
export declare function yaencontreSourceIdFromUrl(url: string): string | undefined;
export declare function parseYaencontreSearchJson(body: string): {
    sourceId: string;
    url: string;
}[];
export declare function parseYaencontreDetailJson(payload: unknown, fallbackUrl?: string): YaencontreRaw;
export declare function normalizeYaencontreRaw(raw: YaencontreRaw): NormalizedListing;
