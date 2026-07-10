import { PropertyType } from '@homiio/shared-types';
import { NonHousingListingError } from '../../parse/classifieds';

/** UK outward code only (e.g. SE1, WC2N) — accepted when full inward code is absent. */
const UK_OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

/** Raise a worker-skippable non-housing rejection for GB portal parsers. */
export function rejectGbNonHousing(provider: string, sourceId: string, reason: string): never {
  throw new NonHousingListingError(provider, sourceId, reason);
}

/** Split a UK portal display address into street, city, and optional postcode/outcode. */
export function splitGbDisplayAddress(
  displayAddress: string | undefined,
  locality?: string,
): { street: string; city: string; postalCode?: string } {
  if (!displayAddress) return { street: '', city: locality ?? '' };
  const parts = displayAddress.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { street: '', city: locality ?? '' };
  if (parts.length === 1) return { street: parts[0], city: locality ?? parts[0] };

  const last = parts[parts.length - 1];
  const postcodeOnly = UK_OUTCODE_RE.test(last);
  const postcodeMatch = last.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  let city: string;
  let streetParts: string[];
  if (postcodeMatch || postcodeOnly) {
    city = locality ?? parts[parts.length - 2] ?? last;
    streetParts = parts.slice(0, Math.max(1, parts.length - 2));
  } else {
    city = locality ?? last;
    streetParts = parts.slice(0, parts.length - 1);
  }
  return {
    street: streetParts.join(', ') || city,
    city,
    postalCode: postcodeMatch?.[1]?.toUpperCase() ?? (postcodeOnly ? last.toUpperCase() : undefined),
  };
}

/** Property-type / subtype tokens that are NOT residential housing. */
const NON_HOUSING_RE =
  /\b(garage|parking|car\s*park|storage|land|plot|commercial|office|retail|shop|warehouse|industrial|farm|equestrian|mobile\s*home|park\s*home|boat|mooring|garage\s*parking)\b/i;

/** OnTheMarket `propSubId` values that are non-housing. */
const NON_HOUSING_PROP_SUB_IDS = new Set([
  'garages',
  'garage',
  'parking',
  'land',
  'commercial',
  'farms',
  'farm',
]);

/** True when a free-text property type / title looks like residential housing. */
export function isGbHousingType(raw: string | undefined): boolean {
  if (!raw || raw.trim().length === 0) return true;
  return !NON_HOUSING_RE.test(raw);
}

/** True when an OnTheMarket propSubId is residential housing. */
export function isOtmHousingPropSubId(propSubId: string | undefined): boolean {
  if (!propSubId) return true;
  return !NON_HOUSING_PROP_SUB_IDS.has(propSubId.toLowerCase());
}

/** Map UK portal property-type strings onto Homiio PropertyType. */
export function resolveGbPropertyType(raw: string | undefined): PropertyType {
  const lower = (raw ?? '').toLowerCase();
  if (/\bstudio\b/.test(lower)) return PropertyType.STUDIO;
  if (/\broom\b|shared/.test(lower)) return PropertyType.ROOM;
  if (/\b(house|bungalow|cottage|detached|semi|terraced|townhouse|maisonette)\b/.test(lower)) {
    return PropertyType.HOUSE;
  }
  return PropertyType.APARTMENT;
}
