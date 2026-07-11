/**
 * Immowelt JSON parsing — shared html/contact; no duplicated blob extractor.
 *
 * SERP: LZ-decompress `classified-serp-init-data` cards.
 * Detail (`/expose/{uuid}`): the listing lives in the SSR micro-frontend blob
 * `window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse("…")` under
 * `app_cldp.data.classified` — a `sections.{location,price,hardFacts,gallery,…}`
 * shape distinct from the SERP card. Detail pages carry NO
 * `classified-serp-init-data` blob, which is why the old detail parser (which
 * only looked for that) failed every fetch with "no classified JSON".
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
import { asCoordinate } from '../../../parse/guards';
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
    /** State / region name (detail `tracking.av_items[].region`). */
    state?: string;
    countryCode?: string;
    /** Exact point coords, only when the detail geometry is a `Point`. */
    coordinates?: { lat: number; lng: number };
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

/** Micro-frontend SSR key holding the detail `classified` payload. */
const IMMOWELT_LIFECYCLE_KEY = '__UFRN_LIFECYCLE_SERVERREQUEST__';

/**
 * Extract the SSR `classified` object from a detail page's
 * `window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse("…")` blob. The
 * `JSON.parse` argument is itself a JSON string (double-encoded), so decode
 * twice: unescape the JS string literal, then parse the JSON it contains. The
 * app key is `app_cldp` (classified-detail-page) but any `*.data.classified`
 * entry is accepted so a portal rename of the app id degrades gracefully.
 */
