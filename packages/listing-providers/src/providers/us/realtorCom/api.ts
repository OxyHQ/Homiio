/**
 * realtor.com GraphQL API helpers (pure URL + response parsing).
 */

import { REALTOR_COM_BASE_URL } from './fixtures';
import type { RecordedRealtorListing } from './fixtures';
import { asNumberUs as asNumber, asString, isRecord } from '../../../parse/guards';

export const REALTOR_GRAPHQL_URL =
  'https://www.realtor.com/frontdoor/graphql?client_id=rdc-x&schema=vesta';

export const REALTOR_GRAPHQL_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  'rdc-client-name': 'RDC_WEB',
  'rdc-client-version': '3.0.0',
};

export type RealtorKind = 'rent' | 'sale';

const SEARCH_QUERY = `query ConsumerSearchMainQuery($query: HomeSearchCriteria!, $limit: Int, $offset: Int, $sort_type: SearchSortType) {
  home_search: home_search(query: $query, limit: $limit, offset: $offset, sort_type: $sort_type) {
    count
    total
    results {
      property_id
      listing_id
      permalink
      status
      list_price
      list_price_min
      list_price_max
      description { beds baths sqft }
      location {
        address {
          line
          city
          state_code
          postal_code
          coordinate { lat lon }
        }
      }
      primary_photo { href }
      photos { href }
    }
  }
}`;

const DETAIL_QUERY = `query HomeDetails($property_id: ID!) {
  home(property_id: $property_id) {
    property_id
    listing_id
    permalink
    status
    list_price
    list_price_min
    list_price_max
    description { beds baths sqft }
    location {
      address {
        line
        city
        state_code
        postal_code
        coordinate { lat lon }
      }
    }
    primary_photo { href }
    photos { href }
  }
}`;

function statusForKind(kind: RealtorKind): string[] {
  return kind === 'sale' ? ['for_sale'] : ['for_rent'];
}

export function realtorKindFromStatus(status: string): RealtorKind {
  return status === 'for_sale' ? 'sale' : 'rent';
}

export function realtorSourceUrl(permalink: string): string {
  return `${REALTOR_COM_BASE_URL}/realestateandhomes-detail/${permalink}`;
}

export function realtorSearchBody(city: string, kind: RealtorKind, offset: number, limit: number): string {
  return JSON.stringify({
    operationName: 'ConsumerSearchMainQuery',
    query: SEARCH_QUERY,
    variables: {
      query: {
        status: statusForKind(kind),
        search_location: { location: city },
      },
      limit,
      offset,
      sort_type: 'relevant',
    },
  });
}

export function realtorDetailBody(propertyId: string): string {
  return JSON.stringify({
    operationName: 'HomeDetails',
    query: DETAIL_QUERY,
    variables: { property_id: propertyId },
  });
}

function readCoordinate(value: unknown): { lat: number; lon: number } | undefined {
  if (!isRecord(value)) return undefined;
  const lat = asNumber(value.lat);
  const lon = asNumber(value.lon);
  if (lat === undefined || lon === undefined) return undefined;
  return { lat, lon };
}

function readPhotos(value: unknown): Array<{ href: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ href: string }> = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const href = asString(entry.href);
    if (href) out.push({ href });
  }
  return out;
}

/** Narrow a GraphQL home node into {@link RecordedRealtorListing}. */
export function parseRealtorListingNode(node: unknown): RecordedRealtorListing | undefined {
  if (!isRecord(node)) return undefined;
  const property_id = asString(node.property_id);
  const listing_id = asString(node.listing_id);
  const permalink = asString(node.permalink);
  const status = asString(node.status);
  if (!property_id || !listing_id || !permalink || !status) return undefined;

  const descriptionRaw = isRecord(node.description) ? node.description : {};
  const locationRaw = isRecord(node.location) && isRecord(node.location.address) ? node.location.address : null;
  if (!locationRaw) return undefined;

  const line = asString(locationRaw.line);
  const city = asString(locationRaw.city);
  const state_code = asString(locationRaw.state_code);
  const postal_code = asString(locationRaw.postal_code);
  const coordinate = readCoordinate(locationRaw.coordinate);
  if (!line || !city || !state_code || !postal_code || !coordinate) return undefined;

  const primaryRaw = isRecord(node.primary_photo) ? node.primary_photo : null;
  const primaryHref = primaryRaw ? asString(primaryRaw.href) : undefined;

  return {
    property_id,
    listing_id,
    permalink,
    status,
    list_price: asNumber(node.list_price) ?? null,
    list_price_min: asNumber(node.list_price_min) ?? null,
    list_price_max: asNumber(node.list_price_max) ?? null,
    description: {
      beds: asNumber(descriptionRaw.beds) ?? null,
      baths: asNumber(descriptionRaw.baths) ?? null,
      sqft: asNumber(descriptionRaw.sqft) ?? null,
    },
    location: {
      address: { line, city, state_code, postal_code, coordinate },
    },
    photos: readPhotos(node.photos),
    primary_photo: primaryHref ? { href: primaryHref } : null,
  };
}

export interface RealtorSearchRefs {
  sourceId: string;
  url: string;
  kind: RealtorKind;
}

/** Parse a ConsumerSearchMainQuery JSON body into listing refs. */
export function parseRealtorSearchResponse(body: string): RealtorSearchRefs[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.data) || !isRecord(parsed.data.home_search)) return [];
  const results = parsed.data.home_search.results;
  if (!Array.isArray(results)) return [];

  const out: RealtorSearchRefs[] = [];
  for (const entry of results) {
    const listing = parseRealtorListingNode(entry);
    if (!listing) continue;
    const kind = realtorKindFromStatus(listing.status);
    out.push({
      sourceId: listing.property_id,
      url: realtorSourceUrl(listing.permalink),
      kind,
    });
  }
  return out;
}

/** Parse a HomeDetails JSON body into a listing node. */
export function parseRealtorDetailResponse(body: string): RecordedRealtorListing | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.data) || !isRecord(parsed.data.home)) return undefined;
  return parseRealtorListingNode(parsed.data.home);
}

/** GraphQL error / rate-limit bodies served as JSON. */
export function isRealtorGraphqlChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  if (!trimmed.startsWith('{')) return true;
  try {
    const parsed = JSON.parse(trimmed) as { errors?: unknown; message?: unknown };
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) return true;
    if (typeof parsed.message === 'string' && /missing client|denied|blocked/i.test(parsed.message)) return true;
    return false;
  } catch {
    return true;
  }
}
