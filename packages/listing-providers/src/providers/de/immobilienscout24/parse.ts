/**
 * ImmobilienScout24 mobile-API parsing (pure).
 *
 * Discover uses POST `/search/list`; fetch uses GET `/expose/{id}`. Both return
 * JSON — no HTML. Contact (phone / agency) is best-effort from the expose
 * `contact` block.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import {
  IMMOBILIENSCOUT24_BASE_URL,
  IMMOBILIENSCOUT24_MOBILE_API,
} from './fixtures';

export interface Is24SearchRef {
  sourceId: string;
  url: string;
  title?: string;
  realEstateType?: string;
}

export interface Is24RawListing {
  sourceId: string;
  url: string;
  title?: string;
  description?: string;
  realEstateType?: string;
  operation: 'rent' | 'sale';
  price?: number;
  currency: string;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  floor?: number;
  address: {
    street?: string;
    city?: string;
    postalCode?: string;
    neighborhood?: string;
    region?: string;
    lat?: number;
    lng?: number;
  };
  images: string[];
  contact?: NormalizedListingContact;
}

const CITY_GEOCODES: Readonly<Record<string, string>> = {
  berlin: '/de/berlin/berlin',
  hamburg: '/de/hamburg/hamburg',
  muenchen: '/de/bayern/muenchen',
  munich: '/de/bayern/muenchen',
  koeln: '/de/nordrhein-westfalen/koeln',
  cologne: '/de/nordrhein-westfalen/koeln',
  frankfurt: '/de/hessen/frankfurt-am-main',
  stuttgart: '/de/baden-wuerttemberg/stuttgart',
  duesseldorf: '/de/nordrhein-westfalen/duesseldorf',
  dusseldorf: '/de/nordrhein-westfalen/duesseldorf',
  leipzig: '/de/sachsen/leipzig',
  dortmund: '/de/nordrhein-westfalen/dortmund',
};

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
    const cleaned = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    if (!cleaned) return undefined;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseEuroAmount(text: string | undefined): number | undefined {
  if (!text) return undefined;
  // German: "1.250 €" or "1.250,50 €"
  const match = text.replace(/\u00a0/g, ' ').match(/([\d.]+(?:,\d+)?)\s*€/);
  if (!match?.[1]) return undefined;
  const normalized = match[1].includes(',')
    ? match[1].replace(/\./g, '').replace(',', '.')
    : match[1].replace(/\./g, '');
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

/** Resolve mobile geocode path for a city name. */
export function is24Geocode(city: string): string {
  const slug = citySlug(city);
  return CITY_GEOCODES[slug] ?? `/de/${slug}/${slug}`;
}

/** Build the mobile search-list URL (query string; body is separate). */
export function is24SearchListUrl(city: string, page = 1, operation: 'rent' | 'sale' = 'rent'): string {
  const realEstateType = operation === 'sale' ? 'apartmentbuy' : 'apartmentrent';
  const geocodes = encodeURIComponent(is24Geocode(city));
  return `${IMMOBILIENSCOUT24_MOBILE_API}/search/list?pricetype=calculatedtotalrent&realestatetype=${realEstateType}&searchType=region&geocodes=${geocodes}&pagenumber=${page}`;
}

/** Build the mobile expose URL. */
export function is24ExposeUrl(sourceId: string): string {
  return `${IMMOBILIENSCOUT24_MOBILE_API}/expose/${sourceId}`;
}

/** Canonical public listing URL. */
export function is24PublicUrl(sourceId: string): string {
  return `${IMMOBILIENSCOUT24_BASE_URL}/expose/${sourceId}`;
}

export function is24SourceIdFromUrl(url: string): string | undefined {
  return url.match(/\/expose\/(\d+)/)?.[1];
}

function operationFromType(realEstateType: string | undefined): 'rent' | 'sale' {
  if (!realEstateType) return 'rent';
  return /buy|sale|kauf/i.test(realEstateType) ? 'sale' : 'rent';
}

/** Parse mobile search-list JSON into de-duplicated refs. */
export function parseIs24Search(body: string): Is24SearchRef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return [];
  }
  const root = asRecord(parsed);
  const items = root?.resultListItems;
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const refs: Is24SearchRef[] = [];
  for (const entry of items) {
    const wrapper = asRecord(entry);
    if (!wrapper || wrapper.type !== 'EXPOSE_RESULT') continue;
    const item = asRecord(wrapper.item);
    const sourceId = asString(item?.id);
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    refs.push({
      sourceId,
      url: is24PublicUrl(sourceId),
      title: asString(item?.title),
      realEstateType: asString(item?.realEstateType),
    });
  }
  return refs;
}

function attrMap(attributes: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(attributes)) return out;
  for (const entry of attributes) {
    const record = asRecord(entry);
    if (!record) continue;
    const label = asString(record.label)?.toLowerCase();
    const text = asString(record.text) ?? asString(record.value);
    if (label && text) out.set(label, text);
  }
  return out;
}

function parseAddressLines(line1: string | undefined, line2: string | undefined): Is24RawListing['address'] {
  const address: Is24RawListing['address'] = {};
  if (line1) address.street = line1;
  if (!line2) return address;
  // IS24 mobile: "13437 Wittenau, Berlin" → postal + neighborhood, city
  const postal = line2.match(/^(\d{5})\s+(.+)$/);
  if (postal) {
    address.postalCode = postal[1];
    const rest = postal[2] ?? '';
    const parts = rest.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      address.neighborhood = parts[0];
      address.city = parts[parts.length - 1];
    } else if (parts.length === 1) {
      address.city = parts[0];
    }
  } else {
    address.city = line2;
  }
  return address;
}

