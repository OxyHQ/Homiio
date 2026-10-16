/**
 * Copying the photos in Homiio's bucket into Oxy Files (ADR 0041 stage 4) —
 * the logic behind `scripts/migrateImagesToOxy.ts`, kept here so it is tested.
 *
 * ## What moves, and to whom
 *
 * Only a row something SHOWS (`db/images/unusedImages.ts` defines "shown");
 * a row nothing shows is deleted by the unused-image sweep instead, so it is
 * never copied — that is the 948 orphans' end.
 *
 * | The row is shown by                 | It becomes                                   |
 * |-------------------------------------|----------------------------------------------|
 * | a host's own listing                | a file of the HOST's account (`uploadUserMedia`) |
 * | a scraped listing (`is_external`)   | a file of the HOMIIO application (`uploadAppFile`) |
 * | an eviction case                    | a file of the ORGANISER's account            |
 * | a city or region cover only         | not copied — RE-SOURCED (below)              |
 *
 * A legacy city cover came from Wikimedia Commons with no credit stored, and
 * Commons licences require one. Copying the bytes would carry the defect into
 * Oxy, so a legacy city cover is instead re-imported through the credited
 * sync (`ensureCover(cityId, { force: true })`); one Commons cannot credit is
 * cleared — Homiio must not show what it cannot credit. A region cover has no
 * source at all and is cleared. The replaced rows become unshown and the sweep
 * removes them.
 *
 * A host whose Oxy account is gone (Oxy refuses the owner) cannot own the
 * file; the photo is still on a live listing, so it becomes Homiio's file and
 * the report says so (`owner_fallback`).
 *
 * ## Verified, resumable, and quiet about where bytes live
 *
 * Each object is read once, hashed, uploaded, and the SHA-256 Oxy answers is
 * compared with Homiio's before the row is touched; a mismatch leaves the row
 * as it was. The row is updated only while it still has no Oxy file, so a
 * second run — or a run killed half way — redoes nothing: rows that moved are
 * not selected again, and an upload Oxy already holds answers the same file
 * (per-owner SHA-256 dedupe). Reports name rows by id and bytes by SHA-256,
 * never by key or URL.
 *
 * Updating `images.oxy_file_id` fires the images trigger, so every listing
 * showing the row is marked and the drain registers its use with Oxy.
 */

import { createHash } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import {
  detachImageFromListings,
  repointPropertyImageUrls,
} from '../../db/properties/propertyWrites';
import { cities, evictionCases, images, regions } from '../../db/schema';
import { ensureCover } from '../cityCoverSyncService';
import { oxyImageUrls } from './imageUrls';
import { legacyObjectStore } from './legacyObjectStore';
import { oxyErrorStatus, oxyFiles } from './oxyFilesClient';

/** A shown legacy row and who its file should belong to. */
export interface LegacyImageCandidate {
  imageId: string;
  entityType: string;
  keysOriginal: string;
  /** `account` with an owner, `application`, or `cover` (re-sourced, not copied). */
  target:
    | { kind: 'account'; ownerOxyUserId: string }
    | { kind: 'application' }
    | { kind: 'city_cover'; cityIds: string[] }
    | { kind: 'region_cover'; regionIds: string[] };
}

export type MigrationOutcome =
  | 'migrated'
  | 'owner_fallback'
  | 'missing_object'
  | 'hash_mismatch'
  | 'upload_failed'
  | 'resourced_cover'
  | 'cleared_cover'
  | 'already_migrated';

/** One report line: row id, outcome and bytes' identity — never a key or URL. */
export interface MigrationReportLine {
  imageId: string;
  entityType: string;
  owner?: 'account' | 'application';
  outcome: MigrationOutcome;
  sha256?: string;
  bytes?: number;
  oxyFileId?: string;
  error?: string;
}

/**
 * The next page of shown rows not yet in Oxy, in id order after `afterId`,
 * each with its target. A row shown by a listing AND a cover follows the
 * listing (the cover is re-sourced separately when it is the city's).
 */
