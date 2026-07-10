/**
 * Fotocasa HTML parsing (pure, DOM-free).
 *
 * Detail pages embed schema.org JSON-LD and/or Next.js `__NEXT_DATA__`.
 * JSON-LD and Next hydration parsing delegate to shared `src/parse/*` modules.
 */

import { extractEurListingFromNextData } from '../../parse/nextData';
import { extractEsSchemaListings, pickEsListing, type EsSchemaListing } from '../../parse/jsonLd';
import { FOTOCASA_BASE_URL } from './fixtures';

/** The raw payload Fotocasa `fetch()` hands to `normalize()`. */
export interface FotocasaRaw {
  sourceId: string;
  url: string;
  listing: EsSchemaListing;
}

/** Match Fotocasa detail links (`…/<id>/d`) and capture the numeric id. */
const DETAIL_LINK_RE = /href=["']([^"']*\/(\d{6,})\/d)["']/gi;

/** Extract the stable listing id from a Fotocasa detail URL (`…/<id>/d`). */
export function fotocasaSourceIdFromUrl(url: string): string | undefined {
  return url.match(/\/(\d{6,})\/d\b/)?.[1] ?? url.match(/\/(\d{6,})(?:\/|$)/)?.[1];
}

/** Rent vs sale: prefer the JSON-LD offer, fall back to the URL (`/comprar`). */
function resolveOperation(listing: EsSchemaListing, url: string): 'rent' | 'sale' {
  if (listing.operation) return listing.operation;
  return url.includes('/comprar') || url.includes('/venta') ? 'sale' : 'rent';
}

/**
 * Parse a Fotocasa detail-page HTML into a {@link FotocasaRaw}. Throws when the
 * page carries no recognizable real-estate JSON-LD (delisted or a challenge
 * page served instead of content).
 */
export function parseFotocasaDetail(html: string, url: string): FotocasaRaw {
  const listing =
    pickEsListing(extractEsSchemaListings(html)) ??
    extractEurListingFromNextData(html, { url, defaultCountryCode: 'ES' });
  if (!listing) {
    throw new Error(`fotocasa: no real-estate JSON-LD found at ${url}`);
  }
  const canonicalUrl = listing.url ?? url;
  const sourceId = fotocasaSourceIdFromUrl(canonicalUrl) ?? fotocasaSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`fotocasa: cannot derive a source id from ${url}`);
  }
  return {
    sourceId,
    url: canonicalUrl,
    listing: { ...listing, operation: resolveOperation(listing, canonicalUrl) },
  };
}

/**
 * Parse a Fotocasa search-results HTML into de-duplicated detail refs. Relative
 * links are resolved against {@link FOTOCASA_BASE_URL}; duplicates collapse by id.
 */
export function parseFotocasaSearch(html: string): { sourceId: string; url: string }[] {
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const match of html.matchAll(DETAIL_LINK_RE)) {
    const href = match[1];
    const sourceId = match[2];
    if (!href || !sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    const url = href.startsWith('http') ? href : `${FOTOCASA_BASE_URL}${href}`;
    refs.push({ sourceId, url });
  }
  return refs;
}
