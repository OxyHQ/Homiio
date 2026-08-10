/**
 * Per-worker Postgres routing — runs in every Jest worker BEFORE test files load.
 *
 * `jest.globalSetup.ts` provisions one migrated throwaway database per worker and
 * writes their URLs to a manifest file. Each worker reads that manifest and sets
 * `DATABASE_URL` to its own entry, so parallel suites cannot race on shared rows.
 *
 * Every failure here THROWS rather than falling back to a default. A worker that
 * quietly kept the ambient `DATABASE_URL` would run its whole suite against a
 * developer's real database — and pass, right up until it truncated something.
 */

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { HOMIIO_JEST_DATABASE_MANIFEST } = require('./jest.workerCount.cjs');

const manifestPath = process.env[HOMIIO_JEST_DATABASE_MANIFEST];
if (!manifestPath) {
  throw new Error(
    `${HOMIIO_JEST_DATABASE_MANIFEST} is unset — jest.globalSetup.ts must run before workers`,
  );
}

const urls = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(urls) || urls.length === 0) {
  throw new Error(`Invalid Jest database manifest at ${manifestPath}`);
}

const workerId = Number.parseInt(process.env.JEST_WORKER_ID ?? '1', 10);
const index = workerId - 1;
if (!Number.isFinite(workerId) || index < 0 || index >= urls.length) {
  throw new Error(
    `JEST_WORKER_ID=${process.env.JEST_WORKER_ID ?? '(unset)'} is out of range ` +
      `for ${urls.length} provisioned database(s). jest.config.js's maxWorkers and ` +
      'jest.globalSetup.ts must both read computeMaxWorkers() from jest.workerCount.cjs.',
  );
}

process.env.DATABASE_URL = urls[index];

/**
 * Per-worker LOCAL image store, for the same reason as the database above.
 *
 * The store root was one hardcoded path shared by every worker, and two suites
 * remove it recursively in `afterAll`. One worker's `fs.rm` walking the tree
 * while another worker writes into it fails with `ENOTEMPTY` from the final
 * `rmdir` — a suite that fails while every test in it passes, which reads like a
 * broken change rather than a shared-fixture race.
 *
 * Derived from `JEST_WORKER_ID`, not from a random name, so a leaked directory
 * still says which worker leaked it. `services/imageUploadService.ts` reads this
 * variable and exports the resolved path; tests import that constant rather than
 * rebuilding it, so there is one authority instead of three.
 */
process.env.HOMIIO_LOCAL_IMAGE_STORE_DIR = path.join(
  __dirname,
  `.local-image-store-w${workerId}`,
);
