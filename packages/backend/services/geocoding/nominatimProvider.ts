/**
 * The Nominatim (OpenStreetMap) adapter.
 *
 * ## Provider policy, because it is a licence condition and not a nicety
 *
 * The public endpoint at `nominatim.openstreetmap.org` is operated by the OSM
 * Foundation under a usage policy that this adapter has to satisfy for Homiio
 * to keep using it at all:
 *
 *  - **Attribution.** Data is © OpenStreetMap contributors, ODbL 1.0. The
 *    attribution travels on every gateway response ({@link NOMINATIM_ATTRIBUTION})
 *    so the surface rendering results can show it. It is not optional.
 *  - **An identifying User-Agent** on every request. Requests without one are
 *    answered 403. A browser refuses to let JavaScript set this header at all,
 *    which is one concrete reason the client cannot be the one calling.
 *  - **At most ~1 request/second, from one source.** Serialised by
 *    {@link acquireSlot}. This is countable only because every call now leaves
 *    from the backend; per-device calls cannot be rate-limited, which is the
 *    other reason the client cannot be the one calling.
 *  - **No heavy uses, and specifically no autocomplete against the public
 *    endpoint.** Homiio's autocomplete is served from the gateway's cache in
 *    front of this adapter, and a self-hosted instance
 *    (`NOMINATIM_BASE_URL` + `GEOCODING_MIN_INTERVAL_MS=0`) is the supported
 *    way to lift the ceiling. Nothing above the adapter changes when it moves.
 *
 * @see https://operations.osmfoundation.org/policies/nominatim/
 */

import config from '../../config';
import {
  GeocodingProviderError,
  type AutocompleteInput,
  type GeocodingProvider,
  type ProviderAddressParts,
  type ProviderAttribution,
  type ProviderBounds,
  type ProviderHealth,
  type ProviderPlace,
  type ResolveInput,
  type ReverseInput,
} from './types';

export const NOMINATIM_PROVIDER_ID = 'osm';

export const NOMINATIM_ATTRIBUTION: ProviderAttribution = {
  text: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright',
};

/** How long a single provider call may take before it is a `timeout`. */
const REQUEST_TIMEOUT_MS = 8000;

/** Subset of Nominatim's structured `address` object this adapter consumes. */
interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  footway?: string;
  house_number?: string;
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  state?: string;
  region?: string;
  'ISO3166-2-lvl4'?: string;
  country?: string;
  country_code?: string;
  postcode?: string;
}

/** A Nominatim feature as returned by `format=jsonv2`. */
interface NominatimPlace {
  osm_type?: string;
  osm_id?: number | string;
  place_id?: number | string;
  name?: string;
  lat?: string;
  lon?: string;
  display_name?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  /** Nominatim order is [south, north, west, east], as strings. */
  boundingbox?: [string, string, string, string];
  address?: NominatimAddress;
  error?: string;
}

/**
 * Serialise network calls so their *starts* are spaced by at least
 * `config.geocoding.minIntervalMs`.
 *
 * Two goals: honour the OSM policy, and stop a high-volume ingest from
 * self-inflicting 429s — the failure that silently dropped external listings
 * whose address geocode raced a flood of concurrent lookups. Cache hits never
 * reach this gate; only real network calls queue behind it. The chain swallows
 * its own settle so one slot can never wedge the queue.
 */
