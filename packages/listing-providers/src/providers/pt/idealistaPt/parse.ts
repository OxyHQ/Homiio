/**
 * Idealista.pt HTML / JSON-LD parsing (pure).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { extractEsSchemaListings, pickEsListing, type EsSchemaListing } from '../../../parse/jsonLd';
import { IDEALISTA_PT_BASE_URL } from './fixtures';

export interface IdealistaPtRaw {
  sourceId: string;
  url: string;
  listing: EsSchemaListing;
  contact?: NormalizedListingContact;
}

const DETAIL_LINK_RE = /href=["']([^"']*\/imovel\/(\d+)\/[^"']*)["']/gi;

export function idealistaPtSourceIdFromUrl(url: string): string | undefined {
  return url.match(/\/imovel\/(\d+)/)?.[1];
}

function resolveOperation(listing: EsSchemaListing, url: string): 'rent' | 'sale' {
  if (listing.operation) return listing.operation;
  return url.includes('/comprar') || url.includes('-venda') ? 'sale' : 'rent';
}

export function parseIdealistaPtDetail(html: string, url: string): IdealistaPtRaw {
  const listing = pickEsListing(extractEsSchemaListings(html));
  if (!listing) {
    throw new Error(`idealista_pt: no real-estate JSON-LD found at ${url}`);
  }
  const canonicalUrl = listing.url ?? url;
  const sourceId = idealistaPtSourceIdFromUrl(canonicalUrl) ?? idealistaPtSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`idealista_pt: cannot derive a source id from ${url}`);
  }
  return {
    sourceId,
    url: canonicalUrl,
    listing: { ...listing, operation: resolveOperation(listing, canonicalUrl) },
  };
}

export function parseIdealistaPtSearch(html: string): { sourceId: string; url: string }[] {
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const match of html.matchAll(DETAIL_LINK_RE)) {
    const sourceId = match[2];
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    refs.push({ sourceId, url: `${IDEALISTA_PT_BASE_URL}/imovel/${sourceId}/` });
  }
  return refs;
}
