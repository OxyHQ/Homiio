// Purge persisted signer IP addresses from all lease e-signatures.
//
// Privacy mandate (ecosystem-wide): no user IPs at rest. The lease schema no
// longer defines `signatures.{landlord,tenant}.ipAddress`, but historical
// documents written before that change still carry the field. This one-shot
// `$unset`s it from every `leases` document. The e-signature audit trail keeps
// the `signedDate` timestamp + signer identity (Oxy account) — those are the
// legal anchors; the IP is removed.
//
// Runs against the native collection (not the Mongoose model) so the `$unset`
// of the now-removed schema paths is honored regardless of strict mode.
//
// Usage:
//   ts-node --transpile-only scripts/purge-lease-ip.ts          # perform the purge
//   DRY_RUN=1 ts-node --transpile-only scripts/purge-lease-ip.ts  # count only, no writes

require('dotenv').config();
import database from '../database/connection';
import { Lease } from '../models';

(async () => {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

  const filter = {
    $or: [
      { 'signatures.landlord.ipAddress': { $exists: true } },
      { 'signatures.tenant.ipAddress': { $exists: true } },
    ],
  };

  try {
    await database.connect();

    const affected = await Lease.collection.countDocuments(filter);
    console.log(`[purge-lease-ip] leases carrying a signer ipAddress: ${affected}`);

    if (dryRun) {
      console.log('[purge-lease-ip] DRY_RUN set — no documents modified.');
    } else {
      const res = await Lease.collection.updateMany(filter, {
        $unset: {
          'signatures.landlord.ipAddress': '',
          'signatures.tenant.ipAddress': '',
        },
      });
      console.log(
        `[purge-lease-ip] matched=${res.matchedCount} modified=${res.modifiedCount}`
      );
    }
  } catch (e) {
    console.error('[purge-lease-ip] failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await database.disconnect().catch(() => {});
    process.exit(process.exitCode ?? 0);
  }
})();
