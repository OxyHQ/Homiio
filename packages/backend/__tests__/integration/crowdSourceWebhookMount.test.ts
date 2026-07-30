/**
 * The webhook receiver reads the bytes that arrived, or it reads nothing.
 *
 * A CrowdSource webhook signature covers the raw request body. Once a JSON
 * parser has consumed the stream those bytes no longer exist, and a receiver
 * mounted behind one can only ever verify a signature over a re-serialisation —
 * which is not the same string.
 *
 * `server.ts` mounts `/webhooks` before every body parser. Nothing about that
 * ordering is enforced by a type, a lint rule or a test framework, so it is
 * enforced here.
 *
 * ## The assertion has to be "no parser ran", not "verification worked"
 *
 * Whether a late mount fails LOUDLY or SILENTLY is decided by middleware this
 * integration does not own, and all three arrangements exist across the Oxy
 * apps. `readRawBody` in `@oxyhq/crowdsource-express` prefers a Buffer on
 * `req.rawBody`: an app using `express.json({ verify })` leaves one, so a late
 * mount VERIFIES the parser's bytes, answers 200 and looks perfect — the guard
 * could be deleted and nothing would break.
 *
 * **Homiio is the loud case, and that was checked rather than assumed.**
 * `server.ts` builds its parsers as plain `bodyParser.json({ limit: '1mb' })`
 * with no `verify` hook, and the only `req.rawBody` assignment in the file is
 * inside the Stripe route, from `bodyParser.raw`, scoped to
 * `/api/billing/webhook`. So nothing hands this route a Buffer and a late mount
 * refuses every delivery. Confirmed behaviourally too: mounting the parser first
 * in the app below fails five of these tests.
 *
 * That is a property of today's `server.ts`, not of the invariant — add a
 * `verify` hook for some unrelated reason and Homiio becomes the silent case
 * overnight. So the assertion below is `typeof req.body === 'undefined'`, which
 * proves NO PARSER RAN. Asserting that verification failed would only be true in
 * the arrangement Homiio happens to have today.
 */

import express, { type Express, type Request } from 'express';
import bodyParser from 'body-parser';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { caseDecidedEventFixture, signWebhookDelivery } from '@oxyhq/crowdsource-testing';

import { createCrowdSourceWebhookRoutes } from '../../routes/crowdSourceWebhook';
import ModerationEvent from '../../models/ModerationEvent';
import ModerationOutbox from '../../models/ModerationOutbox';
import { decisionApplyEventId } from '../../services/moderation/ModerationOutboxService';

/** Must match what `__tests__/jest.setup.ts` puts in the environment. */
const WEBHOOK_SECRET = 'test-webhook-secret-at-least-16-chars';

/**
 * The app in the SAME order `server.ts` uses: webhook first, parsers after.
 *
 * A probe sits between them and records what `req.body` looked like when the
 * request reached the webhook mount point. `server.ts` itself cannot be
 * imported here — it opens a listener and a database connection on import — so
 * the ordering is reproduced rather than executed, and the assertion below is
 * about the ordering rather than about this file.
 */
function buildApp(observed: { body: unknown }): Express {
  const app = express();
  app.use('/webhooks', (req: Request, _res, next) => {
    observed.body = req.body;
    next();
  });
  app.use('/webhooks', createCrowdSourceWebhookRoutes());
  app.use(bodyParser.json({ limit: '1mb' }));
  return app;
}

/**
 * A delivery signed the way CrowdSource signs one.
 *
 * Signed by `@oxyhq/crowdsource-testing`, never by a local HMAC written to match
 * the verifier. A hand-rolled signer is a second definition of what gets signed,
 * and the two get "corrected" until they agree with each other and both disagree
 * with the service — at which point the test proves the receiver accepts what
 * this file produces and nothing about what production will send.
 */
function signedDelivery(event: unknown): { body: string; headers: Record<string, string> } {
  const signed = signWebhookDelivery({ secret: WEBHOOK_SECRET, event });
  return { body: signed.body, headers: { ...signed.headers } };
}

/**
 * A delivery envelope the contract accepts.
 *
 * Every event carries tenant and timing fields, not just an id and a type — a
 * receiver that is handed less answers `malformed_event`, which is the contract
 * being strict about the one part of the payload it is strict about. Built from
 * the published fixture so the shape cannot drift away from what the service
 * sends.
 */
function envelope(overrides: {
  id: string;
  type: string;
  data: Record<string, unknown>;
}): Record<string, unknown> {
  const fixture = caseDecidedEventFixture({ id: overrides.id }) as unknown as Record<
    string,
    unknown
  >;
  return { ...fixture, type: overrides.type, data: overrides.data };
}