let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function acquireSlot(): Promise<void> {
  const slot = requestQueue.then(async () => {
    const minInterval = config.geocoding.minIntervalMs;
    if (minInterval > 0) {
      const wait = lastRequestAt + minInterval - Date.now();
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    lastRequestAt = Date.now();
  });
  requestQueue = slot.catch(() => undefined);
  return slot;
}

/** Reset the policy queue. Test seam only — never called by request code. */
export function resetNominatimRateLimiter(): void {
  requestQueue = Promise.resolve();
  lastRequestAt = 0;
}

const headers = (language: string): Record<string, string> => {
  const built: Record<string, string> = {
    'User-Agent': config.geocoding.userAgent,
    Accept: 'application/json',
  };
  if (config.geocoding.referer) built.Referer = config.geocoding.referer;
  if (language) built['Accept-Language'] = language;
  return built;
};

const retryAfterSeconds = (response: Response): number | undefined => {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

/**
 * One HTTP call, with every failure mapped onto a typed reason.
 *
 * The mapping is the point of this function. An adapter that let a raw
 * `TypeError: fetch failed` escape would leave the gateway unable to tell a
 * network blip from a malformed response, and therefore unable to decide
 * whether a second provider might do better.
 */
async function requestJson(url: URL, language: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // `AbortSignal.any` is not available on every runtime this ships to, so the
  // caller's signal is forwarded by hand.
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  try {
    await acquireSlot();

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: headers(language),
        signal: controller.signal,
      });
    } catch (error) {
      // An abort is a timeout from the gateway's point of view whether it came
      // from our own timer or from a caller giving up on a superseded keystroke.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GeocodingProviderError('timeout', NOMINATIM_PROVIDER_ID);
      }
      throw new GeocodingProviderError('provider_unavailable', NOMINATIM_PROVIDER_ID);
    }

    if (response.status === 429) {
      throw new GeocodingProviderError(
        'rate_limited',
        NOMINATIM_PROVIDER_ID,
        retryAfterSeconds(response),
      );
    }
    if (response.status === 400 || response.status === 404) {
      throw new GeocodingProviderError('invalid_request', NOMINATIM_PROVIDER_ID);
    }
    if (!response.ok) {
      throw new GeocodingProviderError('provider_unavailable', NOMINATIM_PROVIDER_ID);
    }

    try {
      return await response.json();
    } catch {
      throw new GeocodingProviderError('invalid_response', NOMINATIM_PROVIDER_ID);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text ? text : undefined;
};

/**
 * Coalesce Nominatim's key set onto the provider-neutral vocabulary.
 *
 * Which keys are synonyms is precisely the portal knowledge an adapter exists
 * to hold; nothing downstream should ever have to know that a Spanish village
 * arrives under `village` and a German one under `town`.
 */
const toAddressParts = (address: NominatimAddress | undefined): ProviderAddressParts => {
  const source = address ?? {};
  return {
    street: trimmed(source.road ?? source.pedestrian ?? source.footway),
    houseNumber: trimmed(source.house_number),
    neighborhood: trimmed(source.neighbourhood ?? source.suburb ?? source.quarter),
    city: trimmed(source.city ?? source.town ?? source.village ?? source.municipality),
    region: trimmed(source.state ?? source.region),
    regionCode: trimmed(source['ISO3166-2-lvl4']),
    country: trimmed(source.country),
    countryCode: trimmed(source.country_code)?.toUpperCase(),
    postalCode: trimmed(source.postcode),
  };
};

/**
 * Nominatim's `boundingbox` is [south, north, west, east] as strings.
 *
 * A box whose south exceeds its north is discarded rather than emitted: the
 * contract in `types.ts` says that ordering is an error, and passing a broken
 * box on would put an unsatisfiable rectangle into a search query. A `west`
 * greater than `east` is NOT rejected — that is the legal antimeridian case.
 */
const toBounds = (boundingbox: NominatimPlace['boundingbox']): ProviderBounds | undefined => {
  if (!boundingbox || boundingbox.length !== 4) return undefined;
  const south = Number.parseFloat(boundingbox[0]);
  const north = Number.parseFloat(boundingbox[1]);
  const west = Number.parseFloat(boundingbox[2]);
  const east = Number.parseFloat(boundingbox[3]);
  if ([south, north, west, east].some((value) => !Number.isFinite(value))) return undefined;
  if (south > north) return undefined;
  return { west, south, east, north };
};

/**
 * The provider's stable ref: OSM's own type-letter + id (`R349036`), which is
 * also exactly what `/lookup?osm_ids=` accepts. `place_id` is explicitly NOT
 * used — Nominatim's own documentation warns it is a row number that changes
 * whenever the instance is rebuilt, which would make a bookmarked `loc` token
 * resolve to a different place after a reimport.
 */
const toRef = (place: NominatimPlace): string | null => {
  const type = place.osm_type?.[0]?.toUpperCase();
  const id = place.osm_id;
  if (!type || !'NWR'.includes(type) || id === undefined || id === null) return null;
  return `${type}${id}`;
};

