import { PropertyType } from '@homiio/shared-types';

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
