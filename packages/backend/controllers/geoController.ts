/**
 * `GET /api/geo/search | resolve | reverse` — the public geo contract
 * (ADR 0002 §14.1).
 *
 * The controller's job is narrow and worth stating, because the temptation is
 * to widen it: validate, call the gateway, map a typed failure onto a status
 * code, and observe the request without recording what was asked. It builds no
 * DTO (that is `normalize.ts`) and makes no provider decision (that is
 * `registry.ts`).
 *
 * ## Every failure keeps its identity all the way to the client
 *
 * A 429 answers 429, a timeout answers 504, an unavailable provider answers
 * 503, and none of them answers 200 with an empty list. The client needs to
 * distinguish them because the correct UI differs for each — "try again in 30
 * seconds" is not "no such place" — and because a screen that reads an empty
 * list as "nowhere matched" will happily drop the location filter and show a
 * global feed. That is the failure this contract exists to make impossible, so
 * it is enforced here rather than left to the caller's good judgement.
 */

import type { NextFunction, Request, Response } from 'express';

import { AppError, successResponse } from '../middlewares/errorHandler';
import {
  LocMalformedError,
  LocNotResolvableError,
  resolvePlace,
  reversePlace,
  searchPlaces,
  type GatewayMeta,
} from '../services/geocoding/gateway';
import { observeGeoRequest, type GeoOperation, type GeoOutcome } from '../services/geocoding/telemetry';
import { GeocodingProviderError } from '../services/geocoding/types';
import {
  GeoValidationError,
  parseCountryCode,
  parseLanguage,
  parseLimit,
  parseLocToken,
  parseNear,
  parseQueryText,
  parseReversePoint,
  parseTypes,
} from '../services/geocoding/validation';

/**
 * Map a typed failure onto a status, a code and a client-safe message.
 *
 * The message never names the provider or repeats the query: an error body is
 * one of the places an address most easily leaks, and naming the provider tells
 * an attacker which third party to probe.
 */
function toAppError(error: unknown): AppError {
  if (error instanceof GeoValidationError) {
    return new AppError(error.message, 400, error.code);
  }
  if (error instanceof LocMalformedError) {
    return new AppError('loc is not a valid location token', 400, 'INVALID_LOC');
  }
  if (error instanceof LocNotResolvableError) {
    // Well-formed, and names no place to look up. A 404 would assert that a
    // place the caller named does not exist, which is a different and false
    // claim about a token that carries its own geometry.
    return new AppError(
      'this loc token carries its own geometry and resolves to no place',
      400,
      'LOC_NOT_RESOLVABLE',
    );
  }
  if (error instanceof GeocodingProviderError) {
    switch (error.reason) {
      case 'rate_limited':
        return new AppError(
          'the geocoding provider is rate limiting; retry shortly',
          429,
          'GEO_RATE_LIMITED',
        );
      case 'timeout':
        return new AppError('the geocoding provider timed out', 504, 'GEO_TIMEOUT');
      case 'provider_unavailable':
      case 'invalid_response':
        return new AppError(
          'the geocoding provider is temporarily unavailable',
          503,
          'GEO_PROVIDER_UNAVAILABLE',
        );
      case 'invalid_request':
        return new AppError('the geocoding request was rejected', 400, 'GEO_INVALID_REQUEST');
    }
  }
  return new AppError('geocoding failed', 500, 'GEO_FAILED');
}

const outcomeFor = (error: unknown): GeoOutcome => {
  if (error instanceof GeoValidationError || error instanceof LocMalformedError) {
    return 'invalid_input';
  }
  if (error instanceof LocNotResolvableError) return 'invalid_input';
  if (error instanceof GeocodingProviderError) {
    switch (error.reason) {
      case 'rate_limited':
        return 'rate_limited';
      case 'timeout':
        return 'timeout';
      case 'invalid_response':
        return 'invalid_response';
      case 'provider_unavailable':
        return 'provider_unavailable';
      case 'invalid_request':
        return 'invalid_input';
    }
  }
  return 'error';
};

/**
 * The transport fields that ride ALONGSIDE the payload, inside `data`.
 *
 * They are in `data` and not in the envelope's `meta` for a measured reason:
 * the linked client auto-unwraps a `{ data, … }` body to just `body.data`, and
 * `utils/api.ts#normalizeEnvelope` then re-wraps that as
 * `{ success: true, data: payload }`. Anything placed in `meta` is DISCARDED in
 * transit — silently, with a perfectly valid-looking response arriving. The
 * attribution is a licence obligation, so losing it is not cosmetic.
 *
 * `degraded` tells a client a fallback answered so it can say results may be
 * incomplete, WITHOUT naming which provider fell over — that is internal detail
 * a public response has no business leaking.
 */
const transportFor = (result: GatewayMeta): Record<string, unknown> => ({
  degraded: result.degraded,
  cached: result.cacheHit,
  ...(result.attribution ? { attribution: result.attribution } : {}),
});

/** `Retry-After` is actionable; a client guessing a backoff is not. */
function applyRetryAfter(res: Response, error: unknown): void {
  if (error instanceof GeocodingProviderError && error.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(error.retryAfterSeconds));
  }
}

const acceptLanguageOf = (req: Request): string | undefined => {
  const header = req.headers['accept-language'];
  return typeof header === 'string' ? header : undefined;
};