const toProviderPlace = (place: NominatimPlace): ProviderPlace | null => {
  const ref = toRef(place);
  if (!ref) return null;

  const longitude = Number.parseFloat(place.lon ?? '');
  const latitude = Number.parseFloat(place.lat ?? '');
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  const displayName = trimmed(place.display_name) ?? '';
  // `name` is Nominatim's localised short name for the feature. When it is
  // absent (some address-level results carry none) the leading component of
  // `display_name` is the only thing available. That fallback is confined to
  // this adapter on purpose: it is a Nominatim formatting assumption, and ADR
  // 0002 §9.4 forbids consumers making it.
  const name = trimmed(place.name) ?? trimmed(displayName.split(',')[0]) ?? displayName;
  if (!name) return null;

  return {
    providerId: NOMINATIM_PROVIDER_ID,
    ref,
    name,
    displayName,
    address: toAddressParts(place.address),
    center: { longitude, latitude },
    bounds: toBounds(place.boundingbox),
    rawClass: trimmed(place.class),
    rawType: trimmed(place.type),
    rawAddressType: trimmed(place.addresstype),
  };
};

const asPlaceArray = (payload: unknown): NominatimPlace[] => {
  if (!Array.isArray(payload)) {
    throw new GeocodingProviderError('invalid_response', NOMINATIM_PROVIDER_ID);
  }
  return payload as NominatimPlace[];
};

export function createNominatimProvider(): GeocodingProvider {
  const baseUrl = config.geocoding.nominatimBaseUrl;

  return {
    id: NOMINATIM_PROVIDER_ID,
    attribution: NOMINATIM_ATTRIBUTION,

    async autocomplete(input: AutocompleteInput): Promise<ProviderPlace[]> {
      const url = new URL('/search', baseUrl);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('q', input.query);
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', String(input.limit));
      if (input.countryCode) {
        url.searchParams.set('countrycodes', input.countryCode.toLowerCase());
      }
      if (input.near) {
        // `viewbox` + no `bounded` is Nominatim's BIAS, not its filter. Passing
        // `bounded=1` here would drop a valid result from another country,
        // which is the behaviour ADR 0002 §9.4 and the issue both forbid.
        const { longitude, latitude } = input.near;
        const delta = 1;
        url.searchParams.set(
          'viewbox',
          [longitude - delta, latitude + delta, longitude + delta, latitude - delta].join(','),
        );
      }

      const payload = await requestJson(url, input.language, input.signal);
      return asPlaceArray(payload)
        .map(toProviderPlace)
        .filter((place): place is ProviderPlace => place !== null);
    },

    async resolve(input: ResolveInput): Promise<ProviderPlace | null> {
      if (!/^[NWR]\d+$/.test(input.ref)) {
        // A ref this provider could never have minted. Refusing it here keeps a
        // malformed `loc` token from reaching the network at all.
        throw new GeocodingProviderError('invalid_request', NOMINATIM_PROVIDER_ID);
      }

      const url = new URL('/lookup', baseUrl);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('osm_ids', input.ref);
      url.searchParams.set('addressdetails', '1');

      const payload = await requestJson(url, input.language, input.signal);
      const [place] = asPlaceArray(payload);
      return place ? toProviderPlace(place) : null;
    },

    async reverse(input: ReverseInput): Promise<ProviderPlace | null> {
      const url = new URL('/reverse', baseUrl);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(input.point.latitude));
      url.searchParams.set('lon', String(input.point.longitude));
      url.searchParams.set('addressdetails', '1');

      const payload = await requestJson(url, input.language, input.signal);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new GeocodingProviderError('invalid_response', NOMINATIM_PROVIDER_ID);
      }
      const place = payload as NominatimPlace;
      // Nominatim answers "nothing here" with HTTP 200 and an `error` body,
      // which is a successful call reporting no result — not a failure.
      if (place.error) return null;
      return toProviderPlace(place);
    },

    async health(): Promise<ProviderHealth> {
      const url = new URL('/status.php', baseUrl);
      url.searchParams.set('format', 'json');
      try {
        await requestJson(url, '');
        return { providerId: NOMINATIM_PROVIDER_ID, healthy: true };
      } catch (error) {
        return {
          providerId: NOMINATIM_PROVIDER_ID,
          healthy: false,
          detail:
            error instanceof GeocodingProviderError ? error.reason : 'unknown',
        };
      }
    },
  };
}
