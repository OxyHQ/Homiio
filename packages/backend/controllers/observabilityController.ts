/**
 * Ingest for client-originated observability events (#350).
 *
 * PUBLIC AND UNAUTHENTICATED, deliberately. The most important events in the
 * vocabulary happen before anybody signs in — the permission prompt on first
 * open, the first search, the fallback after a geocoder failure — and requiring
 * a session would leave exactly the cold-start path this exists to observe
 * unobserved. Nothing here reads `req.user`, and the events carry no identity:
 * `sessionId` is a rotating opaque reference the client mints and the
 * `opaqueId` field kind refuses a user id outright.
 *
 * It inherits `server.ts`'s global `/api` rate limiter, which keys anonymous
 * traffic on a salted HMAC of the client IP, so the route needs no limiter of
 * its own.
 *
 * ALWAYS ANSWERS 202. A telemetry endpoint that returns 4xx or 5xx teaches a
 * client to retry, and a retry loop driven by telemetry is an outage this
 * service inflicted on itself. The body reports what was accepted and what was
 * refused so a client (and a test) can see the difference; the STATUS never
 * carries that information.
 */

import type { Request, Response } from 'express';

import { successResponse } from '../middlewares/errorHandler';
import config from '../config';
import {
  defaultIngestOptions,
  ingestObservabilityEvents,
  type ObservabilityIngestOptions,
} from '../observability/serverObservability';

/**
 * `POST /api/observability/events`
 *
 * Body: `{ "events": [ <flat event>, ... ] }`. Anything else — a bare array, a
 * string, a missing key — yields `accepted: 0` rather than an error, for the
 * reason in the module header.
 *
 * A FACTORY rather than a bare handler with an optional third parameter: this
 * is mounted through `asyncHandler`, so Express would pass `next` as that third
 * argument and the "default" would never be reached. The seam has to be closed
 * over, not defaulted.
 */
export function createIngestEventsHandler(
  options?: ObservabilityIngestOptions,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    // Resolved per call when not injected, so `config` is read after dotenv and
    // a test that changes the flag does not need to reload the module.
    const resolved = options ?? defaultIngestOptions();

    const body: unknown = req.body;
    const events =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>).events
        : undefined;

    const outcome = ingestObservabilityEvents(events, resolved);

    res.status(202).json(
      successResponse(
        {
          accepted: outcome.accepted,
          refused: outcome.refused,
          overflowed: outcome.overflowed,
          // Codes and counts. A caller learns THAT something was refused and
          // under which rule, never which value tripped it.
          violationsByCode: outcome.violationsByCode,
          recording: config.observability.enabled,
        },
        'Accepted',
      ),
    );
  };
}

/** The handler `routes/public.ts` mounts. */
export const ingestEvents = createIngestEventsHandler();

export default { createIngestEventsHandler, ingestEvents };
