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

let mongoServer: MongoMemoryReplSet | undefined;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;
  process.env.DATABASE_URL = uri;
  await mongoose.connect(uri);
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
});
