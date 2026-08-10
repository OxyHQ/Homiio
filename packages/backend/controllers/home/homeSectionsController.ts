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
  type HomeLocationSummary,
  type HomeSectionsResponse,
  type LocationRef,
} from '@homiio/shared-types';

import { logger } from '../../middlewares/logging';
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

/** A 400 the caller must render, with a machine-readable code. */
class HomeScopeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HomeScopeError';
    this.code = code;
  }
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
      if (ref.source.kind !== 'homiio') {
        throw new HomeScopeError(
          'UNSUPPORTED_LOCATION',
          'An external place ref cannot scope Home yet. Resolve it to a Homiio place first.',
        );
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
      throw new HomeScopeError(
        'UNSUPPORTED_LOCATION',
        `Home cannot scope by ${ref.placeType}. Supported: city, region, neighborhood, bbox, here.`,
      );
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
      const resolved = await resolveScope(parsed.value, query);
      scope = resolved.scope;
      location = resolved.location;
    } catch (error) {
      if (error instanceof HomeScopeError) {
        res.status(400).json({ success: false, message: error.message, error: error.code });
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
