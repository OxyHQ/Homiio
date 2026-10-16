/**
 * Public photos in Oxy Files (ADR 0043) — every way one enters Homiio.
 *
 * | What                                  | Owner                 | How                         |
 * |---------------------------------------|-----------------------|-----------------------------|
 * | A host's listing photo, a case cover  | the uploader's ACCOUNT | {@link uploadAccountImage} |
 * | A scraped listing photo               | the Homiio APPLICATION | {@link importApplicationImages} |
 * | A Wikimedia city cover                | the Homiio APPLICATION | {@link importApplicationImage} |
 *
 * Each becomes an `images` row through {@link insertOxyImage}; the row is
 * Homiio's record of showing it, and the triggers on the tables that show
 * photos register (and later remove) the use with Oxy (`referenceSync.ts`).
 *
 * Nothing here runs Sharp over a photo to make renditions any more: Oxy makes
 * them. The one Sharp pass left is the privacy one in
 * {@link uploadAccountImage}.
 */

import { createHash } from 'node:crypto';

import type { ApplicationFileImport, ServiceAssetMetadata } from '@oxy.so/core';
import type { ImageAttribution, ImageEntityType } from '@homiio/shared-types';
import sharp from 'sharp';

import { insertImage, type ImageRow } from '../../db/images/imageWrites';
import { getDb, type DatabaseOrTransaction } from '../../db/postgres';
import type { FILE_REFERENCE_ENTITY_TYPES } from '../../db/schema/oxyFiles';
import { AppError } from '../../middlewares/errorHandler';
import { oxyImageUrls } from './imageUrls';
import { oxyErrorCode, oxyErrorStatus, oxyFiles } from './oxyFilesClient';

/** An entity that uses a photo, as Oxy records the use. */
export interface FileReferenceTarget {
  entityType: (typeof FILE_REFERENCE_ENTITY_TYPES)[number];
  entityId: string;
}

/** A photo Oxy holds, described the way an `images` row needs it. */
export interface StoredPublicImage {
  fileId: string;
  owner: 'application' | 'account';
  /** `jpeg`, `png`, `webp` … — from the stored file's type. */
  format: string;
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
}

/** Decode what can be decoded; phones and portals emit benign libpng warnings. */
const SHARP_DECODE_OPTIONS = { failOn: 'none' } as const;

function formatOfMime(mime: string): string {
  const subtype = mime.split('/')[1]?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (subtype === 'jpg' || subtype === 'pjpeg') return 'jpeg';
  return subtype.length > 0 ? subtype : 'jpeg';
}

/**
 * Store a photo a person uploaded, in THAT PERSON's Oxy account.
 *
 * Re-encoded first, and that is a privacy measure rather than a size one: Sharp
 * does not carry metadata across, so the GPS tag a phone writes into a photo
 * taken inside a home never reaches a public file (ADR 0003). `rotate()` bakes
 * the EXIF orientation in before the tag that carried it is dropped. JPEG at
 * 95, the same encode the original rendition always had.
 *
 * The SHA-256 Oxy reports is compared with the one computed here — the bytes
 * Homiio meant to store and the bytes Oxy says it stored must be the same.
 */
