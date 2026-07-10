/**
 * Idealista.it HTML / JSON-LD parsing (pure).
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
import { type ItSchemaListing } from '../../../parse/jsonLd';
export interface IdealistaItRaw {
    sourceId: string;
    url: string;
    listing: ItSchemaListing;
    contact?: NormalizedListingContact;
}
export declare function idealistaItSourceIdFromUrl(url: string): string | undefined;
export declare function parseIdealistaItDetail(html: string, url: string): IdealistaItRaw;
export declare function parseIdealistaItSearch(html: string): {
    sourceId: string;
    url: string;
}[];