export async function findLegacyImages(
  afterId: string | null,
  limit: number,
): Promise<LegacyImageCandidate[]> {
  const rows = await getDb().execute<{
    id: string;
    entity_type: string;
    keys_original: string;
    listing_owner: string | null;
    listing_external: boolean | null;
    case_owner: string | null;
    city_ids: string[] | null;
    region_ids: string[] | null;
  }>(sql`
    select i.id, i.entity_type, i.keys_original,
      (select p.oxy_user_id from property_images pi join properties p on p.id = pi.property_id
        where pi.image_id = i.id order by p.id limit 1) as listing_owner,
      (select p.is_external from property_images pi join properties p on p.id = pi.property_id
        where pi.image_id = i.id order by p.id limit 1) as listing_external,
      (select e.oxy_user_id from eviction_cases e where e.cover_image_id = i.id order by e.id limit 1) as case_owner,
      (select array_agg(c.id order by c.id) from cities c where c.cover_image_id = i.id) as city_ids,
      (select array_agg(r.id order by r.id) from regions r where r.cover_image_id = i.id) as region_ids
    from images i
    where i.oxy_file_id is null
      and ${afterId === null ? sql`true` : sql`i.id > ${afterId}`}
      and (
        exists (select 1 from property_images pi where pi.image_id = i.id)
        or exists (select 1 from cities c where c.cover_image_id = i.id)
        or exists (select 1 from regions r where r.cover_image_id = i.id)
        or exists (select 1 from eviction_cases e where e.cover_image_id = i.id)
      )
    order by i.id
    limit ${limit}
  `);
  return rows.map((row): LegacyImageCandidate => {
    const base = { imageId: row.id, entityType: row.entity_type, keysOriginal: row.keys_original };
    if (row.listing_external === true) return { ...base, target: { kind: 'application' } };
    if (row.listing_external === false) {
      return row.listing_owner
        ? { ...base, target: { kind: 'account', ownerOxyUserId: row.listing_owner } }
        : { ...base, target: { kind: 'application' } };
    }
    if (row.case_owner)
      return { ...base, target: { kind: 'account', ownerOxyUserId: row.case_owner } };
    if (row.city_ids && row.city_ids.length > 0) {
      return { ...base, target: { kind: 'city_cover', cityIds: row.city_ids } };
    }
    return { ...base, target: { kind: 'region_cover', regionIds: row.region_ids ?? [] } };
  });
}

/** Read, hash, upload, verify, and point the row (and its listings' copies) at Oxy. */
async function copyToOxy(
  candidate: LegacyImageCandidate,
  owner: { kind: 'account'; ownerOxyUserId: string } | { kind: 'application' },
): Promise<MigrationReportLine> {
  const base = { imageId: candidate.imageId, entityType: candidate.entityType };
  const object = await legacyObjectStore().get(candidate.keysOriginal);
  if (!object) return { ...base, owner: owner.kind, outcome: 'missing_object' };

  const sha256 = createHash('sha256').update(object.buffer).digest('hex');
  // The original rendition was always written as JPEG by the old pipeline.
  const mime = object.contentType.startsWith('image/') ? object.contentType : 'image/jpeg';
  const assets = oxyFiles();

  let fileId: string;
  let storedSha: string;
  let ownerKind: 'account' | 'application' = owner.kind;
  let outcome: MigrationOutcome = 'migrated';
  try {
    if (owner.kind === 'account') {
      try {
        const file = await assets.uploadUserMedia(owner.ownerOxyUserId, object.buffer, mime, {
          timeout: 120_000,
        });
        fileId = file.id;
        storedSha = file.sha256;
      } catch (error) {
        // 403: Oxy has no such local account any more. The photo is on a live
        // listing, so it is kept — as Homiio's.
        if (oxyErrorStatus(error) !== 403) throw error;
        const uploaded = await assets.uploadAppFile(object.buffer, mime, {
          visibility: 'public',
          timeout: 120_000,
        });
        fileId = uploaded.file.id;
        storedSha = uploaded.file.sha256;
        ownerKind = 'application';
        outcome = 'owner_fallback';
      }
    } else {
      const uploaded = await assets.uploadAppFile(object.buffer, mime, {
        visibility: 'public',
        timeout: 120_000,
      });
      fileId = uploaded.file.id;
      storedSha = uploaded.file.sha256;
    }
  } catch (error) {
    return {
      ...base,
      owner: owner.kind,
      outcome: 'upload_failed',
      sha256,
      bytes: object.buffer.length,
      error: `${oxyErrorStatus(error) ?? 'transport'}`,
    };
  }

  if (storedSha !== sha256) {
    return { ...base, owner: ownerKind, outcome: 'hash_mismatch', sha256, oxyFileId: fileId };
  }

  const urls = oxyImageUrls(fileId);
  const moved = await getDb().transaction(async (tx) => {
    const updated = await tx
      .update(images)
      .set({
        oxyFileId: fileId,
        oxyFileOwner: ownerKind,
        oxyFileStatus: 'active',
        oxyFileVisibility: 'public',
        urlsOriginal: urls.original,
        urlsSmall: urls.small,
        urlsMedium: urls.medium,
        urlsLarge: urls.large,
      })
      .where(sql`${images.id} = ${candidate.imageId} and ${images.oxyFileId} is null`)
      .returning({ id: images.id });
    if (updated.length === 0) return false;
    // The denormalized copies every listing read serves.
    await repointPropertyImageUrls(candidate.imageId, urls, tx);
    return true;
  });

  return {
    ...base,
    owner: ownerKind,
    outcome: moved ? outcome : 'already_migrated',
    sha256,
    bytes: object.buffer.length,
    oxyFileId: fileId,
  };
}

