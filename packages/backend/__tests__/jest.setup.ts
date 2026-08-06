/**
 * Global Jest setup for the backend test suite.
 *
 * Spins up an in-memory MongoDB once per test process and connects Mongoose to
 * it BEFORE any model module is required (the model files call
 * `mongoose.model(...)` at import time and read the active connection). The DB
 * URI is set on `process.env` so anything reading `config.database.url` lands on
 * the memory server too. Collections are cleared after every test for isolation.
 *
 * Tests that are pure (no DB) are unaffected — they simply never touch a model.
 *
 * ## Why a REPLICA SET rather than a standalone `MongoMemoryServer`
 *
 * A standalone `mongod` refuses `session.withTransaction` outright, and the
 * moderation intake's whole guarantee is that a report and its delivery event
 * commit together — a test running against a standalone server could only ever
 * assert the halves separately, which is precisely the bug that guarantee
 * exists to prevent. Production is a replica set (`rs0`, `oxy-infra`
 * `terraform-uswest2/mongo.tf`), so a single-node replica set here is also the
 * closer match to what the code actually runs against.
 *
 * One node, not three: a transaction needs a replica set, not redundancy.
 */

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

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

let mongoServer: MongoMemoryReplSet | undefined;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  // `MONGODB_URI` ONLY. `DATABASE_URL` used to be set here too, back when
  // `config.database.url` fell back to it — it now names the POSTGRES database
  // (`jest.setupWorkerDatabase.cjs` points it at this worker's throwaway one),
  // so writing a `mongodb://` URI over it would make every Postgres suite
  // connect to the memory server and fail on a protocol mismatch.
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri);

  // Postgres too, for every suite rather than only the `__tests__/db` ones:
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

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
  // The Postgres pool is deliberately NOT closed here. A root `afterAll`
  // declared in a setup file runs BEFORE the test file's own, so closing it
  // would pull the pool out from under any suite that cleans its fixtures up in
  // an `afterAll` — which the `__tests__/db` files do. Those files close it
  // themselves; the pool is per worker process and dies with it, and
  // `jest.globalTeardown.ts` drops the databases either way.
});