export function parseImmoweltLifecycleClassified(
  html: string,
): Record<string, unknown> | undefined {
  const blob = extractJsonParseBlob(html, IMMOWELT_LIFECYCLE_KEY);
  if (!blob) return undefined;
  try {
    const outerString = JSON.parse(`"${blob}"`) as string;
    const root = asRecord(JSON.parse(outerString) as unknown);
    if (!root) return undefined;
    for (const app of Object.values(root)) {
      const classified = asRecord(asRecord(asRecord(app)?.data)?.classified);
      if (classified) return classified;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** First record entry of `classified.tracking.av_items`. */
function detailAvItem(classified: Record<string, unknown>): Record<string, unknown> | undefined {
  const items = asRecord(classified.tracking)?.av_items;
  if (!Array.isArray(items)) return undefined;
  for (const item of items) {
    const record = asRecord(item);
    if (record) return record;
  }
  return undefined;
}

/** Exact coords only when the geometry is a GeoJSON `Point` (`[lng, lat]`). */
function detailCoordinates(
  location: Record<string, unknown> | undefined,
): { lat: number; lng: number } | undefined {
  const geometry = asRecord(location?.geometry);
  if (asString(geometry?.type) !== 'Point') return undefined;
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return undefined;
  const lng = asCoordinate(coords[0]);
  const lat = asCoordinate(coords[1]);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

/** Map the detail `contactSections` block via the shared contact chokepoint. */
function detailContact(
  contactSections: Record<string, unknown> | undefined,
): NormalizedListingContact | undefined {
  if (!contactSections) return undefined;
  const provider = asRecord(contactSections.provider);
  const contactCard = asRecord(contactSections.contactCard);
  const staticNode = asRecord(contactSections.static);
  return contactFromAdvertiser({
    intermediaryCard: provider?.intermediaryCard,
    contactCard: provider?.contactCard ?? contactCard,
    phoneNumbers: staticNode?.phoneNumbers ?? contactCard?.phoneNumbers,
    isPrivateOwner: provider?.isPrivateOwner ?? contactCard?.isPrivateOwner,
    publisherType: provider?.publisherType,
  });
}

/**
 * Map a detail-page `classified` object (from the SSR lifecycle blob) to the
 * common {@link ImmoweltRawListing}. Price comes from the numeric
 * `tracking.av_items[].price` first (already parsed by immowelt), falling back
 * to the formatted `sections.price`/`sections.hardFacts` labels.
 */
export function parseImmoweltDetailClassified(
  classified: Record<string, unknown>,
  url: string,
): ImmoweltRawListing {
  const metadata = asRecord(classified.metadata);
  const item = detailAvItem(classified);
  const legacyId =
    asString(metadata?.legacyId) ??
    asString(item?.legacy_id) ??
    immoweltSourceIdFromUrl(url);
  if (!legacyId) throw new Error('immowelt: detail classified missing legacyId / expose uuid');

  const sections = asRecord(classified.sections);
  const location = asRecord(sections?.location);
  const addressNode = asRecord(location?.address) ?? {};
  const hardFacts = asRecord(sections?.hardFacts) ?? {};
  const gallery = asRecord(sections?.gallery);
  const priceBase = asRecord(asRecord(sections?.price)?.base);
  const priceMain = asRecord(asRecord(asRecord(priceBase?.main)?.value)?.main);
  const mainDescription = asRecord(sections?.mainDescription);

  const price =
    asNumber(item?.price) ??
    parseEuroAmount(asString(priceMain?.ariaLabel)) ??
    parseEuroAmount(asString(priceMain?.value)) ??
    parseEuroAmount(asString(asRecord(hardFacts.price)?.ariaLabel)) ??
    parseEuroAmount(asString(asRecord(hardFacts.price)?.formatted));

  const distribution = asString(item?.distribution_type);
  const priceType = asString(priceBase?.type)?.toUpperCase();
  const operation: 'rent' | 'sale' =
    distribution === '2' || priceType === 'SALE' ? 'sale' : 'rent';

  const images: string[] = [];
  if (Array.isArray(gallery?.images)) {
    for (const image of gallery.images) {
      const imageUrl = asString(asRecord(image)?.url);
      if (imageUrl) images.push(imageUrl);
    }
  }

  const headline = asString(mainDescription?.headline) ?? asString(hardFacts.title);

  return {
    sourceId: legacyId,
    onlineId: asString(classified.id) ?? asString(item?.id),
    url: immoweltExposeUrl(legacyId),
    title: headline,
    description: asString(mainDescription?.description) ?? headline,
    operation,
    propertyType: asString(hardFacts.title) ?? asString(item?.estate_type) ?? 'APARTMENT',
    price,
    currency: asString(item?.currency) ?? 'EUR',
    bedrooms: asNumber(factValue(hardFacts.facts, 'numberOfRooms')),
    squareMeters: asNumber(factValue(hardFacts.facts, 'livingSpace')),
    floor: asNumber(factValue(hardFacts.facts, 'numberOfFloors')),
    address: {
      street: asString(addressNode.street),
      city: asString(addressNode.city) ?? asString(item?.city),
      postalCode: asString(addressNode.zipCode) ?? asString(item?.zip_code),
      neighborhood: asString(addressNode.district),
      state: asString(item?.region),
      countryCode: 'DE',
      coordinates: detailCoordinates(location),
    },
    images,
    contact: detailContact(asRecord(classified.contactSections)),
  };
}

export function parseImmoweltDetail(htmlOrJson: string, url: string): ImmoweltRawListing {
  const trimmed = htmlOrJson.trim();
  if (trimmed.startsWith('{')) {
    const parsed = asRecord(JSON.parse(trimmed) as unknown);
    if (!parsed) throw new Error('immowelt: detail JSON is not an object');
    // A detail `classified` carries `sections`/`contactSections`; a SERP card does not.
    if (asRecord(parsed.sections) || asRecord(parsed.contactSections)) {
      return parseImmoweltDetailClassified(parsed, url);
    }
    return parseImmoweltCard(parsed);
  }

  // Current detail structure (2025+): the SSR lifecycle blob.
  const classified = parseImmoweltLifecycleClassified(htmlOrJson);
  if (classified) return parseImmoweltDetailClassified(classified, url);

  // Fallback: a SERP-shaped HTML snapshot with `classified-serp-init-data`.
  const sourceId = immoweltSourceIdFromUrl(url);
  const cards = parseImmoweltSearchCards(htmlOrJson);
  if (sourceId) {
    for (const card of cards) {
      try {
        const parsed = parseImmoweltCard(card);
        if (parsed.sourceId === sourceId) return parsed;
      } catch {
        // skip malformed card
      }
    }
  }
  if (cards[0]) return parseImmoweltCard(cards[0]);
  throw new Error(
    `immowelt: no detail JSON (__UFRN_LIFECYCLE_SERVERREQUEST__ / classified-serp-init-data) on ${url}`,
  );
}
