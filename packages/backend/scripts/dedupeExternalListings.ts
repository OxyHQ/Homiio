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

class UnionFind {
  private readonly parent = new Map<string, string>();
  find(x: string): string {
    let root = this.parent.get(x) ?? x;
    if (root === x) {
      this.parent.set(x, x);
      return x;
    }
    root = this.find(root);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function blockKey(c: DedupComparable): string {
  return [c.type, c.cityId, c.offering, c.amount, c.currency, c.bedrooms, c.squareFootage].join('|');
}

/**
 * Pure grouping: block rows by the scalar fingerprint, union within a block on
 * description similarity, then split each connected component into `keep` (the
 * richest listing) + `archive` (the rest). Groups are ordered largest-first.
 * Deterministic and DB-free — the unit-tested core of the backfill.
 */
export function planDeduplication(rows: Row[]): DedupGroup[] {
  const blocks = new Map<string, Row[]>();
  for (const row of rows) {
    const key = blockKey(row.comparable);
    const bucket = blocks.get(key);
    if (bucket) bucket.push(row);
    else blocks.set(key, [row]);
  }

  const uf = new UnionFind();
  const rowById = new Map<string, Row>();
  for (const bucket of blocks.values()) {
    for (const row of bucket) rowById.set(row.id, row);
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (areDuplicateListings(bucket[i].comparable, bucket[j].comparable)) {
          uf.union(bucket[i].id, bucket[j].id);
        }
      }
    }
  }

  const grouped = new Map<string, Row[]>();
  for (const row of rowById.values()) {
    const root = uf.find(row.id);
    const members = grouped.get(root);
    if (members) members.push(row);
    else grouped.set(root, [row]);
  }

  const groups: DedupGroup[] = [];
  for (const members of grouped.values()) {
    if (members.length < 2) continue;
    const [keep, ...archive] = [...members].sort(keepOrder);
    groups.push({ keep, archive });
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
    const now = new Date();
    const result = await Property.updateMany(
      { _id: { $in: toArchive }, isExternal: true, deletedAt: null },
      { $set: { deletedAt: now, status: PropertyStatus.ARCHIVED, expiresAt: now } },
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
