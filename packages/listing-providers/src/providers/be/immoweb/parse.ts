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
  yearBuilt?: number;
  amenities?: string[];
  hasElevator?: boolean;
  hasGarden?: boolean;
  hasBalcony?: boolean;
  parkingSpaces?: number;
  parkingType?: 'none' | 'street' | 'assigned' | 'garage';
  furnished?: boolean;
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

/**
 * Presence of a structured amenity (garden, terrace) from Immoweb's explicit
 * boolean flag, or — when the flag is absent — a positive surface measurement.
 * The boolean flag is authoritative when present (true or false).
 */
function featurePresent(flag: unknown, surface: unknown): boolean | undefined {
  if (typeof flag === 'boolean') return flag;
  const measured = asNumber(surface);
  if (measured !== undefined && measured > 0) return true;
  return undefined;
}

/**
 * Immoweb detail JSON exposes ~30 boolean amenity flags on `property.has*`.
 * Map the ones we recognize directly to the shared canonical amenity vocabulary
 * (`parse/amenities.ts`) — this is a portal-specific INPUT adapter (Immoweb's
 * boolean flag names), and every target is a fixed canonical key, so the ingest
 * promotes `elevator`→hasElevator, `terrace`→hasBalcony, `garden`→hasGarden and
 * the app renders each translated.
 */
const IMMOWEB_AMENITY_FLAGS: Readonly<Record<string, string>> = {
  hasLift: 'elevator',
  hasTerrace: 'terrace',
  hasGarden: 'garden',
  hasBasement: 'storage',
  hasLaundryRoom: 'laundry_room',
  hasArmoredDoor: 'armored_door',
  hasAttic: 'attic',
  hasInternet: 'wifi',
  hasVisiophone: 'intercom',
  hasAirConditioning: 'air_conditioning',
  hasSwimmingPool: 'pool',
  hasFitnessRoom: 'gym',
  hasSauna: 'sauna',
  hasJacuzzi: 'jacuzzi',
  hasDisabledAccess: 'disabled_access',
  hasCableTV: 'cable_tv',
};

/**
 * Build the canonical amenity slug list from Immoweb's `has*` boolean flags.
 * Only `true` flags contribute; the array is deduped and stably ordered.
 */
function collectAmenities(property: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const [flag, slug] of Object.entries(IMMOWEB_AMENITY_FLAGS)) {
    if (property[flag] === true) out.add(slug);
  }
  return [...out];
}

/**
 * Total bathroom count. Belgian listings split full bathrooms
 * (`bathroomCount`) from separate shower rooms (`showerRoomCount`); the app's
 * single `bathrooms` field is their sum. Returns undefined when neither is set.
 */
function bathroomsFromProperty(property: Record<string, unknown>): number | undefined {
  const bathrooms = asNumber(property.bathroomCount);
  const showers = asNumber(property.showerRoomCount);
  if (bathrooms === undefined && showers === undefined) return undefined;
  return (bathrooms ?? 0) + (showers ?? 0);
}

/**
 * Immoweb reports parking as separate indoor/outdoor counts. Sum them for the
 * total space count and classify the type: indoor spots imply a garage,
 * outdoor-only implies street parking, an explicit zero total implies none.
 */
function parkingFromProperty(
  property: Record<string, unknown>,
): { spaces: number; type: 'none' | 'street' | 'garage' } | undefined {
  const indoor = asNumber(property.parkingCountIndoor);
  const outdoor = asNumber(property.parkingCountOutdoor);
  if (indoor === undefined && outdoor === undefined) return undefined;
  const spaces = (indoor ?? 0) + (outdoor ?? 0);
  const type = indoor !== undefined && indoor > 0
    ? 'garage'
    : outdoor !== undefined && outdoor > 0
      ? 'street'
      : 'none';
  return { spaces, type };
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
  if (property) {
    const bathrooms = bathroomsFromProperty(property);
    if (bathrooms !== undefined) result.bathrooms = bathrooms;
  }
  // Immoweb keeps the construction year on the shared `building`, not the unit;
  // `property.constructionYear` is always null. Fall back to the unit-level
  // field only if a future payload ever populates it.
  const building = property && isRecord(property.building) ? property.building : undefined;
  const yearBuilt = asNumber(building?.constructionYear) ?? asNumber(property?.constructionYear);
  if (yearBuilt !== undefined && yearBuilt > 0) result.yearBuilt = yearBuilt;
  if (property && typeof property.hasLift === 'boolean') result.hasElevator = property.hasLift;
  if (property) {
    const hasGarden = featurePresent(property.hasGarden, property.gardenSurface);
    if (hasGarden !== undefined) result.hasGarden = hasGarden;
    const hasBalcony = featurePresent(property.hasTerrace, property.terraceSurface);
    if (hasBalcony !== undefined) result.hasBalcony = hasBalcony;
    const parking = parkingFromProperty(property);
    if (parking) {
      result.parkingSpaces = parking.spaces;
      result.parkingType = parking.type;
    }
    if (typeof property.isFurnished === 'boolean') result.furnished = property.isFurnished;
    const amenities = collectAmenities(property);
    if (amenities.length > 0) result.amenities = amenities;
  }
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
