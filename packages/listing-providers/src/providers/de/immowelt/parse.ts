/**
 * Immowelt SERP JSON parsing — shared html/contact; LZ decompress for
 * `classified-serp-init-data` (no duplicated JSON.parse-blob extractor).
 */

import { decompressFromBase64 } from 'lz-string';
import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromAdvertiser } from '../../../contact';
import {
  asNumber,
  asRecord,
  asString,
  citySlugDe,
  extractJsonParseBlob,
  parseEuroAmount,
} from '../../../html';
import { IMMOWELT_BASE_URL } from './fixtures';

export interface ImmoweltSearchRef {
  sourceId: string;
  url: string;
}

export interface ImmoweltRawListing {
  sourceId: string;
  onlineId?: string;
  url: string;
  title?: string;
  description?: string;
  operation: 'rent' | 'sale';
  propertyType: string;
  price?: number;
  currency: string;
  bedrooms?: number;
  squareMeters?: number;
  floor?: number;
  address: {
    street?: string;
    city?: string;
    postalCode?: string;
    neighborhood?: string;
    countryCode?: string;
  };
  images: string[];
  contact?: NormalizedListingContact;
}

const EXPOSE_UUID_RE =
  /\/expose\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function immoweltSearchUrl(city: string, page = 1): string {
  const slug = citySlugDe(city);
  const base = `${IMMOWELT_BASE_URL}/liste/${slug}/wohnungen/mieten`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

export function immoweltExposeUrl(legacyId: string): string {
  return `${IMMOWELT_BASE_URL}/expose/${legacyId}`;
}

export function immoweltSourceIdFromUrl(url: string): string | undefined {
  return url.match(
    /\/expose\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  )?.[1];
}

export function isImmoweltChallenge(body: string): boolean {
  if (body.trim().length < 512) return true;
  return /captcha-delivery|datadome|geo\.captcha|access denied|ich bin kein roboter/i.test(body);
}

/** Decompress Immowelt SERP init cards via shared {@link extractJsonParseBlob}. */
export function parseImmoweltSearchCards(html: string): Record<string, unknown>[] {
  const blob = extractJsonParseBlob(html, 'classified-serp-init-data');
  if (!blob) return [];
  try {
    const outerString = JSON.parse(`"${blob}"`) as string;
    const outer = asRecord(JSON.parse(outerString) as unknown);
    const compressed =
      asString(asRecord(outer?.data)?.['classified-serp-init-data']) ??
      asString(outer?.compressed);
    if (!compressed) return [];
    const decompressed = decompressFromBase64(compressed);
    if (!decompressed) return [];
    const data = asRecord(JSON.parse(decompressed) as unknown);
    const pageProps = asRecord(data?.pageProps) ?? data;
    const classifieds = pageProps?.classifiedsData;
    if (Array.isArray(classifieds)) {
      return classifieds.filter((entry): entry is Record<string, unknown> => !!asRecord(entry));
    }
    const record = asRecord(classifieds);
    if (record) {
      return Object.values(record).filter(
        (entry): entry is Record<string, unknown> => !!asRecord(entry),
      );
    }
  } catch {
    return [];
  }
  return [];
}

export function parseImmoweltSearch(html: string): ImmoweltSearchRef[] {
  const seen = new Set<string>();
  const refs: ImmoweltSearchRef[] = [];
  for (const card of parseImmoweltSearchCards(html)) {
    try {
      const parsed = parseImmoweltCard(card);
      if (seen.has(parsed.sourceId)) continue;
      seen.add(parsed.sourceId);
      refs.push({ sourceId: parsed.sourceId, url: parsed.url });
    } catch {
      // skip malformed card
    }
  }
  if (refs.length === 0) {
    for (const match of html.matchAll(EXPOSE_UUID_RE)) {
      const sourceId = match[1];
      if (!sourceId || seen.has(sourceId)) continue;
      seen.add(sourceId);
      refs.push({ sourceId, url: immoweltExposeUrl(sourceId) });
    }
  }
  return refs;
}

function factValue(facts: unknown, type: string): string | undefined {
  if (!Array.isArray(facts)) return undefined;
  for (const entry of facts) {
    const record = asRecord(entry);
    if (asString(record?.type) === type) {
      return asString(record?.splitValue) ?? asString(record?.value);
    }
  }
  return undefined;
}

export function parseImmoweltCard(card: Record<string, unknown>): ImmoweltRawListing {
  const meta = asRecord(card.metadata);
  const tracking = asRecord(card.tracking);
  const legacyId =
    asString(meta?.legacyId) ??
    asString(tracking?.legacy_id) ??
    immoweltSourceIdFromUrl(asString(card.url) ?? '');
  if (!legacyId) throw new Error('immowelt: card missing legacyId / expose uuid');

  const location = asRecord(card.location);
  const addressNode = asRecord(location?.address) ?? {};
  const hardFacts = asRecord(card.hardFacts) ?? {};
  const priceNode = asRecord(hardFacts.price);
  const price =
    asNumber(tracking?.price) ??
    parseEuroAmount(asString(priceNode?.ariaLabel)) ??
    parseEuroAmount(asString(priceNode?.formatted)) ??
    parseEuroAmount(asString(priceNode?.value));

  const distribution = asString(tracking?.distribution_type);
  const operation: 'rent' | 'sale' =
    distribution === '2' || /kauf|sale|buy/i.test(asString(card.url) ?? '') ? 'sale' : 'rent';

  const gallery = asRecord(card.gallery);
  const images: string[] = [];
  if (Array.isArray(gallery?.images)) {
    for (const image of gallery.images) {
      const url = asString(asRecord(image)?.url);
      if (url) images.push(url);
    }
  }

  return {
    sourceId: legacyId,
    onlineId: asString(card.id) ?? asString(meta?.id),
    url: immoweltExposeUrl(legacyId),
    title: asString(hardFacts.title),
    description: asString(card.mainDescription) ?? asString(hardFacts.title),
    operation,
    propertyType: asString(card.type) ?? asString(tracking?.estate_type) ?? 'APARTMENT',
    price,
    currency: asString(tracking?.currency) ?? 'EUR',
    bedrooms: asNumber(factValue(hardFacts.facts, 'numberOfRooms')),
    squareMeters: asNumber(factValue(hardFacts.facts, 'livingSpace')),
    floor: asNumber(factValue(hardFacts.facts, 'numberOfFloors')),
    address: {
      street: asString(addressNode.street),
      city: asString(addressNode.city) ?? asString(tracking?.city),
      postalCode: asString(addressNode.zipCode) ?? asString(tracking?.zip_code),
      neighborhood: asString(addressNode.district),
      countryCode: 'DE',
    },
    images,
    contact: contactFromAdvertiser(card.provider ?? card.contact),
  };
}

export function parseImmoweltDetail(htmlOrJson: string, url: string): ImmoweltRawListing {
  const trimmed = htmlOrJson.trim();
  if (trimmed.startsWith('{')) {
    const card = asRecord(JSON.parse(trimmed) as unknown);
    if (!card) throw new Error('immowelt: detail JSON is not an object');
    return parseImmoweltCard(card);
  }
  const sourceId = immoweltSourceIdFromUrl(url);
  const cards = parseImmoweltSearchCards(htmlOrJson);
  if (sourceId) {
    for (const card of cards) {
      try {
        const parsed = parseImmoweltCard(card);
        if (parsed.sourceId === sourceId) return parsed;
      } catch {
        // skip
      }
    }
  }
  if (cards[0]) return parseImmoweltCard(cards[0]);
  throw new Error(`immowelt: no classified JSON for ${url}`);
}
