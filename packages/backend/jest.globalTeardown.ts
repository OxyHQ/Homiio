/**
 * Jest global teardown — drops every throwaway database `jest.globalSetup.ts`
 * created.
 *
 * Reads the SAME manifest the workers read, rather than trusting
 * `process.env.DATABASE_URL`: setup and teardown share a process, but only the
 * manifest names every database rather than just the first.
 *
 * Each drop goes through `dropTestDatabase`, which refuses any name this run did
 * not mint — checked before a connection is opened, so a stray URL can never
 * reach `DROP DATABASE`.
 *
 * A failed drop is reported and does NOT fail the run: the tests have already
 * finished by this point, and turning a leaked throwaway database into a red
 * suite would report a cleanup problem as a test failure. The leak is visible in
 * the log and costs nothing but a row in `pg_database` on a disposable server.
 */

import { readFileSync, rmSync } from 'node:fs';
import { dropTestDatabase } from './db/testDatabase';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HOMIIO_JEST_DATABASE_MANIFEST } = require('./jest.workerCount.cjs');

export default async function globalTeardown(): Promise<void> {
  const manifestPath = process.env[HOMIIO_JEST_DATABASE_MANIFEST];
  if (!manifestPath) return;

  let urls: string[];
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    urls = Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === 'string') : [];
  } catch (error) {
    console.warn(
      `Could not read the Jest database manifest at ${manifestPath}; throwaway ` +
      `databases may need dropping by hand: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  for (const url of urls) {
    try {
      await dropTestDatabase(url);
    } catch (error) {
      console.warn(
        `Could not drop the throwaway database at ${url}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    rmSync(manifestPath, { force: true });
  } catch (error) {
    console.warn(
      `Could not remove the Jest database manifest at ${manifestPath}: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