/** A legacy cover: re-sourced with credit (a city) or cleared. */
async function resolveLegacyCover(candidate: LegacyImageCandidate): Promise<MigrationReportLine> {
  const base = { imageId: candidate.imageId, entityType: candidate.entityType };
  if (candidate.target.kind === 'city_cover') {
    let cleared = false;
    for (const cityId of candidate.target.cityIds) {
      await ensureCover(cityId, { force: true });
      // Still pointing at the uncredited row: Commons gave nothing creditable.
      const result = await getDb()
        .update(cities)
        .set({ coverImageId: null })
        .where(sql`${cities.id} = ${cityId} and ${cities.coverImageId} = ${candidate.imageId}`)
        .returning({ id: cities.id });
      if (result.length > 0) cleared = true;
    }
    return { ...base, outcome: cleared ? 'cleared_cover' : 'resourced_cover' };
  }
  if (candidate.target.kind === 'region_cover') {
    await getDb()
      .update(regions)
      .set({ coverImageId: null })
      .where(eq(regions.coverImageId, candidate.imageId));
    return { ...base, outcome: 'cleared_cover' };
  }
  throw new Error('not a cover');
}

/** Move one row. Never throws for a per-row problem: the outcome says it. */
export async function migrateLegacyImage(
  candidate: LegacyImageCandidate,
): Promise<MigrationReportLine> {
  switch (candidate.target.kind) {
    case 'account':
    case 'application':
      return copyToOxy(candidate, candidate.target);
    case 'city_cover':
    case 'region_cover':
      return resolveLegacyCover(candidate);
  }
}

/**
 * A shown row whose object is not in the bucket can never be displayed — its
 * listings render a broken photo today. With `--detach-missing` the script
 * takes it off every listing and case that shows it (re-deriving
 * `has_images`), so the row becomes unshown and the sweep removes it. Off by
 * default: an operator reads the `missing_object` lines first.
 */
export async function detachMissingImage(imageId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await detachImageFromListings(imageId, tx);
    await tx
      .update(evictionCases)
      .set({ coverImageId: null, coverImageUrl: null })
      .where(eq(evictionCases.coverImageId, imageId));
  });
}

/** What is left to do — the preview, and the migration half of the retirement gate. */
export async function countLegacyImages(): Promise<
  Array<{ target: 'listing' | 'eviction_case' | 'city_cover' | 'region_cover'; rows: number }>
> {
  const rows = await getDb().execute<{ target: string; rows: string }>(sql`
    select case
             when exists (select 1 from property_images pi where pi.image_id = i.id) then 'listing'
             when exists (select 1 from eviction_cases e where e.cover_image_id = i.id) then 'eviction_case'
             when exists (select 1 from cities c where c.cover_image_id = i.id) then 'city_cover'
             else 'region_cover'
           end as target,
           count(*)::text as rows
    from images i
    where i.oxy_file_id is null
      and (
        exists (select 1 from property_images pi where pi.image_id = i.id)
        or exists (select 1 from cities c where c.cover_image_id = i.id)
        or exists (select 1 from regions r where r.cover_image_id = i.id)
        or exists (select 1 from eviction_cases e where e.cover_image_id = i.id)
      )
    group by 1
    order by 1
  `);
  return rows.map((row) => ({
    target: row.target as 'listing' | 'eviction_case' | 'city_cover' | 'region_cover',
    rows: Number(row.rows),
  }));
}
