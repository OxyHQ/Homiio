/**
 * The ingest path: what a CLIENT sends, and what the sink actually records.
 *
 * The client already redacts before it posts. That is not a reason for the
 * server to trust the result — an old bundle, a modified bundle, or something
 * that is not our client at all reaches the same public route — so the server
 * redacts again, and this file asserts on the transport's side of that second
 * pass. It is the strongest available form of "inspect the final payload":
 * everything upstream of this point could be wrong and these assertions would
 * still be about the bytes that get recorded.
 *
 * The requests are exercised through the real Express app, not through the
 * controller function, so the route's mounting, its body parser and its status
 * contract are all part of what is verified.
 */

import express from 'express';
import bodyParser from 'body-parser';
import request from 'supertest';

import {
  OBSERVABILITY_SCHEMA_VERSION,
  type ObservabilityEvent,
} from '@homiio/shared-types';

import { createIngestEventsHandler } from '../../controllers/observabilityController';
import { ingestObservabilityEvents } from '../../observability/serverObservability';

function appWithCapture(maxEvents = 20): {
  app: express.Express;
  captured: ObservabilityEvent[];
} {
  const captured: ObservabilityEvent[] = [];
  const app = express();
  app.use(bodyParser.json({ limit: '1mb' }));
  app.post(
    '/api/observability/events',
    createIngestEventsHandler({
      transport: (event) => captured.push(event),
      maxEvents,
    }),
  );
  return { app, captured };
}

/** A well-formed client event, envelope stamps and all. */
const CLIENT_EVENT = {
  event: 'map_area_search_committed',
  schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
  occurredAt: 1_770_000_000_000,
  surface: 'ios',
  sessionId: 'abcdef0123456789',
  queryId: '0123456789abcdef',
  previousQueryId: 'fedcba9876543210',
  countryCode: 'ES',
  areaBucketKm2: '100-1000',
  zoomBucket: 'city',
  crossesAntimeridian: false,
  priorScopeCleared: true,
} as const;

describe('POST /api/observability/events', () => {
  it('records a well-formed client event verbatim, keeping its own surface and clock', () => {
    const { app, captured } = appWithCapture();

    return request(app)
      .post('/api/observability/events')
      .send({ events: [CLIENT_EVENT] })
      .expect(202)
      .then((response) => {
        expect(response.body.data.accepted).toBe(1);
        expect(response.body.data.refused).toBe(0);
        expect(captured).toHaveLength(1);
        // A phone's event relabelled `server` would be a lie about where it
        // happened, so ingest preserves the client's surface and instant.
        expect(captured[0]).toEqual({ ...CLIENT_EVENT });
      });
  });

  it('refuses a client event carrying an exact address, and still answers 202', () => {
    const { app, captured } = appWithCapture();

    return request(app)
      .post('/api/observability/events')
      .send({
        events: [{ ...CLIENT_EVENT, address: 'Carrer de Mallorca 401, 08013 Barcelona' }],
      })
      .expect(202)
      .then((response) => {
        // The STATUS never carries the verdict: a 4xx here teaches a client to
        // retry, and a retry loop driven by telemetry is a self-inflicted
        // outage. The body reports it instead.
        expect(captured).toEqual([]);
        expect(response.body.data.accepted).toBe(0);
        expect(response.body.data.refused).toBe(1);
        expect(response.body.data.violationsByCode).toMatchObject({ sensitive_value: 1 });
      });
  });

  it('refuses exact coordinates smuggled through the wire', () => {
    const { app, captured } = appWithCapture();

    return request(app)
      .post('/api/observability/events')
      .send({ events: [{ ...CLIENT_EVENT, lat: 41.38743, lng: 2.1686 }] })
      .expect(202)
      .then(() => {
        expect(captured).toEqual([]);
      });
  });

  it('never echoes the offending value back to the caller', () => {
    const { app } = appWithCapture();

    return request(app)
      .post('/api/observability/events')
      .send({ events: [{ ...CLIENT_EVENT, reviewBody: 'The landlord kept the deposit' }] })
      .expect(202)
      .then((response) => {
        // The response body is the one place a rejected value could come back
        // out — into a client log, a proxy log, or a screenshot.
        expect(JSON.stringify(response.body)).not.toContain('landlord');
        expect(JSON.stringify(response.body)).not.toContain('deposit');
      });
  });

  it('accepts the good events in a mixed batch and refuses only the bad ones', () => {
    const { app, captured } = appWithCapture();

    return request(app)
      .post('/api/observability/events')
      .send({
        events: [
          CLIENT_EVENT,
          { ...CLIENT_EVENT, contactPhone: '+34600123456' },
          { ...CLIENT_EVENT, queryId: 'not-an-opaque-id' },
        ],
      })
      .expect(202)
      .then((response) => {
        // A broken event must not cost a client its good ones — otherwise a
        // single client bug erases a whole cohort's telemetry.
        expect(captured).toHaveLength(1);
        expect(response.body.data.accepted).toBe(1);
        expect(response.body.data.refused).toBe(2);
      });
  });

  it('caps a batch rather than accepting an unbounded one, and reports the overflow', () => {
    const { app, captured } = appWithCapture(2);

    return request(app)
      .post('/api/observability/events')
      .send({ events: [CLIENT_EVENT, CLIENT_EVENT, CLIENT_EVENT, CLIENT_EVENT] })
      .expect(202)
      .then((response) => {
        expect(captured).toHaveLength(2);
        expect(response.body.data.overflowed).toBe(2);
      });
  });

  it('answers 202 for a body that is not a batch at all', () => {
    const { app, captured } = appWithCapture();

    return request(app)
      .post('/api/observability/events')
      .send({ nonsense: true })
      .expect(202)
      .then((response) => {
        expect(captured).toEqual([]);
        expect(response.body.data.accepted).toBe(0);
      });
  });
});

describe('ingestObservabilityEvents', () => {
  it('never throws, whatever it is handed', () => {
    const inputs: unknown[] = [undefined, null, 'a string', 42, {}, [null, 'x', 7]];

    for (const input of inputs) {
      expect(() =>
        ingestObservabilityEvents(input, { transport: () => {}, maxEvents: 10 }),
      ).not.toThrow();
    }
  });

  it('counts a throwing transport as a refusal instead of propagating it', () => {
    const outcome = ingestObservabilityEvents([CLIENT_EVENT], {
      transport: () => {
        throw new Error('sink unavailable');
      },
      maxEvents: 10,
    });

    expect(outcome.accepted).toBe(0);
    expect(outcome.refused).toBe(1);
  });
});