describe('crowdsource webhook mount', () => {
  /**
   * The one assertion about the REAL `server.ts`, rather than about the order
   * this file reproduces.
   *
   * Everything else here builds its own app, which proves the receiver behaves
   * correctly when it is mounted first — and would keep passing forever if
   * somebody moved the mount in `server.ts` below a body parser. Reading the
   * source is crude, but the invariant IS an ordering of two lines in one file,
   * and no type or lint rule expresses it.
   *
   * The two `toBeGreaterThan(-1)` assertions are the vacuity floor: a renamed
   * mount or a switch away from `bodyParser` makes both indices `-1`, and
   * `-1 < -1` is false — so the comparison alone could never quietly start
   * passing for the wrong reason.
   */
  it('is mounted ahead of every body parser in server.ts', () => {
    const server = readFileSync(join(__dirname, '..', '..', 'server.ts'), 'utf8');
    const webhookMount = server.indexOf("app.use('/webhooks'");
    const firstParser = server.search(/bodyParser\.(json|raw|urlencoded)\(/);

    expect(webhookMount).toBeGreaterThan(-1);
    expect(firstParser).toBeGreaterThan(-1);
    expect(webhookMount).toBeLessThan(firstParser);
  });

  /**
   * A vacuity floor. Every assertion below is about what the ROUTE did, and an
   * unmounted route answers 404 to all of them — which would read as "refused
   * correctly" for the forged-signature test and hide the rest behind a missing
   * secret. This fails first and names the cause.
   */
  it('is mounted at all', async () => {
    const observed: { body: unknown } = { body: 'never set' };
    const res = await request(buildApp(observed)).post('/webhooks/crowdsource').send('{}');
    expect(process.env.CROWDSOURCE_WEBHOOK_SECRET).toBe(WEBHOOK_SECRET);
    expect(res.status).not.toBe(404);
  });

  it('reaches the route with an unparsed body', async () => {
    const observed: { body: unknown } = { body: 'never set' };
    const delivery = signedDelivery(
      envelope({ id: 'evt_mount_probe', type: 'case.created', data: { caseId: 'case_1' } }),
    );

    await request(buildApp(observed))
      .post('/webhooks/crowdsource')
      .set(delivery.headers)
      .send(delivery.body);

    // `undefined`, not `{}`. Express only defines `req.body` once a parser has
    // run, so this is the difference between "no parser touched it" and "a
    // parser ran and found nothing".
    expect(typeof observed.body).toBe('undefined');
  });

  it('records an unhandled event rather than dropping it', async () => {
    const observed: { body: unknown } = { body: 'never set' };
    const delivery = signedDelivery(
      envelope({ id: 'evt_case_created', type: 'case.created', data: { caseId: 'case_quiet' } }),
    );

    const res = await request(buildApp(observed))
      .post('/webhooks/crowdsource')
      .set(delivery.headers)
      .send(delivery.body);

    expect(res.status).toBeLessThan(300);

    // "Did CrowdSource tell us about this case, and when" is the first question
    // asked when a report looks stuck, so an event with nothing to enforce is
    // still written down.
    const event = await ModerationEvent.findById('evt_case_created').lean();
    expect(event).not.toBeNull();
    expect(event?.state).toBe('ignored');
    expect(event?.caseId).toBe('case_quiet');

    // …but no work is queued for it.
    expect(await ModerationOutbox.countDocuments({})).toBe(0);
  });

  /**
   * The half of a webhook test that actually proves something.
   *
   * A suite that only ever sends valid deliveries proves the receiver can say
   * yes. Each case below is a different way for a delivery to be wrong, and none
   * of them may leave a trace: a refused delivery that still wrote an event row
   * would let anyone who can reach the endpoint mint audit entries, and a
   * claimed event id can never be delivered again.
   */
  it.each([
    ['a signature from the wrong secret', { wrongSecret: 'a-different-secret-entirely' }],
    ['a timestamp outside the freshness window', { expired: true }],
    ['a body that does not match what was signed', { tamperedBody: '{"id":"evt_swapped"}' }],
    ['an outright forged signature', { signature: `sha256=${'0'.repeat(64)}` }],
  ])('refuses %s and records nothing', async (_name, overrides) => {
    const observed: { body: unknown } = { body: 'never set' };
    const event = envelope({
      id: 'evt_bad',
      type: 'case.created',
      data: { caseId: 'case_bad' },
    });

    /**
     * POSITIVE CONTROL, and it is the point of this test rather than decoration.
     *
     * A refusal assertion proves nothing unless the SAME request is otherwise
     * accepted: a 400 from the envelope failing to parse looks identical to a
     * 400 from the signature check, so a test built on a malformed event would
     * report a working signature guard that had never run. This delivers the
     * identical event, correctly signed, and requires it through.
     */
    const control = signWebhookDelivery({ secret: WEBHOOK_SECRET, event });
    const accepted = await request(buildApp(observed))
      .post('/webhooks/crowdsource')
      .set({ ...control.headers })
      .send(control.body);
    expect(accepted.status).toBeLessThan(300);
    expect(await ModerationEvent.countDocuments({})).toBe(1);
    await ModerationEvent.deleteMany({});

    const signed = signWebhookDelivery({
      secret: overrides.wrongSecret ?? WEBHOOK_SECRET,
      event,
      ...(overrides.expired ? { timestampSeconds: Math.floor(Date.now() / 1000) - 3_600 } : {}),
      ...(overrides.tamperedBody ? { tamperedBody: overrides.tamperedBody } : {}),
      ...(overrides.signature ? { signature: overrides.signature } : {}),
    });

    const res = await request(buildApp(observed))
      .post('/webhooks/crowdsource')
      .set({ ...signed.headers })
      .send(signed.body);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await ModerationEvent.countDocuments({})).toBe(0);
    expect(await ModerationOutbox.countDocuments({})).toBe(0);
  });

  /**
   * A decision is recorded and its application QUEUED, never applied inline.
   *
   * Applying it means reading listings, planning enforcement and writing several
   * collections; a receiver doing that inline times out under a burst and is
   * retried while the first attempt is still running.
   */
  it('queues a decision instead of applying it inline', async () => {
    const observed: { body: unknown } = { body: 'never set' };
    const event = caseDecidedEventFixture({ id: 'evt_decided', caseId: 'case_decided' });
    const delivery = signedDelivery(event);

    const res = await request(buildApp(observed))
      .post('/webhooks/crowdsource')
      .set(delivery.headers)
      .send(delivery.body);

    expect(res.status).toBeLessThan(300);

    const stored = await ModerationEvent.findById('evt_decided').lean();
    expect(stored?.state).toBe('queued');

    const outboxEvent = await ModerationOutbox.findById(
      decisionApplyEventId('evt_decided'),
    ).lean();
    expect(outboxEvent).not.toBeNull();
    expect(outboxEvent?.kind).toBe('decision.apply');
    expect(outboxEvent?.payload?.caseId).toBe('case_decided');
    /**
     * Stored WHOLE, not projected into columns. The decision document is loose
     * by design so a newer server can add to it, and a projection would silently
     * drop whatever it added — including a finding field the enforcement mapping
     * may later need.
     */
    expect(outboxEvent?.payload?.decision).toEqual(
      JSON.parse(JSON.stringify(event.data.decision)),
    );
  });

  /**
   * A `case.decided` whose decision this version cannot parse takes the
   * unhandled path — recorded, not queued, and above all not lost.
   *
   * Worth pinning because it is not the behaviour the receiver's own code
   * chooses: the middleware matches the event against the published union before
   * dispatching, so a payload that fails that match never reaches the
   * `case.decided` handler at all. A future contract change that alters a
   * decision's shape therefore lands here rather than in an exception, and the
   * event id is still on record for whoever goes looking.
   */
  it('records a decision it cannot recognise rather than dropping it', async () => {
    const observed: { body: unknown } = { body: 'never set' };
    const delivery = signedDelivery(
      envelope({
        id: 'evt_future',
        type: 'case.decided',
        data: { caseId: 'case_future', decision: { shape: 'from a newer server' } },
      }),
    );

    const res = await request(buildApp(observed))
      .post('/webhooks/crowdsource')
      .set(delivery.headers)
      .send(delivery.body);

    expect(res.status).toBeLessThan(300);
    const stored = await ModerationEvent.findById('evt_future').lean();
    expect(stored).not.toBeNull();
    expect(stored?.state).toBe('ignored');
    expect(await ModerationOutbox.countDocuments({})).toBe(0);
  });

  it('deduplicates a redelivery of the same event', async () => {
    const observed: { body: unknown } = { body: 'never set' };
    const delivery = signedDelivery(
      caseDecidedEventFixture({ id: 'evt_repeat', caseId: 'case_repeat' }),
    );
    const app = buildApp(observed);

    await request(app).post('/webhooks/crowdsource').set(delivery.headers).send(delivery.body);
    await request(app).post('/webhooks/crowdsource').set(delivery.headers).send(delivery.body);

    // One claim, one queued job — even though the delivery arrived twice.
    expect(await ModerationEvent.countDocuments({})).toBe(1);
    expect(await ModerationOutbox.countDocuments({})).toBe(1);
  });
});
