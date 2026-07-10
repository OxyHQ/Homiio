/**
 * Immowelt JSON parsing (pure).
 *
 * Prefer decompressed `classified-serp-init-data` (LZ-string) from the search
 * HTML — that blob is already structured JSON. Fall back to `/expose/{uuid}`
 * link scraping when decompression fails. Contact is taken from `provider` /
 * `contact` card fields when present.
 */

import { decompressFromBase64 } from 'lz-string';
import type { NormalizedListingContact } from '@homiio/shared-types';
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    if (!normalized) return undefined;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseEuro(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.replace(/\u00a0/g, ' ').match(/([\d.]+(?:,\d+)?)/);
  if (!match?.[1]) return undefined;
  const raw = match[1];
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/\./g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Immowelt rental apartment search URL for a city (+ optional page). */
export function immoweltSearchUrl(city: string, page = 1): string {
  const slug = citySlug(city);
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

/** DataDome / empty challenge markers on Immowelt HTML or AJAX bodies. */
export function isImmoweltChallenge(body: string): boolean {
  if (body.trim().length < 512) return true;
  return /captcha-delivery|datadome|geo\.captcha|access denied|ich bin kein roboter/i.test(body);
}

function extractJsonParseBlob(html: string): string | undefined {
  const marker = 'classified-serp-init-data';
  const idx = html.indexOf(marker);
  if (idx < 0) return undefined;
  const scriptStart = html.lastIndexOf('<script', idx);
  const scriptEnd = html.indexOf('</script>', idx);
  if (scriptStart < 0 || scriptEnd < 0) return undefined;
  const script = html.slice(scriptStart, scriptEnd);
  const start = script.indexOf('JSON.parse("');
  const end = script.lastIndexOf('")');
  if (start < 0 || end <= start) return undefined;
  return script.slice(start + 'JSON.parse("'.length, end);
}

/**
 * Decompress Immowelt SERP init data from search HTML. Returns the classified
 * card objects (values of `classifiedsData`) or an empty array.
 */
export function parseImmoweltSearchCards(html: string): Record<string, unknown>[] {
  const blob = extractJsonParseBlob(html);
  if (!blob) return [];
  try {
    const outerString = JSON.parse(`"${blob}"`) as string;
    const outer = JSON.parse(outerString) as unknown;
    const outerRecord = asRecord(outer);
    const compressed =
      asString(asRecord(outerRecord?.data)?.['classified-serp-init-data']) ??
      asString(outerRecord?.compressed);
    if (!compressed) return [];
    const decompressed = decompressFromBase64(compressed);
    if (!decompressed) return [];
    const data = JSON.parse(decompressed) as unknown;
    const root = asRecord(data);
    const pageProps = asRecord(root?.pageProps) ?? root;
    const classifieds = asRecord(pageProps?.classifiedsData) ?? pageProps?.classifiedsData;
    if (Array.isArray(classifieds)) {
      return classifieds.filter((entry): entry is Record<string, unknown> => !!asRecord(entry));
    }
    if (asRecord(classifieds)) {
      return Object.values(classifieds as Record<string, unknown>).filter(
        (entry): entry is Record<string, unknown> => !!asRecord(entry),
      );
    }
  } catch {
    return [];
  }
  return [];
}

/** Parse search HTML into expose refs (LZ cards preferred, UUID links fallback). */
export function parseImmoweltSearch(html: string): ImmoweltSearchRef[] {
  const seen = new Set<string>();
  const refs: ImmoweltSearchRef[] = [];

  for (const card of parseImmoweltSearchCards(html)) {
    const meta = asRecord(card.metadata);
    const legacyId =
      asString(meta?.legacyId) ??
      asString(asRecord(card.tracking)?.legacy_id) ??
      immoweltSourceIdFromUrl(asString(card.url) ?? '');
    if (!legacyId || seen.has(legacyId)) continue;
    seen.add(legacyId);
    refs.push({ sourceId: legacyId, url: immoweltExposeUrl(legacyId) });
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

function extractContact(provider: unknown): NormalizedListingContact | undefined {
  const record = asRecord(provider);
  if (!record) return undefined;

  const phones: string[] = [];
  const phoneNumbers = record.phoneNumbers;
  if (Array.isArray(phoneNumbers)) {
    for (const entry of phoneNumbers) {
      const raw = typeof entry === 'string' ? entry : asString(asRecord(entry)?.phoneNumber);
      if (!raw) continue;
      const cleaned = raw.replace(/[^\d+]/g, '');
      if (cleaned.replace(/\D/g, '').length >= 7) phones.push(cleaned);
    }
  }

  const intermediary = asRecord(record.intermediaryCard);
  const contactCard = asRecord(record.contactCard);
  const agencyName =
    asString(intermediary?.title) ??
    asString(contactCard?.title) ??
    asString(record.agencyName);
  const email = asString(record.email) ?? asString(record.contactEmail);
  const whatsappRaw = asString(record.whatsapp) ?? asString(record.whatsApp);
  const whatsapp = whatsappRaw?.match(/(\d{7,15})/)?.[1];

  const out: NormalizedListingContact = {};
  if (phones[0]) out.phone = phones[0];
  if (email) out.email = email;
  if (whatsapp) out.whatsapp = whatsapp;
  if (agencyName) out.agencyName = agencyName;
  if (record.isPrivateOwner === true) out.kind = 'private';
  else if (asString(record.publisherType) === 'AGENCY' || agencyName) out.kind = 'agency';

  return out.phone || out.email || out.whatsapp || out.agencyName ? out : undefined;
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

/** Map one Immowelt classified card (or detail-equivalent) to {@link ImmoweltRawListing}. */
export function parseImmoweltCard(card: Record<string, unknown>): ImmoweltRawListing {
  const meta = asRecord(card.metadata);
  const tracking = asRecord(card.tracking);
  const legacyId =
    asString(meta?.legacyId) ??
    asString(tracking?.legacy_id) ??
    immoweltSourceIdFromUrl(asString(card.url) ?? '');
  if (!legacyId) {
    throw new Error('immowelt: card missing legacyId / expose uuid');
  }

  const location = asRecord(card.location);
  const addressNode = asRecord(location?.address) ?? {};
  const hardFacts = asRecord(card.hardFacts) ?? {};
  const priceNode = asRecord(hardFacts.price);
  const price =
    asNumber(tracking?.price) ??
    parseEuro(asString(priceNode?.ariaLabel)) ??
    parseEuro(asString(priceNode?.formatted)) ??
    parseEuro(asString(priceNode?.value));

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

  const rooms = asNumber(factValue(hardFacts.facts, 'numberOfRooms'));
  const area = asNumber(factValue(hardFacts.facts, 'livingSpace'));
  const floor = asNumber(factValue(hardFacts.facts, 'numberOfFloors'));

  const propertyTypeRaw = asString(card.type) ?? asString(tracking?.estate_type) ?? 'APARTMENT';

  return {
    sourceId: legacyId,
    onlineId: asString(card.id) ?? asString(meta?.id),
    url: immoweltExposeUrl(legacyId),
    title: asString(hardFacts.title),
    description: asString(card.mainDescription) ?? asString(hardFacts.title),
    operation,
    propertyType: propertyTypeRaw,
    price,
    currency: asString(tracking?.currency) ?? 'EUR',
    bedrooms: rooms,
    squareMeters: area,
    floor,
    address: {
      street: asString(addressNode.street),
      city: asString(addressNode.city) ?? asString(tracking?.city),
      postalCode: asString(addressNode.zipCode) ?? asString(tracking?.zip_code),
      neighborhood: asString(addressNode.district),
      countryCode: 'DE',
    },
    images,
    contact: extractContact(card.provider ?? card.contact),
  };
}

/**
 * Parse a detail/search card JSON string, or find the matching card in search
 * HTML by legacy id.
 */
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
      const meta = asRecord(card.metadata);
      const legacy =
        asString(meta?.legacyId) ?? asString(asRecord(card.tracking)?.legacy_id);
      if (legacy === sourceId) return parseImmoweltCard(card);
    }
  }
  if (cards[0]) return parseImmoweltCard(cards[0]);

  // Last resort: expose page may only carry the UUID link — insufficient alone.
  if (sourceId) {
    throw new Error(`immowelt: no classified JSON for expose ${sourceId}`);
  }
  throw new Error(`immowelt: cannot parse detail at ${url}`);
}
