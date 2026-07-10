/**
 * SeLoger parsers — prefer embedded JSON (`initialData` / shared `__NEXT_DATA__`).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromUnknown } from '../../../contact';
import { findNextDataRecord, parseNextData } from '../../../nextData';
import { SELOGER_BASE_URL } from './fixtures';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const cleaned = value.replace(/[^\d.,]/g, '').replace(/\s/g, '').replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
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
      const url = asString(photo.url) ?? asString(photo.src);
      if (url && /^https?:\/\//i.test(url)) out.push(url);
    }
  }
  return out;
}

function listingFromCard(card: Record<string, unknown>): SelogerRawListing | undefined {
  if (asString(card.cardType) && asString(card.cardType) !== 'classified') return undefined;
  const sourceId =
    asString(card.id) ?? (typeof card.id === 'number' ? String(card.id) : undefined);
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
  if (explicitUrl?.startsWith('http')) listing.url = explicitUrl;

  return listing;
}

/** SeLoger-specific `window["initialData"] = JSON.parse("...")` (not Next.js). */
export function extractSelogerInitialData(html: string): unknown | undefined {
  const match = html.match(
    /window\s*\[\s*["']initialData["']\s*\]\s*=\s*JSON\.parse\(\s*"((?:\\.|[^"\\])*)"\s*\)/i,
  );
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(JSON.parse(`"${match[1]}"`) as string) as unknown;
  } catch {
    try {
      const unescaped = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return JSON.parse(unescaped) as unknown;
    } catch {
      return undefined;
    }
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
    if (!listing || seen.has(listing.sourceId)) continue;
    seen.add(listing.sourceId);
    out.push({ sourceId: listing.sourceId, url: listing.url });
  }
  return out;
}

function isListingNode(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (value.id !== undefined || value.listingId !== undefined) &&
    (value.pricing !== undefined || value.price !== undefined || value.surface !== undefined)
  );
}

export function parseSelogerDetail(html: string, url: string): SelogerRawListing {
  const nextRoot = parseNextData(html);
  if (nextRoot) {
    const node = findNextDataRecord(nextRoot, isListingNode);
    if (node) {
      const listing = listingFromCard(node);
      if (listing) {
        if (url.startsWith('http')) listing.url = url;
        if (isRecord(node.pricing)) {
          const price = asNumber(node.pricing.price) ?? asNumber(node.pricing.rawPrice);
          if (price !== undefined && price > 0) listing.price = price;
        }
        const contact = contactFromUnknown(node.contact);
        if (contact) listing.contact = contact;
        return listing;
      }
    }
  }

  const data = extractSelogerInitialData(html);
  if (data) {
    for (const card of cardsFromInitialData(data)) {
      const listing = listingFromCard(card);
      if (listing) {
        if (url.startsWith('http')) listing.url = url;
        return listing;
      }
    }
  }

  throw new Error('seloger: no listing JSON in page');
}

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
