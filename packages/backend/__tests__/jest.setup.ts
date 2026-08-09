/**
 * Global Jest setup for the backend test suite.
 *
 * Publishes the environment `config` captures at module load, and opens the
 * Postgres pool — the store every suite here reads.
 *
 * ## Mongo is NOT booted from this file any more
 *
 * It used to spin up an in-memory replica set for every one of the 130 suites.
 * Five need one, measured by switching it off and running the whole suite
 * serially: 77 tests of 1,751 turn red, all inside `dataBackfill`,
 * `geoBackfill`, `reviewSystem`, `stripeWebhook` and `wireIdContract`. Those
 * five now call `useMongoMemoryServer()` from
 * `__tests__/helpers/mongoMemory.ts`, which is also where the reasoning about
 * replica sets and `MONGODB_URI` moved.
 *
 * The point is enumerability rather than speed: `mongoose` and
 * `mongodb-memory-server` are leaving `package.json`, and a `grep -rl
 * useMongoMemoryServer __tests__` now answers "what is still in the way"
 * from the repository instead of from a measurement somebody has to redo.
 */

// Give config a real https public URL so self-hosted image URLs
// (`${publicUrl}/api/images/file/...`) are accepted by the Property image-URL
// validator during tests (a bare localhost host can trip `validator.isURL`).
process.env.PUBLIC_API_URL = process.env.PUBLIC_API_URL || 'https://api.homiio.test';

/**
 * The CrowdSource webhook route refuses to mount without a secret — an
 * unconfigured deployment 404s there, which is indistinguishable from not having
 * the feature, which is what it is.
 *
 * `config` reads the environment ONCE at module load, so a test's own
 * `beforeEach` sets this far too late: by then the route has already decided not
 * to exist. Declaring it here is the only point early enough.
 *
 * `CROWDSOURCE_ENABLED` is deliberately left unset. Tests exercise intake,
 * delivery and enforcement by calling them directly; the background dispatcher
 * and the reconciliation sweep must stay switched off, or every suite would race
 * a poller draining the collections it is asserting on.
 */
process.env.CROWDSOURCE_WEBHOOK_SECRET =
  process.env.CROWDSOURCE_WEBHOOK_SECRET || 'test-webhook-secret-at-least-16-chars';
/**
 * The rotation secret, set for the same reason: `config` captures it once at
 * module load, so a test cannot introduce it later. Without this the route omits
 * `previousSecret` entirely and the rotation path — the one that runs for the
 * first time during a rotation somebody scheduled — would never be exercised.
 */
process.env.CROWDSOURCE_WEBHOOK_SECRET_PREVIOUS =
  process.env.CROWDSOURCE_WEBHOOK_SECRET_PREVIOUS || 'test-previous-secret-at-least-16-chars';

beforeAll(async () => {
  // Postgres, for every suite rather than only the `__tests__/db` ones:
  // from batch 1 on, request-path code (geo, addresses, cities, neighborhoods)
  // reads it through `getDb()`, which THROWS when no pool has been published. A
  // suite that forgot to connect would fail with "PostgreSQL is not connected"
  // rather than with whatever it was actually asserting.
  //
  // Idempotent — `connectPostgres()` returns the existing handle — so the
  // `__tests__/db` files that connect for themselves are unaffected.
  // `jest.setupWorkerDatabase.cjs` has already pointed `DATABASE_URL` at this
  // worker's own throwaway database.
  //
  // **Imported HERE, not at the top of the file.** `db/postgres` imports
  // `config`, and `config` reads `process.env` ONCE at module load — so a
  // top-level import would evaluate it BEFORE the assignments above and freeze
  // an environment without `PUBLIC_API_URL` or the CrowdSource secrets. The
  // symptom is not a Postgres failure at all: the webhook route decides it is
  // unconfigured and 404s, and the image-URL validator rejects every ingested
  // listing. Measured — a top-level import turned 8 unrelated suites red.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { connectPostgres } = require('../db/postgres') as typeof import('../db/postgres');
  await connectPostgres();
});

// There is deliberately no root `afterAll` here.
//
// The Postgres pool must NOT be closed from one: a root `afterAll` declared in a
// setup file runs BEFORE the test file's own, so closing it would pull the pool
// out from under any suite that cleans its fixtures up in an `afterAll` — which
// the `__tests__/db` files do. Those files close it themselves; the pool is per
// worker process and dies with it, and `jest.globalTeardown.ts` drops the
// databases either way.
//
// The Mongo half of the old teardown moved to `helpers/mongoMemory.ts`, where it
// belongs to the suites that actually opened a connection.
