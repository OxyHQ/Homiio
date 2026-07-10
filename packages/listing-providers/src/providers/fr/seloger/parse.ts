/**
 * SeLoger parsers — prefer embedded JSON (`window["initialData"]` / `__NEXT_DATA__`).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { parseNextData } from '../../../parse/nextData';
import { contactFromUnknown } from '../../../parse/contact';
import { SELOGER_BASE_URL } from './fixtures';
import { asNumber, asString, isRecord } from '../../../parse/guards';

export interface SelogerRawListing {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
  price: number;
  currency: 'EUR';
  city: string;
  postalCode?: string;
  title?: string;
  description?: string;
  propertyType?: string;
  squareMeters?: number;
  rooms?: number;
  bedrooms?: number;
  images: string[];
  coordinates?: { lat: number; lng: number };
  contact?: NormalizedListingContact;
}

function priceFromCard(card: Record<string, unknown>): number | undefined {
  if (isRecord(card.pricing)) {
    const raw =
      asNumber(card.pricing.rawPrice) ??
      asNumber(card.pricing.price) ??
      asNumber(card.pricing.priceValue);
    if (raw !== undefined && raw > 0) return raw;
  }
  return asNumber(card.price) ?? asNumber(card.rawPrice);
}

function kindFromCard(card: Record<string, unknown>): 'rent' | 'sale' {
  const tx =
    asString(card.transactionType)?.toLowerCase() ??
    asString(card.project)?.toLowerCase() ??
    asString(card.nature)?.toLowerCase();
  if (tx && /(buy|achat|sale|vente)/i.test(tx)) return 'sale';
  if (typeof card.nature === 'number' && card.nature === 1) return 'sale';
  return 'rent';
}

function photosFromCard(card: Record<string, unknown>): string[] {
  const photos = card.photos ?? card.medias ?? card.images;
  if (!Array.isArray(photos)) return [];
  const out: string[] = [];
  for (const photo of photos) {
    if (typeof photo === 'string' && /^https?:\/\//i.test(photo)) {
      out.push(photo);
      continue;
    }
    if (isRecord(photo)) {
      const url = asString(photo.url) ?? asString(photo.src) ?? asString(photo.photoUrl);
      if (url && /^https?:\/\//i.test(url)) out.push(url);
    }
  }
  return out;
}

function listingFromCard(card: Record<string, unknown>): SelogerRawListing | undefined {
  if (asString(card.cardType) && asString(card.cardType) !== 'classified') return undefined;
  const sourceId =
    asString(card.id) ??
    (typeof card.id === 'number' ? String(card.id) : undefined) ??
    asString(card.listingId);
  if (!sourceId) return undefined;
  const price = priceFromCard(card);
  if (price === undefined) return undefined;
  const city = asString(card.city) ?? asString(card.cityLabel) ?? asString(card.zipCode);
  if (!city) return undefined;

  const kind = kindFromCard(card);
  const listing: SelogerRawListing = {
    sourceId,
    url: `${SELOGER_BASE_URL}/annonces/${kind === 'sale' ? 'achat' : 'locations'}/appartement/${sourceId}.htm`,
    kind,
    price,
    currency: 'EUR',
    city,
    images: photosFromCard(card),
  };

  const postalCode = asString(card.zipCode) ?? asString(card.postalCode);
  if (postalCode) listing.postalCode = postalCode;
  const title = asString(card.title);
  if (title) listing.title = title;
  const description = asString(card.description);
  if (description) listing.description = description;
  const propertyType = asString(card.estateType) ?? asString(card.propertyType);
  if (propertyType) listing.propertyType = propertyType;
  const surface = asNumber(card.surface) ?? asNumber(card.livingArea);
  if (surface !== undefined && surface > 0) listing.squareMeters = surface;
  const rooms = asNumber(card.rooms);
  if (rooms !== undefined) listing.rooms = rooms;
  const bedrooms = asNumber(card.bedrooms);
  if (bedrooms !== undefined) listing.bedrooms = bedrooms;
  const pos = isRecord(card.position)
    ? card.position
    : isRecord(card.coordinates)
      ? card.coordinates
      : undefined;
  if (pos) {
    const lat = asNumber(pos.lat) ?? asNumber(pos.latitude);
    const lng = asNumber(pos.lng) ?? asNumber(pos.lon) ?? asNumber(pos.longitude);
    if (lat !== undefined && lng !== undefined) listing.coordinates = { lat, lng };
  }
  const contact = contactFromUnknown(card.contact ?? card.agency ?? card.advertiser);
  if (contact) listing.contact = contact;
  const explicitUrl = asString(card.url) ?? asString(card.permalink);
  if (explicitUrl && explicitUrl.startsWith('http')) listing.url = explicitUrl;

  return listing;
}

/** Extract `window["initialData"] = JSON.parse("...")` payload. */
export function extractSelogerInitialData(html: string): unknown | undefined {
  const match = html.match(
    /window\s*\[\s*["']initialData["']\s*\]\s*=\s*JSON\.parse\(\s*"((?:\\.|[^"\\])*)"\s*\)/i,
  );
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(JSON.parse(`"${match[1]}"`) as string) as unknown;
  } catch {
    return undefined;
  }
}

function cardsFromInitialData(data: unknown): Record<string, unknown>[] {
  if (!isRecord(data)) return [];
  const cards = isRecord(data.cards) ? data.cards.list : undefined;
  if (!Array.isArray(cards)) return [];
  return cards.filter(isRecord);
}

export interface SelogerSearchRef {
  sourceId: string;
  url: string;
}

export function parseSelogerSearch(html: string): SelogerSearchRef[] {
  const data = extractSelogerInitialData(html);
  const cards = data ? cardsFromInitialData(data) : [];
  const out: SelogerSearchRef[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const listing = listingFromCard(card);
    if (!listing) continue;
    if (seen.has(listing.sourceId)) continue;
    seen.add(listing.sourceId);
    out.push({ sourceId: listing.sourceId, url: listing.url });
  }
  return out;
}

function listingFromNextData(html: string, url: string): SelogerRawListing | undefined {
  const parsed = parseNextData(html);
  if (!parsed) return undefined;
  const listingNode = findListingNode(parsed);
  if (!listingNode) return undefined;
  const listing = listingFromCard(listingNode);
  if (!listing) return undefined;
  if (url.startsWith('http')) listing.url = url;

  // Enrich from Next detail shape
  if (isRecord(listingNode.pricing)) {
    const price = asNumber(listingNode.pricing.price) ?? asNumber(listingNode.pricing.rawPrice);
    if (price !== undefined && price > 0) listing.price = price;
  }
  if (isRecord(listingNode.contact)) {
    const contact = contactFromUnknown(listingNode.contact);
    if (contact) listing.contact = contact;
  }
  if (isRecord(listingNode.coordinates)) {
    const lat = asNumber(listingNode.coordinates.latitude) ?? asNumber(listingNode.coordinates.lat);
    const lng =
      asNumber(listingNode.coordinates.longitude) ??
      asNumber(listingNode.coordinates.lng) ??
      asNumber(listingNode.coordinates.lon);
    if (lat !== undefined && lng !== undefined) listing.coordinates = { lat, lng };
  }
  return listing;
}

function findListingNode(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth > 10 || value === null) return undefined;
  if (isRecord(value)) {
    if (
      (value.id !== undefined || value.listingId !== undefined) &&
      (value.pricing !== undefined || value.price !== undefined || value.surface !== undefined)
    ) {
      return value;
    }
    if (isRecord(value.listing)) return findListingNode(value.listing, depth + 1);
    if (isRecord(value.listingData)) return findListingNode(value.listingData, depth + 1);
    for (const child of Object.values(value)) {
      const found = findListingNode(child, depth + 1);
      if (found) return found;
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findListingNode(entry, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function parseSelogerDetail(html: string, url: string): SelogerRawListing {
  const fromNext = listingFromNextData(html, url);
  if (fromNext) return fromNext;

  const data = extractSelogerInitialData(html);
  if (data) {
    const cards = cardsFromInitialData(data);
    for (const card of cards) {
      const listing = listingFromCard(card);
      if (listing) {
        if (url.startsWith('http')) listing.url = url;
        return listing;
      }
    }
  }

  throw new Error('seloger: no listing JSON in page');
}

export function selogerSearchUrl(city: string, page = 1): string {
  const slug = city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-');
  // projects=2 → location (rent); types=1,2 → appartement/maison
  const base = `${SELOGER_BASE_URL}/list.htm?projects=2&types=1,2&enterprise=0&qsVersion=1.0&places=[{"divison\":null,\"type\":2,\"label\":\"${city}\"}]`;
  void slug;
  return page <= 1 ? base : `${base}&LISTING-LISTpg=${page}`;
}

/** Paris INSEE-based search URL used for warm-up probes. */
export function selogerWarmSearchUrl(city: string, page = 1): string {
  const inseeByCity: Record<string, number> = {
    paris: 750056,
    lyon: 691231,
    marseille: 130555,
    bordeaux: 330630,
    lille: 593500,
  };
  const slug = city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const insee = inseeByCity[slug] ?? 750056;
  const base = `${SELOGER_BASE_URL}/list.htm?projects=2&types=1,2&places=[{"inseeCodes":[${insee}]}]&enterprise=0&qsVersion=1.0`;
  return page <= 1 ? base : `${base}&LISTING-LISTpg=${page}`;
}

export function selogerSourceIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/(\d{6,})\.htm/i) ?? url.match(/\/annonces\/[^/]+\/[^/]+\/(\d+)/i);
  return match?.[1];
}
