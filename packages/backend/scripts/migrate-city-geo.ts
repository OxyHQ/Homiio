#!/usr/bin/env ts-node
/**
 * One-shot City geo migration for production.
 *
 * Drops the legacy `(name, state, country)` unique index, heals orphan city
 * rows, and syncs the relational `{ regionId, name }` index. Also runs
 * automatically on API/worker boot via `database.connect()`.
 *
 *   bun run migrate:city-geo
 */

require('dotenv').config();

import database from '../database/connection';
import { ensureCityGeoIndexes } from '../services/cityGeoMigration';

async function run(): Promise<void> {
  console.log('[migrate-city-geo] Connecting...');
  await database.connect();
  console.log('[migrate-city-geo] Applying city geo migration...');
  await ensureCityGeoIndexes();
  console.log('[migrate-city-geo] Done.');
}

run()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[migrate-city-geo] FAILED:', message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await database.disconnect();
    } catch {
      // ignore disconnect errors on exit
    }
    process.exit(process.exitCode ?? 0);
  });