/**
 * `GET /api/geo/search` — candidates for a typed query. ALWAYS a list.
 */
export async function search(req: Request, res: Response, next: NextFunction): Promise<void> {
  const startedAt = Date.now();
  const operation: GeoOperation = 'search';
  let queryLength: number | undefined;
  let countryCode: string | undefined;
  let types: readonly string[] | undefined;

  try {
    const query = parseQueryText(req.query.q);
    queryLength = query.length;
    countryCode = parseCountryCode(req.query.countryCode);
    const parsedTypes = parseTypes(req.query.types);
    types = parsedTypes;
    const near = parseNear(req.query.near);
    const limit = parseLimit(req.query.limit);
    const language = parseLanguage(req.query.language, acceptLanguageOf(req));

    const result = await searchPlaces({
      query,
      language,
      limit,
      ...(countryCode === undefined ? {} : { countryCode }),
      ...(parsedTypes === undefined ? {} : { types: parsedTypes }),
      ...(near === undefined ? {} : { near }),
    });

    observeGeoRequest({
      operation,
      outcome: result.candidates.length > 0 ? 'ok' : 'empty',
      durationMs: Date.now() - startedAt,
      queryLength,
      ...(countryCode === undefined ? {} : { countryCode }),
      ...(parsedTypes === undefined ? {} : { types: parsedTypes }),
      ...(result.providerId === undefined ? {} : { providerId: result.providerId }),
      cacheHit: result.cacheHit,
      degraded: result.degraded,
      resultCount: result.candidates.length,
    });

    res.json(
      successResponse({ candidates: result.candidates, ...transportFor(result) }, 'Places found'),
    );
  } catch (error) {
    observeGeoRequest({
      operation,
      outcome: outcomeFor(error),
      durationMs: Date.now() - startedAt,
      ...(queryLength === undefined ? {} : { queryLength }),
      ...(countryCode === undefined ? {} : { countryCode }),
      ...(types === undefined ? {} : { types }),
    });
    applyRetryAfter(res, error);
    next(toAppError(error));
  }
}

/**
 * `GET /api/geo/resolve` — the place a `loc` token names, or 404.
 *
 * Never a fallback: an unresolvable token is a failure the screen must show,
 * not an absence it may quietly ignore (ADR §5.2).
 */
export async function resolve(req: Request, res: Response, next: NextFunction): Promise<void> {
  const startedAt = Date.now();
  const operation: GeoOperation = 'resolve';
  let locKind: string | undefined;

  try {
    const token = parseLocToken(req.query.loc);
    // The KIND only — never the id, which for a Homiio place is a database
    // primary key and for an external one identifies a specific building.
    locKind = token.split('.')[0];
    const language = parseLanguage(req.query.language, acceptLanguageOf(req));

    const result = await resolvePlace(token, language);
    if (!result.place) {
      observeGeoRequest({
        operation,
        outcome: 'not_found',
        durationMs: Date.now() - startedAt,
        locKind,
      });
      next(new AppError('no place resolves that loc token', 404, 'PLACE_NOT_FOUND'));
      return;
    }

    observeGeoRequest({
      operation,
      outcome: 'ok',
      durationMs: Date.now() - startedAt,
      locKind,
      ...(result.providerId === undefined ? {} : { providerId: result.providerId }),
      cacheHit: result.cacheHit,
    });

    res.json(
      successResponse({ place: result.place, ...transportFor(result) }, 'Place resolved'),
    );
  } catch (error) {
    observeGeoRequest({
      operation,
      outcome: outcomeFor(error),
      durationMs: Date.now() - startedAt,
      ...(locKind === undefined ? {} : { locKind }),
    });
    applyRetryAfter(res, error);
    next(toAppError(error));
  }
}

/** `GET /api/geo/reverse` — the place a coordinate falls in. */
export async function reverse(req: Request, res: Response, next: NextFunction): Promise<void> {
  const startedAt = Date.now();
  const operation: GeoOperation = 'reverse';

  try {
    const point = parseReversePoint(req.query as Record<string, unknown>);
    const language = parseLanguage(req.query.language, acceptLanguageOf(req));

    const result = await reversePlace(point, language);
    if (!result.place) {
      observeGeoRequest({ operation, outcome: 'not_found', durationMs: Date.now() - startedAt });
      next(new AppError('no place found at those coordinates', 404, 'PLACE_NOT_FOUND'));
      return;
    }

    observeGeoRequest({
      operation,
      outcome: 'ok',
      durationMs: Date.now() - startedAt,
      ...(result.providerId === undefined ? {} : { providerId: result.providerId }),
      cacheHit: result.cacheHit,
      degraded: result.degraded,
      // The COUNTRY of the answer is safe and useful for spotting a provider
      // that has started answering nonsense; the coordinate is not, and is not
      // recorded at any precision.
      countryCode: result.place.admin.countryCode,
    });

    res.json(successResponse({ place: result.place, ...transportFor(result) }, 'Place found'));
  } catch (error) {
    observeGeoRequest({
      operation,
      outcome: outcomeFor(error),
      durationMs: Date.now() - startedAt,
    });
    applyRetryAfter(res, error);
    next(toAppError(error));
  }
}
