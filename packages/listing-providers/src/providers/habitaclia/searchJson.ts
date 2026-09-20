/**
 * Habitaclia search results, read from the page's embedded JSON.
 *
 * See `../adevinta/initialProps.ts` for why the portal's markup stopped being
 * parseable and why the JSON is the better target rather than merely the
 * available one.
 *
 * Shape (2026-09):
 *
 *   initialSearchResultsPage.initialSearchContext.results = {
 *     items: [ { legacyNumericId, navigationUrl, urls: { canonical, short }, … } ],
 *     pagination: { page, pageSize, totalCount, totalPages },
 *   }
 */

import { asRecord, asString } from '../../parse/guards';
import { maxImagesPerListingFromEnv } from '../../discoverLimits';
import { extractAdevintaInitialProps } from '../adevinta/initialProps';
import {
  HABITACLIA_BASE_URL,
  type HabitacliaRawImage,
  type HabitacliaRawListing,
} from './fixtures';

/** A ref, plus the listing the search page already told us everything about. */
export interface HabitacliaSearchRef {
  sourceId: string;
  url: string;
  /**
   * The fully-mapped listing, when the search item carried enough to build one.
   *
   * THIS IS WHY THE DETAIL PAGE IS NOT FETCHED. The 2026-09 redesign left the
   * detail page client-rendered: no JSON-LD, no embedded props, nothing a
   * server-side parser can read. The search payload, by contrast, carries the
   * whole listing. So the data does not merely make a detail fetch redundant —
   * it is the only place the data exists.
   *
   * The saving is the same shape as the correctness fix: one request per 30
   * listings instead of 31. For Barcelona's 3,269 rentals that is 109 requests
   * against 3,378.
   */
  listing?: HabitacliaRawListing;
}

/** A listing reference plus the page's own idea of how many pages remain. */
export interface HabitacliaSearchPage {
  refs: HabitacliaSearchRef[];
  /** Total pages the portal reports, when it says — lets discover stop early. */
  totalPages?: number;
  /** Total listings the portal reports for this search. */
  totalCount?: number;
}

/**
 * Read one search results page.
 *
 * Returns `undefined` when the page carries no readable payload, which is NOT
 * the same as a page with zero listings — the caller must keep those two apart,
 * because treating an unreadable page as an empty city is precisely how this
 * provider went quiet for weeks without anybody noticing.
 */
export function parseHabitacliaSearchJson(html: string): HabitacliaSearchPage | undefined {
  const props = extractAdevintaInitialProps(html);
  if (!props) return undefined;

  const results = asRecord(
    asRecord(asRecord(props['initialSearchResultsPage'])?.['initialSearchContext'])?.['results'],
  );
  if (!results) return undefined;

  const items = Array.isArray(results['items']) ? results['items'] : undefined;
  if (!items) return undefined;

  const pagination = asRecord(results['pagination']);
  const refs: HabitacliaSearchRef[] = [];
  const seen = new Set<string>();

  for (const entry of items) {
    const item = asRecord(entry);
    const ref = refFromItem(item);
    if (!ref || seen.has(ref.sourceId)) continue;
    seen.add(ref.sourceId);
    refs.push({ ...ref, listing: habitacliaListingFromSearchItem(item) });
  }

  return {
    refs,
    totalPages: positiveInteger(pagination?.['totalPages']),
    totalCount: positiveInteger(pagination?.['totalCount']),
  };
}

/**
 * Turn one search item into a ref.
 *
 * **`legacyNumericId` IS THE IDENTITY AND THE CHOICE MATTERS.** The upsert key
 * is `(source, sourceId)`, and every Habitaclia row already in the database was
 * keyed by the digits in `…-i<digits>.htm`, which is exactly this field. The
 * item also carries a UUID `id` and a `urls.canonical` built from it; keying on
 * either would re-import the entire Spanish catalogue as new rows alongside the
 * old ones rather than updating them.
 */
function refFromItem(item: Record<string, unknown> | undefined): { sourceId: string; url: string } | undefined {
  if (!item) return undefined;

  const sourceId = asString(item['legacyNumericId'])?.trim();
  if (!sourceId || !/^\d{6,}$/.test(sourceId)) return undefined;

  return { sourceId, url: detailUrlFor(item, sourceId) };
}

