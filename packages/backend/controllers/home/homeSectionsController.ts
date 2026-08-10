/**
 * `GET /api/home/sections` — the Home surface, in one request (#353).
 *
 * ## The scope is ONE parameter, `loc`, and that is deliberate
 *
 * The search endpoint takes `city`, `state`, `neighborhood`, a bounding box and
 * a centre+radius as five separate parameters, and that is the shape ADR 0002
 * §5.1 diagnoses: "half of the previous location survived" is expressible
 * whenever a scope is assembled from parts. This endpoint takes the atomic `loc`
 * token instead, so a half-update is not something a caller can send.
 *
 * The one exception is the device case, and it is required rather than a
 * compromise: `here.<radiusMeters>` carries NO coordinates by construction
 * (decision 8 — a shared "near me" link means "near the opener"), so the actual
 * position rides in `lat`/`lng` alongside it. ADR §8.3 permits exactly that —
 * full precision in the REQUEST, never in a key, a URL or a log — and this
 * handler logs `locationKeyOfRef`, never `req.query`.
 *
 * ## Four answers, and collapsing any two of them is the bug
 *
 *  - **no `loc`** → `location.status = 'none'`, sections computed everywhere.
 *    A legitimate query (ADR §4.3): the rule is that a location REQUESTED AND
 *    LOST must never widen, not that a location must always be present. The
 *    client only reaches this after an explicit "Explore everywhere".
 *  - **unparseable `loc`** → **400**. A broken token is a FAILURE the caller has
 *    to show. Answering it globally is the exact degradation this whole contract
 *    exists to prevent, and a 200 with a global page is indistinguishable from
 *    success to every caller that does not read the echo.
 *  - **`loc` naming a place that does not exist** → 200, `unresolved`, and NO
 *    sections. "We could not find that place" and "there is nothing here" are
 *    different sentences.
 *  - **resolved** → 200 with the sections and the key the server applied, so a
 *    client can verify the scope it got is the scope it asked for.
 */

import type { Request, Response } from 'express';
import {
  OfferingType,
  locationKeyOfRef,
  parseLocationToken,
  type GeoPlace,
  type HomeLocationSummary,
  type HomeSectionsResponse,
  type LocationRef,
} from '@homiio/shared-types';

import { logger } from '../../middlewares/logging';
import { lookupCityPlaces } from '../../db/geo/placeLookup';
import { resolvePlace } from '../../services/geocoding/gateway';
import { parseLanguage } from '../../services/geocoding/validation';
import {
  resolveCityId,
  resolveNeighborhoodId,
  resolveRegionId,
} from '../../services/geoQueryService';
import {
  findHomeSections,
  HOME_SECTION_ITEM_LIMIT,
  type HomeScope,
} from '../../db/home/homeSectionsRepository';

/** A query value as Express hands it over. */
type RawQueryValue = string | string[] | undefined;

function asString(value: RawQueryValue): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function asFiniteNumber(value: RawQueryValue): number | undefined {
  const raw = asString(value);
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const OFFERING_VALUES = new Set<string>(Object.values(OfferingType));

/**
 * The offering the sections answer for.
 *
 * Defaults to long-term rent, which is the platform's default browse mode. An
 * INVALID value falls back to the same default rather than 400-ing: an unknown
 * offering is a client that is older or newer than this build, and the honest
 * answer to "show me homes" is the default feed, not an error page.
 */
function parseOffering(value: RawQueryValue): OfferingType {
  const raw = asString(value)?.toLowerCase();
  return raw !== undefined && OFFERING_VALUES.has(raw)
    ? (raw as OfferingType)
    : OfferingType.LONG_TERM_RENT;
}

/** How many listings per section, capped so one request cannot ask for the catalogue. */
function parseLimit(value: RawQueryValue): number {
  const parsed = asFiniteNumber(value);
  if (parsed === undefined) return HOME_SECTION_ITEM_LIMIT;
  return Math.max(1, Math.min(HOME_SECTION_ITEM_LIMIT, Math.floor(parsed)));
}

/** What a scope resolution produced: predicates plus the echo describing them. */
interface ResolvedScope {
  scope: HomeScope;
  location: HomeLocationSummary;
}

/**
 * A scope this endpoint cannot serve, with a machine-readable code.
 *
 * `status` distinguishes the two kinds, and the distinction is what the client's
 * retry predicate reads: a **400** means "this scope is not acceptable", which no
 * amount of retrying will change, and a **503** means "the gateway could not
 * answer just now", which is exactly what a retry is for. Collapsing them is how
 * a browser fires the same doomed request four times.
 */
class HomeScopeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'HomeScopeError';
    this.code = code;
    this.status = status;
  }
}

