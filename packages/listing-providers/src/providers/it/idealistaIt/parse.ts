/**
 * Idealista.it HTML / JSON-LD parsing (pure).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { extractItSchemaListings, pickItListing, type ItSchemaListing } from '../../../parse/jsonLd';
import { IDEALISTA_IT_BASE_URL } from './fixtures';

export interface IdealistaItRaw {
  sourceId: string;
  url: string;
  listing: ItSchemaListing;
  contact?: NormalizedListingContact;
}

const DETAIL_LINK_RE = /href=["']([^"']*\/immobile\/(\d+)\/[^"']*)["']/gi;

export function idealistaItSourceIdFromUrl(url: string): string | undefined {
  return url.match(/\/immobile\/(\d+)/)?.[1];
}

function resolveOperation(listing: ItSchemaListing, url: string): 'rent' | 'sale' {
  if (listing.operation) return listing.operation;
  return url.includes('/vendita') || url.includes('-vendita') ? 'sale' : 'rent';
}

export function parseIdealistaItDetail(html: string, url: string): IdealistaItRaw {
  const listing = pickItListing(extractItSchemaListings(html));
  if (!listing) {
    throw new Error(`idealista_it: no real-estate JSON-LD found at ${url}`);
  }
  const canonicalUrl = listing.url ?? url;
  const sourceId = idealistaItSourceIdFromUrl(canonicalUrl) ?? idealistaItSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`idealista_it: cannot derive a source id from ${url}`);
  }
  return {
    sourceId,
    url: canonicalUrl,
    listing: { ...listing, operation: resolveOperation(listing, canonicalUrl) },
  };
}

export function parseIdealistaItSearch(html: string): { sourceId: string; url: string }[] {
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const match of html.matchAll(DETAIL_LINK_RE)) {
    const sourceId = match[2];
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    refs.push({ sourceId, url: `${IDEALISTA_IT_BASE_URL}/immobile/${sourceId}/` });
  }
  return refs;
}