/**
 * Absolute detail URL for a listing.
 *
 * Prefers the portal's own `navigationUrl` (`/i<id>.htm?from=list`) over a
 * hand-built one so a future path change follows the portal rather than needing
 * this file edited again. The tracking query is dropped: it is not part of the
 * listing's identity and would otherwise end up stored on the property as its
 * `sourceUrl`, which is a link real people click.
 */
function detailUrlFor(item: Record<string, unknown>, sourceId: string): string {
  const navigation = asString(item['navigationUrl'])?.trim();
  const path = navigation && navigation.startsWith('/') ? navigation.split('?')[0] : `/i${sourceId}.htm`;
  return `${HABITACLIA_BASE_URL}${path}`;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/* -------------------------------------------------------------------------- */
/* Search item -> raw listing                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Floor names the portal uses instead of numbers.
 *
 * **`GROUND_FLOOR` MAPS TO 0, NOT TO `undefined`.** `floor` is optional and the
 * two states are different facts: `undefined` means nobody said, `0` means the
 * home is on the ground floor — a thing renters filter on deliberately. Folding
 * one into the other is the exact mistake `0024_floor_not_stated` exists to
 * prevent, so an unrecognised name yields `undefined` and never a guess.
 *
 * Names outside this table (attics, basements, mezzanines above the entrance)
 * are deliberately absent: there is no honest integer for them.
 */
const FLOOR_NAMES: Readonly<Record<string, number>> = {
  GROUND_FLOOR: 0,
  FIRST: 1,
  SECOND: 2,
  THIRD: 3,
  FOURTH: 4,
  FIFTH: 5,
  SIXTH: 6,
  SEVENTH: 7,
  EIGHTH: 8,
  NINTH: 9,
  TENTH: 10,
};

/**
 * Portal property categories, mapped onto Homiio's vocabulary.
 *
 * Explicit rather than passed through: `flat` happens to fall back to
 * `apartment` and `house` happens to be spelled the same, so a pass-through
 * would work today by luck and break silently the first time the portal adds a
 * category. Anything unlisted falls back to `apartment` exactly as before.
 */
const PROPERTY_CATEGORIES: Readonly<Record<string, string>> = {
  flat: 'apartment',
  penthouse: 'apartment',
  duplex: 'apartment',
  studio: 'studio',
  house: 'house',
  chalet: 'house',
  villa: 'house',
  room: 'room',
};

/**
 * Images carried per listing — the SAME number the ingest will keep.
 *
 * Read from `LISTING_MAX_IMAGES_PER_LISTING` rather than picked here, because
 * carrying more than the ingest accepts is pure waste twice over: the surplus
 * URLs ride through Redis in every job payload (a listing advertises 70+ photos
 * at ~117 bytes each) and are then dropped on arrival. Measured on live pages,
 * images are the largest part of a carried listing — 2,340 bytes against ~1,500
 * for the description and ~660 for everything else combined.
 */

/**
 * Map one search item onto the shape `normalize()` already consumes.
 *
 * Doing it here rather than teaching `normalize` a second input shape means the
 * detail-page path and this one produce identical rows, so a listing that
 * arrives by either route normalizes the same way.
 */
export function habitacliaListingFromSearchItem(
  raw: unknown,
): HabitacliaRawListing | undefined {
  const item = asRecord(raw);
  const ref = refFromItem(item);
  if (!item || !ref) return undefined;

  const summary = asRecord(item['summary']) ?? {};
  const property = asRecord(item['property']) ?? {};
  const transaction = asRecord(item['transaction']) ?? {};
  const location = asRecord(summary['location']) ?? {};

  const price = finiteNumber(asRecord(transaction['price'])?.['amount']);
  if (price === undefined || price <= 0) return undefined;

  const operation = asString(transaction['type'])?.toLowerCase() === 'rent' ? 'rent' : 'sale';
  const category = asString(property['propertySubtype']) ?? asString(property['propertyType']) ?? '';

  return {
    id: ref.sourceId,
    url: ref.url,
    propertyType: PROPERTY_CATEGORIES[category.toLowerCase()] ?? 'apartment',
    title: asString(summary['title']),
    description: asString(summary['description']),
    price,
    // The portal leaves `currency` null on every Spanish listing observed, which
    // is a statement about its own UI rather than about the money. These are
    // euro amounts on a Spanish portal; defaulting is safe here and would not be
    // on a multi-currency market.
    currency: asString(asRecord(transaction['price'])?.['currency']) ?? 'EUR',
    operation,
    address: addressFromLocation(location),
    bedrooms: finiteNumber(property['rooms']),
    bathrooms: finiteNumber(property['bathrooms']),
    squareMeters: finiteNumber(property['builtSurface']),
    floor: floorFromName(asString(property['floor'])),
    amenities: amenitiesFrom(property),
    images: imagesFrom(summary),
    contact: contactFrom(asRecord(item['contact'])),
  };
}

function addressFromLocation(location: Record<string, unknown>): HabitacliaRawListing['address'] {
  const address = asRecord(location['address']) ?? {};
  const coordinates = asRecord(location['coordinates']) ?? {};
  const street = [asString(address['streetName'])?.trim(), asString(address['streetNumber'])?.trim()]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    street: street || undefined,
    // `municipality` is the searchable city ("Barcelona Capital"); the province
    // is the region above it. City is required by the raw shape, so fall back
    // through the coarser fields rather than emitting an empty string.
    city:
      asString(location['municipality']) ??
      asString(location['province']) ??
      asString(location['region']) ??
      '',
    region: asString(location['province']) ?? asString(location['region']),
    neighborhood: neighbourhoodFrom(location),
    country: 'España',
    countryCode: 'ES',
    lat: finiteNumber(coordinates['latitude']),
    lng: finiteNumber(coordinates['longitude']),
  };
}

