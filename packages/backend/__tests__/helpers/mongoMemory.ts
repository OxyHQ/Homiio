/**
 * The in-memory Mongo replica set — OPT IN, per suite.
 *
 * This used to live in `__tests__/jest.setup.ts`, which meant every one of the
 * 132 backend suites booted a `mongod` it did not use. FOUR need it, and the
 * count is measured rather than assumed: switching the replica set off and
 * running the whole suite serially turns exactly these files red —
 *
 *     db/dataBackfill.test.ts             57 of 57 tests
 *     db/geoBackfill.test.ts              16 of 41
 *     integration/reviewSystem.test.ts     1 of 33
 *     integration/wireIdContract.test.ts   1 of 13
 *
 * — 75 tests of 1,789, and nothing else moves. Measured at 5eb1bc51; re-derive
 * it the same way rather than trusting this list, because it shrinks with every
 * port. `integration/stripeWebhook.test.ts` was on it until the billing port
 * landed and was taken off in the same change that added this file.
 *
 * ## Why opt-in is worth a helper rather than being left global
 *
 * The dependency this file names is on its way OUT. `mongoose` and
 * `mongodb-memory-server` cannot leave `package.json` while anything boots
 * Mongo, so what matters is that the remaining users are ENUMERABLE — the list
 * now lives in the repository instead of in whoever last ran the measurement
 * above:
 *
 *     grep -rl '^useMongoMemoryServer();' __tests__     # 4 files
 *
 * The `^` anchor is load-bearing and was arrived at by running the alternatives:
 * the call is always at column 0 (see the ordering note below), while every
 * other mention — this file's own definition, the prose here, the
 * cross-references in `jest.setup.ts` and `unit/mongoUnreachable.test.ts` — is
 * indented inside a comment. Unanchored, the same grep answers 6 and the bare
 * name answers 7, so an unanchored form would overstate the remaining work and
 * never reach zero.
 *
 * Retiring the last caller is then a deletion of this file and four call sites,
 * not a rewrite of the global setup.
 *
 * The two other effects are real but secondary: 128 suites stop paying a
 * replica-set boot, and they stop holding a `mongod` process each while the
 * whole suite shares one Postgres server.
 *
 * ## Why a REPLICA SET rather than a standalone `MongoMemoryServer`
 *
 * Kept verbatim from the setup file, because it is still the reason: a
 * standalone `mongod` refuses `session.withTransaction` outright, and the
 * moderation intake's whole guarantee is that a report and its delivery event
 * commit together — a test running against a standalone server could only ever
 * assert the halves separately, which is precisely the bug that guarantee exists
 * to prevent. One node, not three: a transaction needs a replica set, not
 * redundancy.
 *
 * ## Call it at the TOP of the file, before any other hook
 *
 * It registers `beforeAll`/`afterEach`/`afterAll` in the caller's scope. At file
 * top level those are outermost, so the connection is open before any
 * `describe`'s own `beforeAll` and the cleanup runs after every test — the same
 * ordering the global setup gave. Called from inside a `describe`, it would
 * connect too late for a sibling block.
 */

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Boot an in-memory Mongo replica set for THIS suite and connect mongoose to it.
 *
 * Also publishes `MONGODB_URI`, which is not decoration: `db/backfill/data.ts`
 * reads it from the environment at call time and throws
 * "MONGODB_URI is not set; there is nothing to copy from." without it. That is
 * the only remaining production reader of the variable, and it is one of the
 * callers here.
 */
export function useMongoMemoryServer(): void {
  let server: MongoMemoryReplSet | undefined;
  let previousUri: string | undefined;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = server.getUri();
    previousUri = process.env.MONGODB_URI;
    // `MONGODB_URI` ONLY — never `DATABASE_URL`, which names this worker's
    // throwaway POSTGRES database (`jest.setupWorkerDatabase.cjs`). Writing a
    // `mongodb://` URI over it would make every Postgres read in the same file
    // fail on a protocol mismatch.
    process.env.MONGODB_URI = uri;
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
    if (server) {
      await server.stop();
    }
    // Restored rather than deleted: jest gives each worker its own process, but
    // a suite that ran earlier in the same worker must not leave a dead URI
    // behind for a later one to connect to and hang on.
    if (previousUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = previousUri;
    }
  });
}
