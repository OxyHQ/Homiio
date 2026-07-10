/**
 * pisos.com parsers — JSON-first (JSON-LD search cards + embedded detail JSON).
 *
 * Search: schema.org JSON-LD blocks → refs.
 * Detail: `data-var` JSON + tracking/`precio` JSON + optional contact AJAX.
 * HTML is only used for title/description/image fallbacks when JSON lacks them.
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
import { type EsSchemaListing } from '../../parse/jsonLd';
/** Raw payload `fetch()` hands to `normalize()`. */
export interface PisosRaw {
    sourceId: string;
    url: string;
    listing: EsSchemaListing;
    contact?: NormalizedListingContact;
}
/** Extract stable id from a pisos detail URL (`…-<id>_<agency>/` or `…-<id>/`). */
export declare function pisosSourceIdFromUrl(url: string): string | undefined;
/**
 * Parse search HTML into de-duplicated detail refs from JSON-LD cards.
 */
export declare function parsePisosSearch(html: string): {
    sourceId: string;
    url: string;
}[];
/**
 * Parse a detail page into {@link PisosRaw}. Prefers embedded JSON blobs;
 * falls back to JSON-LD / light HTML for title, images, description.
 */
export declare function parsePisosDetail(html: string, url: string): PisosRaw;
/** Merge best-effort contact AJAX phone into an existing raw payload. */
export declare function mergePisosContact(raw: PisosRaw, phone: string | undefined): PisosRaw;