/**
 * Prefer the named neighbourhood layer over the district.
 *
 * A district ("Sarrià - Sant Gervasi") is several neighbourhoods wide; the
 * `neighbourhood` layer ("Sant Gervasi- Galvany") is the one a resident would
 * name. Falls back to the district when no layer is present.
 */
function neighbourhoodFrom(location: Record<string, unknown>): string | undefined {
  const layers = Array.isArray(location['layers']) ? location['layers'] : [];
  for (const entry of layers) {
    const layer = asRecord(entry);
    if (asString(layer?.['type']) === 'neighbourhood') {
      const value = asString(layer?.['value'])?.trim();
      if (value) return value;
    }
  }
  return asString(location['district']) ?? undefined;
}

/** `features.has` is a flat list of upper-snake tokens; lower-case them. */
function amenitiesFrom(property: Record<string, unknown>): string[] | undefined {
  const has = asRecord(property['features'])?.['has'];
  const tokens = Array.isArray(has) ? has : [];
  const amenities = tokens
    .map((token) => asString(token)?.toLowerCase().trim())
    .filter((token): token is string => Boolean(token));
  return amenities.length > 0 ? amenities : undefined;
}

function imagesFrom(summary: Record<string, unknown>): HabitacliaRawImage[] {
  const images = asRecord(summary['multimedia'])?.['images'];
  const entries = Array.isArray(images) ? images : [];
  const urls: HabitacliaRawImage[] = [];
  for (const entry of entries) {
    const url = asString(asRecord(entry)?.['url'])?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    urls.push({ url, isPrimary: urls.length === 0 });
    if (urls.length >= maxImagesPerListingFromEnv()) break;
  }
  return urls;
}

/** Never fabricate a contact — only fields the portal actually returned. */
function contactFrom(contact: Record<string, unknown> | undefined): HabitacliaRawListing['contact'] {
  const phone = asString(contact?.['phone'])?.trim();
  const email = asString(contact?.['email'])?.trim();
  if (!phone && !email) return undefined;
  return { phone: phone || undefined, email: email || undefined };
}

function floorFromName(name: string | undefined): number | undefined {
  if (!name) return undefined;
  const mapped = FLOOR_NAMES[name.toUpperCase()];
  if (mapped !== undefined) return mapped;
  const numeric = Number.parseInt(name, 10);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