function extractContact(contactBlock: unknown): NormalizedListingContact | undefined {
  const contact = asRecord(contactBlock);
  if (!contact) return undefined;

  const phones: string[] = [];
  const phoneNumbers = contact.phoneNumbers;
  if (Array.isArray(phoneNumbers)) {
    for (const entry of phoneNumbers) {
      if (typeof entry === 'string') {
        const cleaned = entry.replace(/[^\d+]/g, '');
        if (cleaned.replace(/\D/g, '').length >= 7) phones.push(cleaned);
      } else {
        const record = asRecord(entry);
        const raw = asString(record?.phoneNumber) ?? asString(record?.number);
        if (raw) {
          const cleaned = raw.replace(/[^\d+]/g, '');
          if (cleaned.replace(/\D/g, '').length >= 7) phones.push(cleaned);
        }
      }
    }
  }

  const data = asRecord(contact.contactData);
  const agent = asRecord(data?.agent);
  const agencyName =
    asString(agent?.company) ?? asString(agent?.name) ?? asString(contact.companyName);
  const email = asString(contact.email) ?? asString(data?.email);
  const whatsappRaw = asString(contact.whatsapp) ?? asString(contact.whatsApp);
  const whatsapp = whatsappRaw
    ? whatsappRaw.match(/(\d{7,15})/)?.[1] ?? whatsappRaw.replace(/[^\d+]/g, '')
    : undefined;

  const out: NormalizedListingContact = {};
  if (phones[0]) out.phone = phones[0];
  if (email) out.email = email;
  if (whatsapp) out.whatsapp = whatsapp;
  if (agencyName) out.agencyName = agencyName;
  out.kind = asString(agent?.company) ? 'agency' : phones[0] || agencyName ? 'unknown' : undefined;

  return out.phone || out.email || out.whatsapp || out.agencyName ? out : undefined;
}

/** Parse mobile expose JSON into {@link Is24RawListing}. */
export function parseIs24Expose(body: string, fallbackUrl?: string): Is24RawListing {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error('immobilienscout24: expose body is not JSON');
  }
  const root = asRecord(parsed);
  if (!root) throw new Error('immobilienscout24: expose JSON root is not an object');

  const header = asRecord(root.header) ?? {};
  const sourceId = asString(header.id);
  if (!sourceId) throw new Error('immobilienscout24: expose missing header.id');

  const realEstateType = asString(header.realEstateType);
  const operation = operationFromType(realEstateType);
  const sections = Array.isArray(root.sections) ? root.sections : [];

  let title = asString(header.title);
  let description: string | undefined;
  let address: Is24RawListing['address'] = {};
  const images: string[] = [];
  let attrs = new Map<string, string>();

  for (const section of sections) {
    const record = asRecord(section);
    if (!record) continue;
    const type = asString(record.type);
    if (type === 'TITLE') {
      title = asString(record.title) ?? title;
    } else if (type === 'DESCRIPTION') {
      description = asString(record.text) ?? asString(record.description) ?? description;
    } else if (type === 'TOP_ATTRIBUTES' || type === 'ATTRIBUTES') {
      attrs = attrMap(record.attributes);
    } else if (type === 'MAP') {
      const loc = asRecord(record.location);
      address = {
        ...parseAddressLines(asString(record.addressLine1), asString(record.addressLine2)),
        lat: asNumber(loc?.lat),
        lng: asNumber(loc?.lng),
      };
    } else if (type === 'MEDIA') {
      const media = Array.isArray(record.media) ? record.media : [];
      for (const item of media) {
        const mediaRecord = asRecord(item);
        if (!mediaRecord || asString(mediaRecord.type) !== 'PICTURE') continue;
        const url =
          asString(mediaRecord.fullImageUrl) ??
          asString(mediaRecord.imageUrlForWeb) ??
          asString(mediaRecord.previewImageUrl);
        if (url) images.push(url.replace(/%WIDTH%x%HEIGHT%/g, '1500x1000'));
      }
    }
  }

  const price =
    parseEuroAmount(attrs.get('kaltmiete')) ??
    parseEuroAmount([...attrs.entries()].find(([key]) => key.includes('kaltmiete'))?.[1]) ??
    parseEuroAmount(attrs.get('kaufpreis')) ??
    parseEuroAmount([...attrs.values()].find((value) => value.includes('€')));

  const roomsText = attrs.get('zimmer');
  const areaText = attrs.get('wohnfläche') ?? attrs.get('wohnflaeche');
  const floorText = [...attrs.entries()].find(([key]) => key.includes('etage') || key.includes('geschoss'))?.[1];

  return {
    sourceId,
    url: fallbackUrl ?? is24PublicUrl(sourceId),
    title,
    description,
    realEstateType,
    operation,
    price,
    currency: 'EUR',
    bedrooms: asNumber(roomsText),
    squareMeters: asNumber(areaText?.replace(/\s*m²/i, '')),
    floor: asNumber(floorText),
    address,
    images,
    contact: extractContact(root.contact),
  };
}