/** The radius applied when an external place has a centre but no extent. */
const EXTERNAL_POINT_RADIUS_METERS = 25_000;

/**
 * The place types Homiio can narrow by a canonical ID.
 *
 * ## This is a fact about the geo tables, NOT a list of what Home accepts
 *
 * That distinction is the whole of this change, and getting it wrong cost three
 * production 400s. `addresses` carries a city id, a region id and a neighborhood
 * id, so those three can be scoped exactly by identity and need no geometry. The
 * previous revision used this same set as a REFUSAL GATE, checked before the
 * source and before any geometry, so a `district` with a perfectly usable
 * bounding box was refused for the unrelated reason that no `addresses.district_id`
 * column exists.
 *
 * **Bounds are a complete scope on their own and need no id.** So this set now
 * decides only whether the fast id path is available; everything else falls
 * through to {@link resolvePlaceScope}, which is why adding a seventh place type
 * can no longer produce a 400 by omission.
 */
const ID_SCOPED_PLACE_TYPES: ReadonlySet<string> = new Set(['city', 'region', 'neighborhood']);

/** The reader's language, for the geocoder's own labels. Same shape as `geoController`. */
function languageOf(req: Request): string {
  const header = req.headers['accept-language'];
  return parseLanguage(undefined, typeof header === 'string' ? header : undefined);
}

/**
 * Scope by a place Homiio cannot narrow by id — which is most of them.
 *
 * ## The defects this repairs, which reached production THREE times
 *
 * `city.osm.R347950` answered **400** because the branch refused any non-Homiio
 * source; `district.osm.R3765380` answered **400** because a placeType gate ran
 * BEFORE this resolver and refused anything outside {city, region, neighborhood}.
 * Neither token is exotic input: the picker resolves through the #351 geo
 * gateway, whose candidates are external and can be any of the six `PlaceType`
 * members. The location ladder kept handing Home scopes Home refused.
 *
 * The common cause was a gate at the wrong level. The id-lookup list is a fact
 * about the geo TABLES; it is not a statement about which requests are
 * answerable, because **bounds are a complete scope on their own**. So this
 * function now serves every external ref of any type, plus Homiio's own
 * `country`, `district` and `postcode`.
 *
 * ## Four rungs, and the order is the point
 *
 *  1. **The canonical Homiio place.** An id survives a provider swap where a
 *     provider ref is only as stable as the provider, so a Homiio city is always
 *     the better scope when one matches. The gateway's own bbox is passed as a
 *     HARD filter, which is what stops "Barcelona, Catalonia" resolving to
 *     "Barcelona, Anzoátegui": the candidate has to sit inside the box the
 *     geocoder returned. An AMBIGUOUS result deliberately falls through rather
 *     than picking one — auto-picking a homonym is the bug ADR 0002 §7 names.
 *  2. **The place's own geometry.** `cities` is seeded from Homiio's own data
 *     and does not cover the world, so a real place the geocoder found perfectly
 *     well may have no row here. Refusing at that point sends the user back to
 *     the picker to choose the same place again, forever. Its bounds ARE the
 *     area they picked, and they are what `/api/properties/search` already
 *     scopes an external place by (`usePropertySearch.locationParams` →
 *     `geometryParams`) — two surfaces disagreeing about one selection is the
 *     bug class this epic removes.
 *  3. **`unresolved`.** Only when the gateway cannot name the place at all, or
 *     names one with no geometry and no Homiio match. Never a 400 and never a
 *     widening: the client renders the picker, as it already does.
 */
