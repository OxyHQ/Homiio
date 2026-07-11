/**
 * ImmobilienScout24 mobile-API parsing — pure JSON.
 * Reuses shared contact/html helpers (no local phone/euro/slug duplicates).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromAdvertiser } from '../../../contact';
import { asNumber, asRecord, asString, citySlugDe, parseEuroAmount } from '../../../html';
import { IMMOBILIENSCOUT24_BASE_URL, IMMOBILIENSCOUT24_MOBILE_API } from './fixtures';

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

export function is24Geocode(city: string): string {
  const slug = citySlugDe(city);
  return CITY_GEOCODES[slug] ?? `/de/${slug}/${slug}`;
}

export function is24SearchListUrl(city: string, page = 1, operation: 'rent' | 'sale' = 'rent'): string {
  const realEstateType = operation === 'sale' ? 'apartmentbuy' : 'apartmentrent';
  const geocodes = encodeURIComponent(is24Geocode(city));
  return `${IMMOBILIENSCOUT24_MOBILE_API}/search/list?pricetype=calculatedtotalrent&realestatetype=${realEstateType}&searchType=region&geocodes=${geocodes}&pagenumber=${page}`;
}

export function is24ExposeUrl(sourceId: string): string {
  return `${IMMOBILIENSCOUT24_MOBILE_API}/expose/${sourceId}`;
}

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

export function parseIs24Search(body: string): Is24SearchRef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return [];
  }
  const items = asRecord(parsed)?.resultListItems;
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
  const postal = line2.match(/^(\d{5})\s+(.+)$/);
  if (postal) {
    address.postalCode = postal[1];
    const parts = (postal[2] ?? '').split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      address.neighborhood = parts[0];
      address.city = parts[parts.length - 1];
    } else if (parts[0]) {
      address.city = parts[0];
    }
  } else {
    address.city = line2;
  }
  return address;
}

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
    } else if (type === 'TEXT_AREA') {
      // The mobile expose splits free text into titled TEXT_AREA blocks
      // ('Objektbeschreibung', 'Lage', 'Sonstiges'). Only the object
      // description is a real listing description; keep the first one.
      if (description === undefined && asString(record.title)?.toLowerCase() === 'objektbeschreibung') {
        description = asString(record.text);
      }
    } else if (type === 'TOP_ATTRIBUTES' || type === 'ATTRIBUTES') {
      attrs = attrMap(record.attributes);
    } else if (type === 'MAP') {
      const loc = asRecord(record.location);
      address = {
        ...parseAddressLines(asString(record.addressLine1), asString(record.addressLine2)),
        lat: asNumber(loc?.lat),
        lng: asNumber(loc?.lng),
      };
    } else if (type === 'MEDIA' && Array.isArray(record.media)) {
      for (const item of record.media) {
        const media = asRecord(item);
        if (!media || asString(media.type) !== 'PICTURE') continue;
        const url =
          asString(media.fullImageUrl) ??
          asString(media.imageUrlForWeb) ??
          asString(media.previewImageUrl);
        if (url) images.push(url.replace(/%WIDTH%x%HEIGHT%/g, '1500x1000'));
      }
    }
  }

  const price =
    parseEuroAmount(attrs.get('kaltmiete')) ??
    parseEuroAmount([...attrs.entries()].find(([key]) => key.includes('kaltmiete'))?.[1]) ??
    parseEuroAmount(attrs.get('kaufpreis')) ??
    parseEuroAmount([...attrs.values()].find((value) => value.includes('€')));

  return {
    sourceId,
    url: fallbackUrl ?? is24PublicUrl(sourceId),
    title,
    description,
    realEstateType,
    operation,
    price,
    currency: 'EUR',
    bedrooms: asNumber(attrs.get('zimmer')),
    squareMeters: asNumber(attrs.get('wohnfläche')?.replace(/\s*m²/i, '') ?? attrs.get('wohnflaeche')),
    floor: asNumber(
      [...attrs.entries()].find(([key]) => key.includes('etage') || key.includes('geschoss'))?.[1],
    ),
    address,
    images,
    contact: contactFromAdvertiser(root.contact),
  };
}
