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
 * refuses every delivery. Confirmed behaviourally too, and re-measured after the
 * Postgres port rather than carried over: mounting the parser first in
 * `buildApp` below fails 13 of these 15 tests. The two survivors are the
 * `server.ts` source read (which does not use `buildApp`) and the "is mounted at
 * all" vacuity floor (which only asserts a non-404) — so the ordering is pinned
 * by the tests that exercise the route, not by the one that reads the file.
 *
 * That is a property of today's `server.ts`, not of the invariant — add a
 * `verify` hook for some unrelated reason and Homiio becomes the silent case
 * overnight. So the assertion below is `typeof req.body === 'undefined'`, which
 * proves NO PARSER RAN. Asserting that verification failed would only be true in
 * the arrangement Homiio happens to have today.
 *
 * ## Postgres, and what the port had to add
 *
 * The two tables are read with drizzle now, through
 * `db/moderation/moderationEventRepository` and
 * `db/moderation/moderationOutboxRepository` — the dedupe store the route
 * installs is `postgresProcessedEventStore()`, so the claim these tests exercise
 * is a real `INSERT … ON CONFLICT DO NOTHING … RETURNING` rather than an
 * in-process map. Every event id below is a FIXED string (`evt_bad`,
 * `evt_decided`, …) and `moderation_events.id` IS the dedupe key, so the
 * truncation in `beforeEach` is load-bearing: Mongo got it from `jest.setup.ts`'s
 * per-test collection wipe, and without an equivalent a row left by an earlier
 * test — or by an earlier FILE sharing this worker's database — would make the
 * receiver answer "already processed" and every count below measure history.
 */

import express, { Router, type Express, type Request } from 'express';
import bodyParser from 'body-parser';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { count } from 'drizzle-orm';
import {
  caseDecidedEventFixture,
  decisionFixture,
  signWebhookDelivery,
} from '@oxyhq/crowdsource-testing';

import { createCrowdSourceWebhookRoutes } from '../../routes/crowdSourceWebhook';
import { findModerationEvent } from '../../db/moderation/moderationEventRepository';
import { findModerationOutboxEvent } from '../../db/moderation/moderationOutboxRepository';
import { getDb } from '../../db/postgres';
import { moderationEvents, moderationOutbox } from '../../db/schema';
import { decisionApplyEventId } from '../../services/moderation/ModerationOutboxService';

/** Must match what `__tests__/jest.setup.ts` puts in the environment. */
const WEBHOOK_SECRET = 'test-webhook-secret-at-least-16-chars';
const PREVIOUS_SECRET = 'test-previous-secret-at-least-16-chars';

async function countEvents(): Promise<number> {
  const [row] = await getDb().select({ total: count() }).from(moderationEvents);
  return row.total;
}

async function countOutbox(): Promise<number> {
  const [row] = await getDb().select({ total: count() }).from(moderationOutbox);
  return row.total;
}

/**
 * The app in the SAME order `server.ts` uses: webhook first, parsers after.
 *
 * A probe sits between them and records what `req.body` looked like when the
 * request reached the webhook mount point. `server.ts` itself cannot be
 * imported here — it opens a listener and a database connection on import — so
 * the ordering is reproduced rather than executed, and the assertion below is
 * about the ordering rather than about this file.
 */
/**
 * The receiver, with the probe registered ON THE ROUTER rather than on the app.
 *
 * That distinction is the whole reliability of this file. A probe added to the
 * app after the router is mounted sits wherever it was added — so if the mount
 * later moved behind a parser, the probe would stay in front of it and keep
 * reporting an unparsed body in a configuration that is actually broken. Making
 * it the router's first handler means the probe travels WITH the mount: move the
 * router behind a parser and the probe moves behind it too, and observes exactly
 * what the real handler is about to be handed.
 */
function probedWebhookRouter(observed: { body: unknown }): Router {
  const router = Router();
  router.use((req: Request, _res, next) => {
    observed.body = req.body;
    next();
  });
  router.use(createCrowdSourceWebhookRoutes());
  return router;
}

