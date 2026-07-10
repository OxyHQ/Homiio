/**
 * Idealista HTML parsing (pure, DOM-free).
 *
 * Idealista's public detail pages embed the listing as schema.org JSON-LD, so
 * `fetch()` pulls the detail HTML through the shared {@link FetchRuntime} ladder
 * and this module flattens the JSON-LD (via the shared ES helper) into an
 * {@link IdealistaRaw}. Search-results pages are parsed for `/inmueble/<id>/`
 * links into de-duplicated refs. Keeping extraction pure means the parser runs
 * identically in the worker and in unit tests, with zero extra dependencies.
 */

import { extractEsSchemaListings, pickEsListing, type EsSchemaListing } from '../es/jsonLd';
import { IDEALISTA_BASE_URL } from './fixtures';
import type { IdealistaContact } from './contact';

/** The raw payload Idealista `fetch()` hands to `normalize()`. */
export interface IdealistaRaw {
  sourceId: string;
  url: string;
  listing: EsSchemaListing;
  /** Best-effort contact from warmed-session AJAX (optional). */
  contact?: IdealistaContact;
}

/** Match Idealista detail links and capture the numeric listing id. */
const DETAIL_LINK_RE = /href=["']([^"']*\/inmueble\/(\d+)\/[^"']*)["']/gi;

/** Extract the stable listing id from an Idealista URL (`/inmueble/<id>/`). */
export function idealistaSourceIdFromUrl(url: string): string | undefined {
  return url.match(/\/inmueble\/(\d+)/)?.[1];
}

/** Rent vs sale: prefer the JSON-LD offer, fall back to the URL (`/venta`). */
function resolveOperation(listing: EsSchemaListing, url: string): 'rent' | 'sale' {
  if (listing.operation) return listing.operation;
  return url.includes('/venta') || url.includes('-venta') ? 'sale' : 'rent';
}

/**
 * Parse an Idealista detail-page HTML into an {@link IdealistaRaw}. Throws when
 * the page carries no recognizable real-estate JSON-LD (delisted listing or a
 * challenge page served instead of content).
 */
export function parseIdealistaDetail(html: string, url: string): IdealistaRaw {
  const listing = pickEsListing(extractEsSchemaListings(html));
  if (!listing) {
    throw new Error(`idealista: no real-estate JSON-LD found at ${url}`);
  }
  const canonicalUrl = listing.url ?? url;
  const sourceId = idealistaSourceIdFromUrl(canonicalUrl) ?? idealistaSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`idealista: cannot derive a source id from ${url}`);
  }
  return {
    sourceId,
    url: canonicalUrl,
    listing: { ...listing, operation: resolveOperation(listing, canonicalUrl) },
  };
}

/**
 * Parse an Idealista search-results HTML into de-duplicated detail refs
 * (`{ sourceId, url }`). Relative links are resolved against
 * {@link IDEALISTA_BASE_URL}; fragment/duplicate links collapse by id.
 */
export function parseIdealistaSearch(html: string): { sourceId: string; url: string }[] {
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const match of html.matchAll(DETAIL_LINK_RE)) {
    const sourceId = match[2];
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    refs.push({ sourceId, url: `${IDEALISTA_BASE_URL}/inmueble/${sourceId}/` });
  }
  return refs;
}