async function resolvePlaceScope(
  ref: Extract<LocationRef, { kind: 'place' }>,
  token: string,
  language: string,
): Promise<ResolvedScope> {
  // The REQUESTED identity, echoed unchanged. The client compares this against
  // its own `locationKey(selection)`, which is built from what it asked for;
  // echoing the Homiio id we resolved TO would read as "the server applied a
  // different scope".
  const key = locationKeyOfRef(ref);
  const unresolved: ResolvedScope = {
    scope: {},
    location: {
      status: 'unresolved',
      // `param` is the search endpoint's vocabulary, which has three values; a
      // `district` or `postcode` has no name in it, so it reports as the nearest
      // truthful one rather than inventing a fourth the client cannot read.
      requested: { param: ref.placeType === 'region' ? 'state' : 'city', value: ref.id },
    },
  };

  let place: GeoPlace | null;
  try {
    const result = await resolvePlace(token, language);
    place = result.place ?? null;
  } catch (error) {
    // A gateway that cannot answer is NOT "no such place". Reporting it as
    // `unresolved` would tell somebody their city does not exist because a
    // provider was rate-limited, and would make a retryable failure look final.
    logger.warn('home.sections.geocoder_unavailable', {
      locationKey: key,
      error: error instanceof Error ? error.message : 'unknown',
    });
    throw new HomeScopeError(
      'GEOCODER_UNAVAILABLE',
      'That place could not be looked up just now. Try again.',
      503,
    );
  }

  if (!place) return unresolved;

  // 1. A COUNTRY is scoped by its CODE, never by its bounds.
  //
  //    Deliberate, and the alternative is the trap. `addresses.country_code` is
  //    NOT NULL and indexed, so an equality on it is exact and cheap — whereas a
  //    country's bounding box is a terrible scope for exactly the countries
  //    people search: France's OSM extent includes French Guiana and the Pacific
  //    territories, and the United States' spans the Aleutians to the Virgin
  //    Islands. Either box is most of the planet, so scoping by it would produce
  //    a de-facto global feed under a country's name — ADR §1.3(d)'s "named
  //    heading over a global list", reintroduced by a rung meant to prevent it.
  //
  //    Keyed on the REF's type rather than the resolved place's: the token is
  //    what the user asked for, and a gateway that answered with a different
  //    type should not silently change the scope's shape.
  if (ref.placeType === 'country') {
    const countryCode = place.admin.countryCode.trim().toUpperCase();
    if (countryCode.length === 0) return unresolved;
    return { scope: { countryCode }, location: { status: 'resolved', key } };
  }

  // 2. The canonical Homiio place.
  const lookup = await lookupCityPlaces({
    token: place.label.primary,
    countryCode: place.admin.countryCode,
    // NO `limit: 1`. Capping a lookup that can match several rows turns a
    // genuinely ambiguous answer into a confident wrong one — the #295 bug, and
    // `placeLookup` says so at the one `.limit()` it has.
    ...(place.bounds ? { bounds: place.bounds } : {}),
    ...(place.precision === 'area' ? {} : { near: place.center }),
  });
  if (lookup.status === 'resolved') {
    return { scope: { cityId: lookup.place.id }, location: { status: 'resolved', key } };
  }

  // 3. The place's own geometry.
  if (place.bounds) {
    return {
      scope: {
        boundingBox: {
          swLat: place.bounds.south,
          swLng: place.bounds.west,
          neLat: place.bounds.north,
          neLng: place.bounds.east,
        },
      },
      location: { status: 'resolved', key, bounds: place.bounds },
    };
  }
  if (place.precision !== 'area') {
    return {
      scope: {
        centerRadius: {
          lat: place.center.latitude,
          lng: place.center.longitude,
          radiusMeters: EXTERNAL_POINT_RADIUS_METERS,
        },
      },
      location: { status: 'resolved', key, radiusMeters: EXTERNAL_POINT_RADIUS_METERS },
    };
  }

  // 4. Named, but unframeable and unmatched. There is genuinely nothing to
  //    scope by, and answering anyway would answer globally.
  return unresolved;
}

/**
 * Turn a parsed `loc` ref into predicates and an echo.
 *
 * Only the scopes Homiio can actually narrow by are accepted. A `country.` or
 * `postcode.` token is REFUSED rather than dropped, because dropping it is how a
 * named scope becomes a global page under that name's heading — the failure ADR
 * §1.3(d) records the home screen shipping for months.
 */
