/**
 * Immoweb.be JSON parsers (pure, DOM-free).
 *
 * Discover uses GET `/en/search-results`; detail uses GET `/en/classified/get-result/{id}`.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../contact';
import { asNumber, asString, isRecord } from '../../../parse/guards';
import { citySlug } from '../../../slug';
import { IMMOWEB_BASE_URL, IMMOWEB_PROVINCE_BY_CITY } from './fixtures';

export interface ImmowebSearchRef {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
}

export interface ImmowebRawListing {
  sourceId: string;
  url: string;
  title: string;
  description?: string;
  kind: 'rent' | 'sale';
  price: number;
  currency: string;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  propertyType?: string;
  address: {
    street?: string;
    city: string;
    state?: string;
    postalCode?: string;
    countryCode: string;
  };
  coordinates?: { lat: number; lng: number };
  images: string[];
  contact?: NormalizedListingContact;
}

function kindFromTransaction(raw: unknown): 'rent' | 'sale' {
  const type = asString(isRecord(raw) ? raw.type : raw)?.toUpperCase() ?? '';
  return type.includes('SALE') ? 'sale' : 'rent';
}

function priceFromNode(price: unknown, rental: unknown, kind: 'rent' | 'sale'): number | undefined {
  if (isRecord(price)) {
    const main = asNumber(price.mainValue) ?? asNumber(price.value);
    if (main !== undefined && main > 0) return main;
  }
  if (kind === 'rent' && isRecord(rental)) {
    const monthly = asNumber(rental.monthlyRentalPrice);
    if (monthly !== undefined && monthly > 0) return monthly;
  }
  return undefined;
}

function streetFromLocation(location: Record<string, unknown>): string | undefined {
  const street = asString(location.street);
  const number = asString(location.number);
  if (street && number) return `${street} ${number}`;
  return street;
}

function classifiedUrl(
  id: string,
  property: Record<string, unknown> | undefined,
  transaction: Record<string, unknown> | undefined,
): string {
  const type = asString(property?.type)?.toLowerCase() ?? 'apartment';
  const tx = kindFromTransaction(transaction) === 'sale' ? 'for-sale' : 'for-rent';
  const locality = citySlug(asString(property?.location && isRecord(property.location) ? property.location.locality : undefined) ?? 'belgium');
  const postal = asString(
    property?.location && isRecord(property.location) ? property.location.postalCode : undefined,
  );
  if (postal) {
    return `${IMMOWEB_BASE_URL}/en/classified/${type}/${tx}/${locality}/${postal}/${id}`;
  }
  return `${IMMOWEB_BASE_URL}/en/classified/${id}`;
}

function collectImages(media: unknown): string[] {
  if (!isRecord(media) || !Array.isArray(media.pictures)) return [];
  const out: string[] = [];
  for (const picture of media.pictures) {
    if (!isRecord(picture)) continue;
    const url =
      asString(picture.extralargeUrl) ??
      asString(picture.largeUrl) ??
      asString(picture.mediumUrl);
    if (url) out.push(url);
  }
  return [...new Set(out)];
}

function contactFromCustomers(customers: unknown): NormalizedListingContact | undefined {
  if (!Array.isArray(customers)) return undefined;
  for (const entry of customers) {
    if (!isRecord(entry)) continue;
    const name = asString(entry.name);
    const phone = asString(entry.phoneNumber) ?? asString(entry.mobileNumber);
    const email = asString(entry.email);
    const type = asString(entry.type)?.toLowerCase();
    const contact = buildContact({
      name,
      agencyName: type === 'agency' ? name : undefined,
      phone,
      email,
      kind: type === 'agency' ? 'agency' : type === 'owner' ? 'owner' : undefined,
    });
    if (contact) return contact;
  }
  return undefined;
}

function parseResultNode(node: Record<string, unknown>): ImmowebRawListing | undefined {
  const sourceId = asString(node.id) ?? (typeof node.id === 'number' ? String(node.id) : undefined);
  if (!sourceId) return undefined;

  const property = isRecord(node.property) ? node.property : undefined;
  const transaction = isRecord(node.transaction) ? node.transaction : undefined;
  const kind = kindFromTransaction(transaction);
  const price = priceFromNode(node.price, transaction?.rental, kind);
  if (price === undefined) return undefined;

  const location = property && isRecord(property.location) ? property.location : undefined;
  const city = asString(location?.locality) ?? asString(location?.province) ?? 'Belgium';
  const title = asString(property?.title) ?? `Listing ${sourceId}`;

  const result: ImmowebRawListing = {
    sourceId,
    url: classifiedUrl(sourceId, property, transaction),
    title,
    kind,
    price,
    currency: 'EUR',
    address: {
      street: location ? streetFromLocation(location) : title,
      city,
      state: asString(location?.province) ?? asString(location?.region),
      postalCode: asString(location?.postalCode),
      countryCode: 'BE',
    },
    images: collectImages(node.media),
  };

  const lat = location ? asNumber(location.latitude) : undefined;
  const lng = location ? asNumber(location.longitude) : undefined;
  if (lat !== undefined && lng !== undefined) result.coordinates = { lat, lng };
  const bedrooms = property ? asNumber(property.bedroomCount) : undefined;
  if (bedrooms !== undefined) result.bedrooms = bedrooms;
  const propertyType = property ? asString(property.type) : undefined;
  if (propertyType) result.propertyType = propertyType;
  const agencyName = asString(node.customerName);
  if (agencyName) {
    result.contact = buildContact({ agencyName, kind: 'agency' });
  }

  return result;
}

function parseClassified(classified: Record<string, unknown>): ImmowebRawListing | undefined {
  const sourceId =
    asString(classified.id) ?? (typeof classified.id === 'number' ? String(classified.id) : undefined);
  if (!sourceId) return undefined;

  const property = isRecord(classified.property) ? classified.property : undefined;
  const transaction = isRecord(classified.transaction) ? classified.transaction : undefined;
  const kind = kindFromTransaction(transaction);
  const price = priceFromNode(classified.price, transaction?.rental, kind);
  if (price === undefined) return undefined;

  const location = property && isRecord(property.location) ? property.location : undefined;
  const city = asString(location?.locality) ?? 'Belgium';
  const title = asString(property?.title) ?? `Listing ${sourceId}`;

  const result: ImmowebRawListing = {
    sourceId,
    url: classifiedUrl(sourceId, property, transaction),
    title,
    kind,
    price,
    currency: 'EUR',
    address: {
      street: location ? streetFromLocation(location) : title,
      city,
      state: asString(location?.province),
      postalCode: asString(location?.postalCode),
      countryCode: 'BE',
    },
    images: collectImages(classified.media),
  };

  const description = asString(property?.description);
  if (description) result.description = description;
  const bedrooms = property ? asNumber(property.bedroomCount) : undefined;
  if (bedrooms !== undefined) result.bedrooms = bedrooms;
  const squareMeters = property ? asNumber(property.netHabitableSurface) : undefined;
  if (squareMeters !== undefined) result.squareMeters = squareMeters;
  const lat = location ? asNumber(location.latitude) : undefined;
  const lng = location ? asNumber(location.longitude) : undefined;
  if (lat !== undefined && lng !== undefined) result.coordinates = { lat, lng };
  const contact = contactFromCustomers(classified.customers);
  if (contact) result.contact = contact;

  return result;
}

export function immowebProvinceForCity(city: string): string | undefined {
  return IMMOWEB_PROVINCE_BY_CITY[citySlug(city)];
}

export function immowebSearchUrl(
  city: string,
  kind: 'rent' | 'sale',
  page = 1,
): string {
  const province = immowebProvinceForCity(city);
  const params = new URLSearchParams({
    countries: 'BE',
    propertyTypes: 'APARTMENT,HOUSE',
    transactionTypes: kind === 'sale' ? 'FOR_SALE' : 'FOR_RENT',
    page: String(page),
  });
  if (province) params.set('provinces', province);
  return `${IMMOWEB_BASE_URL}/en/search-results?${params.toString()}`;
}

export function immowebDetailUrl(sourceId: string): string {
  return `${IMMOWEB_BASE_URL}/en/classified/get-result/${sourceId}`;
}

export function parseImmowebSearch(body: string): ImmowebSearchRef[] {
  let root: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body.trim());
    if (!isRecord(parsed)) return [];
    root = parsed;
  } catch {
    return [];
  }
  const results = Array.isArray(root.results) ? root.results : [];
  const out = new Map<string, ImmowebSearchRef>();
  for (const entry of results) {
    if (!isRecord(entry)) continue;
    const listing = parseResultNode(entry);
    if (!listing) continue;
    out.set(listing.sourceId, {
      sourceId: listing.sourceId,
      url: listing.url,
      kind: listing.kind,
    });
  }
  return [...out.values()];
}

export function parseImmowebDetail(body: string, sourceId: string): ImmowebRawListing {
  let root: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body.trim());
    if (!isRecord(parsed)) {
      throw new Error('immoweb: detail JSON is not an object');
    }
    root = parsed;
  } catch (error) {
    throw new Error(
      `immoweb: invalid detail JSON for ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const classified = isRecord(root.classified) ? root.classified : root;
  const listing = parseClassified(classified);
  if (!listing) {
    throw new Error(`immoweb: could not parse classified ${sourceId}`);
  }
  return listing;
}

export function isImmowebChallenge(body: string): boolean {
  if (body.trim().length < 32) return true;
  return /captcha|access denied|just a moment|<html/i.test(body) && !body.includes('"results"');
}

export function immowebSourceIdFromUrl(url: string): string | undefined {
  const match = /\/(\d{5,})(?:\/|$|\?)/.exec(url);
  return match?.[1];
}
