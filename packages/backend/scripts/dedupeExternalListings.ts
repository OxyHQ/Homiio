/**
 * Backfill: collapse re-listed external Properties (the same physical unit
 * advertised under multiple `sourceId`s) down to ONE per group.
 *
 * Groups are formed with the exact same conservative fingerprint the ingest path
 * uses ({@link areDuplicateListings}): same type + cityId + offering + price +
 * bedrooms(>0) + squareFootage(>0) + description Jaccard >= 0.95. Within a group
 * the richest listing is KEPT (most images, then longest description, then oldest
 * — a deterministic, stable choice); the rest are SOFT-DELETED
 * (`deletedAt` + `status: archived` + `expiresAt: now`) so the collapse is fully
 * reversible and public feeds (which filter `deletedAt: null`) stop showing them.
 *
 * Idempotent: archived docs carry `deletedAt` and are excluded from the next run.
 *
 * Usage:
 *   node dedupeExternalListings.js            # DRY-RUN: count + show, no writes
 *   node dedupeExternalListings.js --apply    # archive the redundant listings
 *   node dedupeExternalListings.js --apply --limit-groups=50
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

import type { Types } from 'mongoose';
import { PropertyStatus } from '@homiio/shared-types';
import database from '../database/connection';
import {
  areDuplicateListings,
  toDedupComparable,
  type DedupComparable,
} from '../services/ingestion/dedupeFingerprint';

const { Property } = require('../models');

// `--apply` (CLI) or `DEDUP_APPLY=1` (env, for the argv-less ECS `node -e` boot).
const APPLY = process.argv.includes('--apply') || process.env.DEDUP_APPLY === '1';

function readIntFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LIMIT_GROUPS = readIntFlag('limit-groups', Number.MAX_SAFE_INTEGER);

interface PropertyDoc {
  _id: Types.ObjectId;
  cityId?: Types.ObjectId;
  description?: string;
  images?: unknown[];
  type?: string;
  bedrooms?: number;
  squareFootage?: number;
  longTermRent?: { monthlyAmount?: number; currency?: string } | null;
  shortTermRent?: { nightlyRate?: number; currency?: string } | null;
  sale?: { price?: number; currency?: string } | null;
  source?: string;
  sourceId?: string;
  sourceUrl?: string;
  createdAt?: Date;
}

export interface Row {
  id: string;
  source: string;
  sourceId: string;
  sourceUrl: string;
  imageCount: number;
  createdAt: number;
  comparable: DedupComparable;
}

/** One duplicate group: the listing to KEEP and the redundant ones to ARCHIVE. */
export interface DedupGroup {
  keep: Row;
  archive: Row[];
}

/** Deterministic "keep the richest" order: most images, longest desc, oldest, then id. */
function keepOrder(a: Row, b: Row): number {
  if (b.imageCount !== a.imageCount) return b.imageCount - a.imageCount;
  const bDesc = b.comparable.descriptionTokens.size;
  const aDesc = a.comparable.descriptionTokens.size;
  if (bDesc !== aDesc) return bDesc - aDesc;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : 1;
}

function blockKey(c: DedupComparable): string {
  return [c.type, c.cityId, c.offering, c.amount, c.currency, c.bedrooms, c.squareFootage].join('|');
}

/**
 * Pure grouping: block rows by the scalar fingerprint, then within each block run
 * a greedy CLIQUE cover. A member is archived ONLY when it is a mutual duplicate
 * (`areDuplicateListings`) of the chosen keeper AND of every other member already
 * archived into that group — i.e. the group is a clique.
 *
 * This deliberately avoids single-linkage (union-find) clustering:
 * `areDuplicateListings` (description Jaccard >= 0.95) is NOT transitive, so
 * A~B and B~C do not imply A~C. Single-linkage would chain A-B-C and archive two
 * of three even when A and C are distinct units (the templated new-build case the
 * fingerprint is meant to reject). Clique-only archiving guarantees no distinct
 * unit is ever collapsed via a transitive chain. Deterministic and DB-free.
 */
export function planDeduplication(rows: Row[]): DedupGroup[] {
  const blocks = new Map<string, Row[]>();
  for (const row of rows) {
    const key = blockKey(row.comparable);
    const bucket = blocks.get(key);
    if (bucket) bucket.push(row);
    else blocks.set(key, [row]);
  }

  const groups: DedupGroup[] = [];
  for (const bucket of blocks.values()) {
    if (bucket.length < 2) continue;
    // Anchor on the richest listing; process the rest richest-first.
    const remaining = [...bucket].sort(keepOrder);
    while (remaining.length >= 2) {
      const keep = remaining[0];
      const clique: Row[] = [keep];
      const archive: Row[] = [];
      for (let i = 1; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        const dupOfWholeClique = clique.every((member) =>
          areDuplicateListings(member.comparable, candidate.comparable),
        );
        if (dupOfWholeClique) {
          clique.push(candidate);
          archive.push(candidate);
        }
      }
      if (archive.length > 0) {
        groups.push({ keep, archive });
        const assigned = new Set([keep.id, ...archive.map((row) => row.id)]);
        for (let i = remaining.length - 1; i >= 0; i -= 1) {
          if (assigned.has(remaining[i].id)) remaining.splice(i, 1);
        }
      } else {
        // Keeper has no clique-duplicate; keep it standalone and move on.
        remaining.shift();
      }
    }
  }
  groups.sort((a, b) => b.archive.length - a.archive.length);
  return groups;
}

