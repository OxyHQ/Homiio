/**
 * Casa.it parsing — JSON search AJAX + JSON-LD detail (pure).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromAdvertiser } from '../../../parse/contact';
import { extractItSchemaListings, pickItListing, type ItSchemaListing } from '../../../parse/jsonLd';
import { CASA_IT_BASE_URL } from './fixtures';

export interface CasaItRaw {
  sourceId: string;
  url: string;
  listing: ItSchemaListing;
  contact?: NormalizedListingContact;
}

const DETAIL_LINK_RE = /href=["']([^"']*\/immobili\/(\d+)\/?[^"']*)["']/gi;
const CONTACT_JSON_RE =
  /<script[^>]*(?:id=["']listing-contact["']|type=["']application\/json["'][^>]*id=["']listing-contact["'])[^>]*>([\s\S]*?)<\/script>/i;

export function casaItSourceIdFromUrl(url: string): string | undefined {
  return url.match(/\/immobili\/(\d+)/)?.[1];
}

export function casaItWarmSearchUrl(city: string, page = 1): string {
  const slug = city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = `${CASA_IT_BASE_URL}/affitto/${slug}/`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

export function casaItSearchApiUrl(city: string, page = 1): string {
  const slug = city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${CASA_IT_BASE_URL}/api/search/listings?contract=rent&city=${encodeURIComponent(slug)}&page=${page}`;
}

function collectRefs(value: unknown, out: Map<string, string>): void {
  if (typeof value === 'string') {
    const id = casaItSourceIdFromUrl(value);
    if (id) out.set(id, `${CASA_IT_BASE_URL}/immobili/${id}/`);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectRefs(entry, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const idRaw = record.id ?? record.propertyId ?? record.adId;
    if (typeof idRaw === 'string' || typeof idRaw === 'number') {
      const sourceId = String(idRaw).replace(/\D/g, '');
      if (/^\d{5,}$/.test(sourceId)) {
        out.set(sourceId, `${CASA_IT_BASE_URL}/immobili/${sourceId}/`);
      }
    }
    const url = record.url ?? record.detailUrl ?? record.link;
    if (typeof url === 'string') {
      const id = casaItSourceIdFromUrl(url);
      if (id) out.set(id, `${CASA_IT_BASE_URL}/immobili/${id}/`);
    }
    for (const key of ['listings', 'results', 'items', 'ads', 'data', 'content']) {
      if (key in record) collectRefs(record[key], out);
    }
  }
}

export function parseCasaItSearchJson(body: string): { sourceId: string; url: string }[] {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];
  try {
    const out = new Map<string, string>();
    collectRefs(JSON.parse(trimmed) as unknown, out);
    return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
  } catch {
    return [];
  }
}

export function parseCasaItSearch(html: string): { sourceId: string; url: string }[] {
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const match of html.matchAll(DETAIL_LINK_RE)) {
    const sourceId = match[2];
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    refs.push({ sourceId, url: `${CASA_IT_BASE_URL}/immobili/${sourceId}/` });
  }
  return refs;
}

function resolveOperation(listing: ItSchemaListing, url: string): 'rent' | 'sale' {
  if (listing.operation) return listing.operation;
  return url.includes('/vendita') || url.includes('/compra') ? 'sale' : 'rent';
}

export function parseCasaItDetail(html: string, url: string): CasaItRaw {
  const listing = pickItListing(extractItSchemaListings(html));
  if (!listing) {
    throw new Error(`casa_it: no real-estate JSON-LD found at ${url}`);
  }
  const canonicalUrl = listing.url ?? url;
  const sourceId = casaItSourceIdFromUrl(canonicalUrl) ?? casaItSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`casa_it: cannot derive a source id from ${url}`);
  }
  const contactMatch = html.match(CONTACT_JSON_RE)?.[1];
  let contact: NormalizedListingContact | undefined;
  if (contactMatch) {
    try {
      contact = contactFromAdvertiser(JSON.parse(contactMatch) as unknown);
    } catch {
      contact = undefined;
    }
  }
  return {
    sourceId,
    url: canonicalUrl,
    listing: { ...listing, operation: resolveOperation(listing, canonicalUrl) },
    contact,
  };
}
