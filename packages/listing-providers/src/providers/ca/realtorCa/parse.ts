/**
 * Realtor.ca JSON parsers — `api2.realtor.ca` search + detail payloads.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../contact';
import { asNumber, asString, isRecord } from '../../../parse/guards';
import { isCloudflareChallenge } from '../../../parse/challenge';
import {
  realtorCaSourceUrl,
  type RealtorCaTransaction,
} from './api';

export interface RealtorCaSearchRef {
  sourceId: string;
  url: string;
  kind: RealtorCaTransaction;
}

export interface RealtorCaRawListing {
  sourceId: string;
  url: string;
  mlsNumber?: string;
  description?: string;
  kind: RealtorCaTransaction;
  price: number;
  currency: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  address: {
    street?: string;
    city: string;
    state?: string;
    postalCode?: string;
    countryCode: string;
    coordinates?: { lat: number; lng: number };
  };
  images: string[];
  contact?: NormalizedListingContact;
}

export function isRealtorCaChallenge(body: string): boolean {
  return isCloudflareChallenge(body) || /incapsula|_Incapsula_Resource|access denied/i.test(body);
}

function parseAddressText(text: string): {
  street?: string;
  city: string;
  state?: string;
  postalCode?: string;
} {
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { city: 'Canada' };
  const street = parts[0];
  const city = parts.length >= 2 ? parts[1] : 'Canada';
  const regionPostal = parts.length >= 3 ? parts[2] : undefined;
  let state: string | undefined;
  let postalCode: string | undefined;
  if (regionPostal) {
    const match = /^([A-Za-z]{2,})\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)$/i.exec(regionPostal);
    if (match) {
      state = match[1];
      postalCode = match[2]?.replace(/\s+/g, ' ').trim();
    } else {
      state = regionPostal;
    }
  }
  return { street, city, state, postalCode };
}

function parseSqft(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /([\d,.]+)\s*sq\s*ft/i.exec(value);
  if (!match?.[1]) return undefined;
  const parsed = Number.parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveKind(priceDisplay: string | undefined, unformatted: string | undefined): RealtorCaTransaction {
  if (priceDisplay && /month|\/mo|rent/i.test(priceDisplay)) return 'rent';
  if (unformatted && Number.parseFloat(unformatted) < 50_000) return 'rent';
  return 'sale';
}

function resolveContact(individuals: unknown): NormalizedListingContact | undefined {
  if (!Array.isArray(individuals)) return undefined;
  const agent = individuals.find((entry) => isRecord(entry));
  if (!agent) return undefined;
  const phones = Array.isArray(agent.Phones) ? agent.Phones : [];
  const firstPhone = phones.find((entry) => isRecord(entry));
  const area = asString(firstPhone?.AreaCode);
  const number = asString(firstPhone?.PhoneNumber);
  const phone = area && number ? `${area}${number.replace(/\D/g, '')}` : number;
  const org = isRecord(agent.Organization) ? agent.Organization : undefined;
  return buildContact({
    phone,
    name: asString(agent.Name),
    agencyName: asString(org?.Name),
    kind: 'agency',
  });
}

function resultToRaw(result: Record<string, unknown>, kindHint?: RealtorCaTransaction): RealtorCaRawListing | undefined {
  const sourceId = asString(result.Id);
  if (!sourceId) return undefined;

  const property = isRecord(result.Property) ? result.Property : undefined;
  const building = isRecord(result.Building) ? result.Building : undefined;
  const address = isRecord(property?.Address) ? property.Address : undefined;
  const addressText = asString(address?.AddressText);
  if (!addressText) return undefined;

  const priceDisplay = asString(property?.Price);
  const unformatted = asString(property?.PriceUnformattedValue);
  const kind = kindHint ?? resolveKind(priceDisplay, unformatted);
  const price = asNumber(unformatted) ?? asNumber(property?.PriceUnformattedValue);
  if (price === undefined || price <= 0) return undefined;

  const parsedAddress = parseAddressText(addressText);
  const lat = asNumber(address?.Latitude);
  const lng = asNumber(address?.Longitude);
  const photos = Array.isArray(property?.Photo) ? property.Photo : [];
  const images: string[] = [];
  for (const photo of photos) {
    if (!isRecord(photo)) continue;
    const url = asString(photo.HighResPath) ?? asString(photo.LowResPath);
    if (url) images.push(url);
  }

  const raw: RealtorCaRawListing = {
    sourceId,
    url: realtorCaSourceUrl(sourceId, addressText),
    mlsNumber: asString(result.MlsNumber),
    description: asString(result.PublicRemarks),
    kind,
    price,
    currency: 'CAD',
    propertyType: asString(property?.Type),
    bedrooms: asNumber(building?.Bedrooms),
    bathrooms: asNumber(building?.BathroomTotal),
    squareFootage: parseSqft(asString(building?.SizeInterior)),
    address: {
      street: parsedAddress.street,
      city: parsedAddress.city,
      state: parsedAddress.state,
      postalCode: parsedAddress.postalCode,
      countryCode: 'CA',
      coordinates:
        lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    },
    images: [...new Set(images)],
    contact: resolveContact(result.Individual),
  };
  return raw;
}

/** Parse PropertySearch_Post JSON into listing refs. */
export function parseRealtorCaSearch(body: string, kind: RealtorCaTransaction): RealtorCaSearchRef[] {
  if (isRealtorCaChallenge(body)) return [];
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) return [];
  const results = Array.isArray(parsed.Results) ? parsed.Results : [];
  const refs: RealtorCaSearchRef[] = [];
  const seen = new Set<string>();
  for (const entry of results) {
    if (!isRecord(entry)) continue;
    const raw = resultToRaw(entry, kind);
    if (!raw || seen.has(raw.sourceId)) continue;
    seen.add(raw.sourceId);
    refs.push({ sourceId: raw.sourceId, url: raw.url, kind: raw.kind });
  }
  return refs;
}

/** Parse PropertyDetails JSON into a raw listing. */
export function parseRealtorCaDetail(body: string, url: string): RealtorCaRawListing {
  if (isRealtorCaChallenge(body)) {
    throw new Error(`realtor_ca: challenge response for ${url}`);
  }
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) {
    throw new Error(`realtor_ca: invalid detail JSON at ${url}`);
  }
  const raw = resultToRaw(parsed);
  if (!raw) {
    throw new Error(`realtor_ca: could not normalize detail at ${url}`);
  }
  return raw;
}

/** Extract listing id from realtor.ca canonical URLs. */
export function realtorCaSourceIdFromUrl(url: string): string | undefined {
  const match = /\/real-estate\/(\d+)\//i.exec(url);
  return match?.[1];
}