async function main(): Promise<void> {
  await database.connect();

  // Join Address→cityId via aggregation. `$lookup` bypasses the Property
  // post-find hook that renames/mangles `addressId` on lean reads, so `cityId`
  // arrives clean and directly usable.
  const docs: PropertyDoc[] = await Property.aggregate([
    { $match: { isExternal: true, deletedAt: null, status: PropertyStatus.PUBLISHED } },
    { $lookup: { from: 'addresses', localField: 'addressId', foreignField: '_id', as: 'addr' } },
    {
      $project: {
        description: 1,
        images: 1,
        type: 1,
        bedrooms: 1,
        squareFootage: 1,
        longTermRent: 1,
        shortTermRent: 1,
        sale: 1,
        source: 1,
        sourceId: 1,
        sourceUrl: 1,
        createdAt: 1,
        cityId: { $arrayElemAt: ['$addr.cityId', 0] },
      },
    },
  ]);

  console.log(`Scanned ${docs.length} published external listings`);

  // Reduce to eligible comparable rows.
  const rows: Row[] = [];
  for (const doc of docs) {
    const comparable = toDedupComparable({
      type: doc.type,
      cityId: doc.cityId ? String(doc.cityId) : undefined,
      bedrooms: doc.bedrooms,
      squareFootage: doc.squareFootage,
      description: doc.description,
      longTermRent: doc.longTermRent,
      shortTermRent: doc.shortTermRent,
      sale: doc.sale,
    });
    if (!comparable) continue;
    rows.push({
      id: String(doc._id),
      source: doc.source ?? '',
      sourceId: doc.sourceId ?? '',
      sourceUrl: doc.sourceUrl ?? '',
      imageCount: Array.isArray(doc.images) ? doc.images.length : 0,
      createdAt: doc.createdAt ? new Date(doc.createdAt).getTime() : 0,
      comparable,
    });
  }
  console.log(`Fingerprint-eligible listings: ${rows.length}`);

  const dupGroups = planDeduplication(rows);
  const redundant = dupGroups.reduce((sum, group) => sum + group.archive.length, 0);
  console.log(
    `${APPLY ? 'Archiving' : 'Would archive'} ${redundant} redundant listing(s) ` +
      `across ${dupGroups.length} duplicate group(s)`,
  );

  const toArchive: string[] = [];
  let shown = 0;
  for (const group of dupGroups) {
    for (const loser of group.archive) toArchive.push(loser.id);

    if (shown < LIMIT_GROUPS) {
      shown += 1;
      const c = group.keep.comparable;
      console.log(
        `\nGROUP ${c.type} ${c.offering} ${c.amount}${c.currency} ` +
          `${c.bedrooms}bd ${c.squareFootage}m2 (n=${group.archive.length + 1})`,
      );
      console.log(
        `  KEEP    [${group.keep.source}/${group.keep.sourceId}] imgs=${group.keep.imageCount} ${group.keep.sourceUrl}`,
      );
      for (const loser of group.archive) {
        console.log(
          `  ARCHIVE [${loser.source}/${loser.sourceId}] imgs=${loser.imageCount} ${loser.sourceUrl}`,
        );
      }
    }
  }

  if (!APPLY) {
    console.log('\nDRY-RUN only — no documents modified. Re-run with --apply to archive.');
    await database.disconnect?.();
    return;
  }

  if (toArchive.length > 0) {
    // Soft-delete ONLY: set `deletedAt` (public feeds filter `deletedAt: null`)
    // and `status: archived`. Do NOT touch `expiresAt` — it carries a TTL index
    // (`expireAfterSeconds: 0`), so writing `expiresAt: now` would HARD-delete the
    // document within ~60s, making the archive irreversible. Leaving `expiresAt`
    // at its existing future value keeps the soft-delete reversible.
    const result = await Property.updateMany(
      { _id: { $in: toArchive }, isExternal: true, deletedAt: null },
      { $set: { deletedAt: new Date(), status: PropertyStatus.ARCHIVED } },
    );
    console.log(`\nArchived ${result.modifiedCount ?? toArchive.length} listing(s).`);
  } else {
    console.log('\nNothing to archive.');
  }

  await database.disconnect?.();
}

// Auto-run only when executed directly (`node dedupeExternalListings.js`), so the
// pure `planDeduplication` export can be imported by tests without hitting the DB.
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