function buildApp(observed: { body: unknown }): Express {
  const app = express();
  app.use('/webhooks', probedWebhookRouter(observed));
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

/** How one delivery is made wrong. Every field optional; a row sets exactly one. */
interface RefusalOverrides {
  readonly wrongSecret?: string;
  readonly expired?: boolean;
  readonly tamperedBody?: string;
  readonly signature?: string;
}

/**
 * Both tables emptied before each test.
 *
 * `moderation_events.id` IS the dedupe key and every id here is a fixed string,
 * so a surviving row would silently turn "recorded correctly" into "already
 * claimed" — and the `countEvents()`/`countOutbox()` assertions into statements
 * about the file's history. The outbox goes first only for symmetry with the
 * other moderation suites; it carries no foreign key to `moderation_events`
 * (deliberately — see `db/schema/moderation.ts`).
 */
beforeEach(async () => {
  const db = getDb();
  await db.delete(moderationOutbox);
  await db.delete(moderationEvents);
});

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
    const event = await findModerationEvent('evt_case_created');
    expect(event).toBeDefined();
    expect(event?.state).toBe('ignored');
    expect(event?.caseId).toBe('case_quiet');

    // …but no work is queued for it.
    expect(await countOutbox()).toBe(0);
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
  it.each<[string, RefusalOverrides, string]>([
    ['a signature from the wrong secret', { wrongSecret: 'a-different-secret-entirely' }, 'signature_mismatch'],
    ['a timestamp outside the freshness window', { expired: true }, 'timestamp_out_of_window'],
    ['a body that does not match what was signed', { tamperedBody: '{"id":"evt_swapped"}' }, 'signature_mismatch'],
    /**
     * Two distinct forgeries, because they exercise different code.
     *
     * A well-formed digest that is simply wrong reaches the constant-time
     * COMPARISON; a header in the wrong shape is refused while PARSING and never
     * gets there. The second was originally written as the only forgery case
     * (`sha256=` + zeroes) and answered `malformed_signature` — so it had never
     * tested the comparison at all, and would have survived deleting it.
     */
    ['a well-formed signature that is simply wrong', { signature: `v1=${'0'.repeat(64)}` }, 'signature_mismatch'],
    ['a signature header in the wrong shape', { signature: `sha256=${'0'.repeat(64)}` }, 'malformed_signature'],
  ])('refuses %s and records nothing', async (_name, overrides, expectedRejection) => {
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
    expect(await countEvents()).toBe(1);
    await getDb().delete(moderationEvents);

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
    /**
     * The REASON, not just the refusal. A delivery can be refused long before
     * the signature is ever compared — a missing event-id header answers
     * `missing_event_id`, an envelope the contract rejects answers
     * `malformed_event` — and a test asserting only "4xx" would survive deleting
     * the signature check entirely.
     */
    expect((res.body as { rejection?: string }).rejection).toBe(expectedRejection);
    expect(await countEvents()).toBe(0);
    expect(await countOutbox()).toBe(0);
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
    // The decision is built separately and handed to the fixture, so the
    // assertion below compares against a value of a known type rather than
    // reaching into `event.data` — which is a union across event types and does
    // not carry `decision` on every member.
    const decision = decisionFixture({ caseId: 'case_decided' });
    const delivery = signedDelivery(
      caseDecidedEventFixture({ id: 'evt_decided', caseId: 'case_decided', decision }),
    );

    const res = await request(buildApp(observed))
      .post('/webhooks/crowdsource')
      .set(delivery.headers)
      .send(delivery.body);

    expect(res.status).toBeLessThan(300);

    const stored = await findModerationEvent('evt_decided');
    expect(stored?.state).toBe('queued');

    const outboxEvent = await findModerationOutboxEvent(decisionApplyEventId('evt_decided'));
    expect(outboxEvent).toBeDefined();
    expect(outboxEvent?.kind).toBe('decision.apply');
    expect(outboxEvent?.payload.caseId).toBe('case_decided');
    /**
     * Stored WHOLE, not projected into columns. The decision document is loose
     * by design so a newer server can add to it, and a projection would silently
     * drop whatever it added — including a finding field the enforcement mapping
     * may later need.
     */
    expect(outboxEvent?.payload.decision).toEqual(JSON.parse(JSON.stringify(decision)));
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
    const stored = await findModerationEvent('evt_future');
    expect(stored).toBeDefined();
    expect(stored?.state).toBe('ignored');
    expect(await countOutbox()).toBe(0);
  });

  /**
   * Does HOMIIO pass its secret through, or do these tests only prove the SDK
   * can verify a signature?
   *
   * `configuredSecrets` in `@oxyhq/crowdsource-express` is
   * `options.secret ?? process.env.CROWDSOURCE_WEBHOOK_SECRET`, and
   * `jest.setup.ts` sets that variable — so deleting `secret:` from the route
   * leaves the SDK falling back to the identical value and **every other test in
   * this file stays green.** Measured, not assumed: with the pass-through
   * removed, all twelve passed.
   *
   * The discriminator is to make the two sources DISAGREE. `config` captured the
   * real secret at module load; moving `process.env` afterwards means only a
   * receiver reading its own configuration can still verify. A receiver leaning
   * on the environment now holds a different string and refuses.
   *
   * This is not a contrived arrangement — it is the production one. The
   * environment is where the secret comes FROM, config is the authority the
   * route reads, and the two diverging is exactly what a redeploy-less rotation
   * looks like.
   */
  it('verifies with the secret Homiio configured, not the SDK’s environment fallback', async () => {
    const observed: { body: unknown } = { body: 'never set' };
    const delivery = signedDelivery(
      envelope({ id: 'evt_passthrough', type: 'case.created', data: { caseId: 'case_pt' } }),
    );

    const realEnv = process.env.CROWDSOURCE_WEBHOOK_SECRET;
    process.env.CROWDSOURCE_WEBHOOK_SECRET = 'an-entirely-different-environment-secret';
    try {
      const res = await request(buildApp(observed))
        .post('/webhooks/crowdsource')
        .set(delivery.headers)
        .send(delivery.body);

      expect(res.status).toBeLessThan(300);
      // The side effect, not the status: a 200 that wrote nothing would agree
      // with a receiver that had verified nothing.
      expect(await findModerationEvent('evt_passthrough')).toBeDefined();
    } finally {
      process.env.CROWDSOURCE_WEBHOOK_SECRET = realEnv;
    }
  });

  /**
   * The rotation path, which otherwise runs for the first time in production
   * during a rotation somebody scheduled.
   *
   * Both secrets are accepted while one is being retired. Same environment
   * divergence as above, so this also proves `previousSecret` reaches the
   * middleware from Homiio's config rather than from the SDK's own
   * `CROWDSOURCE_WEBHOOK_SECRET_PREVIOUS` fallback.
   */
  it('accepts a delivery signed with the previous secret during a rotation', async () => {
    const observed: { body: unknown } = { body: 'never set' };
    const signed = signWebhookDelivery({
      secret: PREVIOUS_SECRET,
      event: envelope({ id: 'evt_rotating', type: 'case.created', data: { caseId: 'case_rot' } }),
    });

    const realEnv = process.env.CROWDSOURCE_WEBHOOK_SECRET_PREVIOUS;
    process.env.CROWDSOURCE_WEBHOOK_SECRET_PREVIOUS = 'an-entirely-different-previous-secret';
    try {
      const res = await request(buildApp(observed))
        .post('/webhooks/crowdsource')
        .set({ ...signed.headers })
        .send(signed.body);

      expect(res.status).toBeLessThan(300);
      expect(await findModerationEvent('evt_rotating')).toBeDefined();
    } finally {
      process.env.CROWDSOURCE_WEBHOOK_SECRET_PREVIOUS = realEnv;
    }
  });

  /**
   * And a secret that was never configured at all is still refused — otherwise
   * the two tests above would pass for a receiver that accepted anything.
   */
  it('refuses a delivery signed with a secret nobody configured', async () => {
    const observed: { body: unknown } = { body: 'never set' };
    const signed = signWebhookDelivery({
      secret: 'a-secret-this-deployment-has-never-held',
      event: envelope({ id: 'evt_stranger', type: 'case.created', data: { caseId: 'case_str' } }),
    });

    const res = await request(buildApp(observed))
      .post('/webhooks/crowdsource')
      .set({ ...signed.headers })
      .send(signed.body);

    expect((res.body as { rejection?: string }).rejection).toBe('signature_mismatch');
    expect(await countEvents()).toBe(0);
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
    expect(await countEvents()).toBe(1);
    expect(await countOutbox()).toBe(1);
  });
});