async function resolveScope(
  ref: LocationRef,
  token: string,
  language: string,
  query: Record<string, RawQueryValue>,
): Promise<ResolvedScope> {
  const key = locationKeyOfRef(ref);

  switch (ref.kind) {
    case 'bounds':
      return {
        scope: {
          boundingBox: {
            swLat: ref.bounds.south,
            swLng: ref.bounds.west,
            neLat: ref.bounds.north,
            neLng: ref.bounds.east,
          },
        },
        location: { status: 'resolved', key, bounds: ref.bounds },
      };

    case 'device': {
      const lat = asFiniteNumber(query.lat);
      const lng = asFiniteNumber(query.lng);
      if (lat === undefined || lng === undefined) {
        // The token carries no coordinates BY DESIGN, so the caller must supply
        // them. Silently answering globally here would turn "near me, but the
        // position did not arrive" into "everywhere", which is precisely the
        // degradation `here.` was designed to make impossible in a URL.
        throw new HomeScopeError(
          'MISSING_DEVICE_POSITION',
          'A here.<radius> scope needs lat and lng in the request. The token carries no coordinates by design.',
        );
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new HomeScopeError('INVALID_DEVICE_POSITION', 'lat must be within ±90 and lng within ±180.');
      }
      return {
        scope: { centerRadius: { lat, lng, radiusMeters: ref.radiusMeters } },
        // NO coordinates in the echo: it is logged and cached, and `here:<r>` is
        // what `locationKeyOfRef` emits precisely so it cannot carry one.
        location: { status: 'resolved', key, radiusMeters: ref.radiusMeters },
      };
    }

    case 'place': {
      // The ID FAST PATH, and it is only a fast path: a Homiio-sourced ref of a
      // type that has an id column is scoped exactly, with no geocoder call.
      // Everything else — every external ref, and a Homiio `country`, `district`
      // or `postcode` — falls through to the geometry resolver rather than being
      // refused. A type Homiio cannot narrow BY ID is not a type Home cannot
      // answer.
      if (ref.source.kind !== 'homiio' || !ID_SCOPED_PLACE_TYPES.has(ref.placeType)) {
        return resolvePlaceScope(ref, token, language);
      }
      if (ref.placeType === 'city') {
        const cityId = await resolveCityId(ref.id);
        if (!cityId) {
          return {
            scope: {},
            location: { status: 'unresolved', requested: { param: 'city', value: ref.id } },
          };
        }
        return { scope: { cityId }, location: { status: 'resolved', key } };
      }
      if (ref.placeType === 'region') {
        const regionId = await resolveRegionId(ref.id);
        if (!regionId) {
          return {
            scope: {},
            location: { status: 'unresolved', requested: { param: 'state', value: ref.id } },
          };
        }
        return { scope: { regionId }, location: { status: 'resolved', key } };
      }
      if (ref.placeType === 'neighborhood') {
        const neighborhoodId = await resolveNeighborhoodId(ref.id);
        if (!neighborhoodId) {
          return {
            scope: {},
            location: { status: 'unresolved', requested: { param: 'neighborhood', value: ref.id } },
          };
        }
        return { scope: { neighborhoodId }, location: { status: 'resolved', key } };
      }
      // Unreachable: the guard above sends every type outside
      // `ID_SCOPED_PLACE_TYPES` to `resolvePlaceScope`, and the three that
      // remain each return. Kept as an exhaustiveness guard so adding a fourth
      // id-scoped type without a branch fails loudly HERE rather than silently
      // taking the geometry path — which would still answer, just less exactly.
      return resolvePlaceScope(ref, token, language);
    }

    case 'multi':
      // A multi-area scope would need the covering box, which is a SUPERSET of
      // what the user asked for — the silent widening ADR §4.3 forbids. Refusing
      // is the honest answer until Home has a real multi-area design.
      throw new HomeScopeError('UNSUPPORTED_LOCATION', 'Home does not accept a multi-area scope yet.');

    default: {
      const exhaustive: never = ref;
      return exhaustive;
    }
  }
}

export async function getHomeSections(req: Request, res: Response): Promise<void> {
  const query = req.query as Record<string, RawQueryValue>;
  const loc = asString(query.loc);
  const offering = parseOffering(query.offering);
  const limit = parseLimit(query.limit);

  let scope: HomeScope = {};
  let location: HomeLocationSummary = { status: 'none' };

  if (loc !== undefined) {
    const parsed = parseLocationToken(loc);
    if (!parsed.ok) {
      // A broken token is a FAILURE, never an absence. 400 rather than a global
      // page, so a caller cannot mistake one for the other.
      res.status(400).json({
        success: false,
        message: 'The loc token could not be read.',
        error: 'INVALID_LOCATION_TOKEN',
        reason: parsed.reason,
      });
      return;
    }
    try {
      const resolved = await resolveScope(parsed.value, loc, languageOf(req), query);
      scope = resolved.scope;
      location = resolved.location;
    } catch (error) {
      if (error instanceof HomeScopeError) {
        // `status` decides whether the client may retry — see the class comment.
        res.status(error.status).json({ success: false, message: error.message, error: error.code });
        return;
      }
      throw error;
    }
  }

  // ONE timestamp for the envelope and every section in it — see the field's
  // note on `HomeSectionsQuery`.
  const generatedAt = new Date().toISOString();
  const sections = await findHomeSections({ offering, scope, location, limit, generatedAt });

  // Logged by KEY, never by `req.query`: the device branch of the request
  // carries a full-precision position and ADR §8.2 keeps it out of every log
  // line. `locationKeyOfRef` has no coordinate to emit for `here.`.
  logger.info('home.sections', {
    locationKey: location.status === 'resolved' ? location.key : location.status,
    offering,
    sections: sections.length,
  });

  // `Record<string, unknown>` because that is what `serializeProperty` returns;
  // the wire shape is `Property` and the frontend parses it as such. See the
  // `SerializedProperty` note in the repository.
  const payload: HomeSectionsResponse<Record<string, unknown>> = { location, generatedAt, sections };

  res.json({ success: true, data: payload });
}