export async function uploadAccountImage(
  ownerOxyUserId: string,
  input: { buffer: Buffer; originalName?: string },
): Promise<StoredPublicImage> {
  const source = sharp(input.buffer, SHARP_DECODE_OPTIONS);
  const metadata = await source.metadata();
  const stripped = await sharp(input.buffer, SHARP_DECODE_OPTIONS)
    .rotate()
    .jpeg({ quality: 95 })
    .toBuffer();
  const sha256 = createHash('sha256').update(stripped).digest('hex');

  const file = await oxyFiles().uploadUserMedia(ownerOxyUserId, stripped, 'image/jpeg', {
    ...(input.originalName ? { originalName: input.originalName } : {}),
    timeout: 120_000,
  });
  if (file.sha256 !== sha256) {
    throw new Error('Oxy stored different bytes than Homiio uploaded');
  }

  // Width/height after rotation: a portrait photo whose EXIF said "rotate 90"
  // is portrait from here on.
  const rotated = metadata.orientation !== undefined && metadata.orientation >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  return {
    fileId: file.id,
    owner: 'account',
    format: 'jpeg',
    bytes: file.size,
    sha256: file.sha256,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

function fromImport(result: ApplicationFileImport): StoredPublicImage {
  return {
    fileId: result.file.id,
    owner: 'application',
    format: formatOfMime(result.file.mime),
    bytes: result.file.size,
    sha256: result.file.sha256,
  };
}

/**
 * Oxy fetches only `https`. Most portal and Commons hosts serve the same path
 * over both, so an `http:` source is asked for over `https:` rather than
 * fetched here — Homiio keeps no fetcher of its own for public photos
 * (ADR 0043 D7). One that has no https twin fails like any unreachable photo.
 */
export function importableSourceUrl(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

/**
 * Import one photo by URL as HOMIIO's file, registering the use in the same
 * request so a crash after the import never leaves it unreferenced. Importing
 * the same URL again answers the existing file without a download — Oxy
 * remembers the source (`file_sources`), so a re-sync re-uploads nothing.
 */
export async function importApplicationImage(
  sourceUrl: string,
  reference: FileReferenceTarget,
): Promise<StoredPublicImage> {
  const result = await oxyFiles().importAppFile(importableSourceUrl(sourceUrl), {
    visibility: 'public',
    reference,
  });
  return fromImport(result);
}

/** One photo's outcome in a batch import: the file, or why there is none. */
export type ImportOutcome =
  | { ok: true; image: StoredPublicImage }
  | { ok: false; status: number; code: string };

/**
 * Import a listing's photos in one batch request per 50 (Oxy runs four at a
 * time). Each answers on its own; the order is the order given.
 */
export async function importApplicationImages(
  sourceUrls: readonly string[],
  reference: FileReferenceTarget,
): Promise<ImportOutcome[]> {
  if (sourceUrls.length === 0) return [];
  const results = await oxyFiles().importAppFiles(
    sourceUrls.map((url) => ({
      sourceUrl: importableSourceUrl(url),
      visibility: 'public' as const,
      reference,
    })),
  );
  const outcomes: ImportOutcome[] = sourceUrls.map(() => ({
    ok: false,
    status: 502,
    code: 'NO_ANSWER',
  }));
  for (const result of results) {
    outcomes[result.index] = result.ok
      ? { ok: true, image: fromImport(result) }
      : { ok: false, status: result.error.status, code: result.error.code };
  }
  return outcomes;
}

/**
 * Store bytes Homiio already holds as HOMIIO's file, then register the use.
 * Only for a photo Oxy could not fetch itself (the residential-proxy fallback
 * of the listing ingest); everything else is {@link importApplicationImages}.
 */
export async function uploadApplicationImage(
  input: { buffer: Buffer; mimetype: string },
  reference: FileReferenceTarget,
): Promise<StoredPublicImage> {
  const assets = oxyFiles();
  const uploaded = await assets.uploadAppFile(input.buffer, input.mimetype, {
    visibility: 'public',
  });
  await assets.references.add([{ fileId: uploaded.file.id, ...reference }]);
  return {
    fileId: uploaded.file.id,
    owner: 'application',
    format: formatOfMime(uploaded.file.mime),
    bytes: uploaded.file.size,
    sha256: uploaded.file.sha256,
  };
}

/** Per-image attributes of a new row. */
export interface OxyImageRowOptions {
  caption?: string;
  isPrimary?: boolean;
  order?: number;
  attribution?: ImageAttribution;
}

/**
 * The `images` row for a photo Oxy holds. Its four URLs are the Oxy
 * renditions (`imageUrls.ts`); its status and visibility start at what an
 * upload or import produces — active and public — and file events move them.
 */
export async function insertOxyImage(
  entityType: ImageEntityType,
  entityId: string,
  image: StoredPublicImage,
  options: OxyImageRowOptions = {},
  db: DatabaseOrTransaction = getDb(),
): Promise<ImageRow> {
  return insertImage(
    {
      entityType,
      entityId,
      oxyFile: { id: image.fileId, owner: image.owner },
      urls: oxyImageUrls(image.fileId),
      width: image.width,
      height: image.height,
      format: image.format,
      bytes: image.bytes,
      caption: options.caption,
      isPrimary: options.isPrimary,
      order: options.order,
      attribution: options.attribution,
    },
    db,
  );
}

/**
 * The ownership check on a photo a client names by Oxy file id.
 *
 * `POST /api/images/upload` stored it in the uploader's account, and the
 * client echoes the id back when it publishes. Nothing about an id proves the
 * caller uploaded it, so before an id becomes a listing's photo or a case's
 * cover Oxy is asked who owns it: the file must be this account's own, live,
 * and an image. Anything else is one 400 naming the position — a stranger's
 * public photo is refused exactly like a missing one.
 *
 * `ownerUserId` is present on Oxy's answer only for Oxy's own applications
 * (an internal-tier token, which Homiio's attested task role is); absent, the
 * check cannot be made and the id is refused rather than trusted.
 */
export async function requireOwnAccountImages(
  ownerOxyUserId: string,
  fileIds: readonly string[],
): Promise<Map<string, ServiceAssetMetadata>> {
  const unique = [...new Set(fileIds)];
  if (unique.length === 0) return new Map();
  let entries: ServiceAssetMetadata[];
  try {
    entries = await oxyFiles().metadataByIds(unique);
  } catch (error) {
    const status = oxyErrorStatus(error);
    throw new AppError(
      'The photo could not be checked with Oxy Files',
      status !== undefined && status < 500 ? 400 : 502,
      oxyErrorCode(error) ?? 'OXY_FILES_UNAVAILABLE',
    );
  }
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const fileId of unique) {
    const entry = byId.get(fileId);
    if (
      !entry ||
      entry.ownerUserId !== ownerOxyUserId ||
      entry.status !== 'active' ||
      !entry.mime.startsWith('image/')
    ) {
      throw new AppError(
        `Photo ${fileId} is not an image you uploaded`,
        400,
        'INVALID_PROPERTY_IMAGE',
      );
    }
  }
  return byId;
}

/** A stored image as an `images` row needs it, from Oxy's metadata. */
export function storedFromMetadata(entry: ServiceAssetMetadata): StoredPublicImage {
  return {
    fileId: entry.id,
    owner: entry.ownerApplicationId ? 'application' : 'account',
    format: formatOfMime(entry.mime),
    bytes: entry.size,
    sha256: entry.sha256,
    ...(entry.width === undefined ? {} : { width: entry.width }),
    ...(entry.height === undefined ? {} : { height: entry.height }),
  };
}
