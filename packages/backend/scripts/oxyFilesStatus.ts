/**
 * The bucket-retirement gate, as a command (`services/files/storageStatus.ts`):
 *
 *   bun run packages/backend/scripts/oxyFilesStatus.ts [--soak-days=14]
 *
 * Prints the status as JSON and exits 0 only when the PUBLIC photos may leave
 * the bucket (`publicImagesRetirable`); `bucketRetirable` says whether the
 * whole bucket may (it may not until the private documents move, Oxy 4b).
 * Read-only.
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { closePostgres, connectPostgres } from '../db/postgres';
import { storageRetirementStatus } from '../services/files/storageStatus';

function soakDays(): number {
  const raw = process.argv.find((arg) => arg.startsWith('--soak-days='))?.split('=')[1];
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
}

async function main(): Promise<void> {
  await connectPostgres();
  const status = await storageRetirementStatus(soakDays());
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = status.publicImagesRetirable ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error(
      '[oxy-files-status] failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 2;
  })
  .finally(() => {
    void closePostgres();
  });
