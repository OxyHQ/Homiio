/**
 * The publish wizard's photos, turned into something the write path can store.
 *
 * ## Where the canonical `images` row is created: at PUBLISH
 *
 * `images.entity_id` is `NOT NULL` and names the listing. While the wizard is
 * uploading there is no listing, so the upload (`POST /api/images/upload`)
 * stores the photo in the uploader's own Oxy account and answers its file id;
 * this module carries that id forward to the write transaction, which mints
 * the row once the listing has an id (`db/properties/propertyWrites.ts#resolveImageRows`).
 *
 * ## A file id is checked, not trusted
 *
 * The client echoes the id back, so it is untrusted input — and unlike a bucket
 * key it CAN be proven: Oxy is asked who owns each file
 * (`services/files/publicImages.requireOwnAccountImages`, one call for the
 * whole payload) and a file that is not the publisher's own, live image is a
 * 400 naming the photo. A host can no longer publish a photo from somebody
 * else's listing by naming it. The four URLs are derived from the id
 * server-side (`services/files/imageUrls`), never taken from the body.
 *
 * The id arrives as `fileId`, or — from an app build released before the move,
 * which only knows `keys` — as `keys.original = "oxy:<fileId>"`.
 *
 * Nothing else names a photo. A bucket key (the pre-Oxy upload shape) is a 400
 * like any other unnamed photo: the bucket is retired and every `images` row
 * carries an Oxy file.
 *
 * A photo that already HAS a row (every photo an edit loads back from the
 * server) is identified by `imageId` alone; its URLs are read from the row.
 */

import { findImagesByIds, type ImageRow } from '../../db/images/imageWrites';
import type { PropertyImageInput } from '../../db/properties/propertyWrites';
import { fileIdFromOxyKey, oxyImageUrls } from '../../services/files/imageUrls';
import { requireOwnAccountImages, storedFromMetadata } from '../../services/files/publicImages';
import { AppError } from '../../middlewares/errorHandler';

/** A 400 naming the photo that is wrong, rather than a 500 from the insert. */
function reject(index: number, detail: string): never {
  throw new AppError(`images[${index}]: ${detail}`, 400, 'INVALID_PROPERTY_IMAGE');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** A non-negative integer, or undefined — never a negative or fractional one. */
function count(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** The Oxy file a photo names, as `fileId` or as an `oxy:` key, or undefined. */
function fileIdOf(entry: Record<string, unknown>): string | undefined {
  const direct = text(entry.fileId);
  if (direct !== undefined) return direct;
  const keys = asRecord(entry.keys);
  const original = text(keys?.original);
  return original === undefined ? undefined : (fileIdFromOxyKey(original) ?? undefined);
}

/** The denormalized copy `property_images` keeps, taken from the canonical row. */
function refFromRow(row: ImageRow): Pick<PropertyImageInput, 'url' | 'urls'> {
  return {
    url: row.urlsMedium,
    urls: {
      original: row.urlsOriginal,
      small: row.urlsSmall,
      medium: row.urlsMedium,
      large: row.urlsLarge,
    },
  };
}

/**
 * Normalize `payload.images` in place into {@link PropertyImageInput}s the write
 * path can store, or throw a 400 naming the offending photo.
 *
 * `publisherOxyUserId` is the session's account: a photo named by Oxy file id
 * must be that account's own.
 *
 * Position in the array IS the order: `order` is assigned from the index unless
 * the caller stated one, so a reordered photo list publishes in the order the
 * host arranged it. The first photo flagged primary is the only one that keeps
 * the flag — `property_images_one_primary_key` would otherwise reject the whole
 * publish with a unique violation the host cannot act on.
 *
 * A payload that does not mention `images` is left completely alone: on an
 * update that means "do not touch the photos", which is the contract
 * `replacePropertyImages` is called under.
 */
export async function normalizePropertyPhotos(
  payload: Record<string, unknown>,
  publisherOxyUserId: string,
): Promise<void> {
  if (!Array.isArray(payload.images)) return;

  const entries = payload.images.map((entry, index) => {
    const record = asRecord(entry);
    if (!record) reject(index, 'is not an object');
    return record;
  });

  // One query for every already-persisted photo: an edit that saves ten photos
  // must not be ten round trips, and a missing row must be a 400 here rather
  // than a foreign-key 500 from inside the transaction.
  const rows = await findImagesByIds(
    entries.flatMap((entry) => {
      const id = text(entry.imageId);
      return id === undefined ? [] : [id];
    }),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  // And one call to Oxy for every newly uploaded photo.
  const owned = await requireOwnAccountImages(
    publisherOxyUserId,
    entries.flatMap((entry) => {
      if (text(entry.imageId) !== undefined) return [];
      const fileId = fileIdOf(entry);
      return fileId === undefined ? [] : [fileId];
    }),
  );

  let primaryTaken = false;
  payload.images = entries.map((entry, index): PropertyImageInput => {
    const caption = typeof entry.caption === 'string' ? entry.caption : null;
    const wantsPrimary = entry.isPrimary === true || entry.isPrimary === 'true';
    const isPrimary = wantsPrimary && !primaryTaken;
    if (isPrimary) primaryTaken = true;
    const order = count(entry.order) ?? index;

    const imageId = text(entry.imageId);
    if (imageId !== undefined) {
      const row = byId.get(imageId);
      if (!row) reject(index, 'names an image that does not exist');
      return { imageId, caption, isPrimary, order, ...refFromRow(row) };
    }

    const fileId = fileIdOf(entry);
    if (fileId !== undefined) {
      const metadata = owned.get(fileId);
      if (!metadata) reject(index, 'names a photo that could not be checked');
      const stored = storedFromMetadata(metadata);
      return {
        upload: {
          oxyFile: { id: stored.fileId, owner: stored.owner },
          urls: oxyImageUrls(stored.fileId),
          format: stored.format,
          bytes: stored.bytes,
          width: stored.width ?? count(entry.width),
          height: stored.height ?? count(entry.height),
        },
        caption,
        isPrimary,
        order,
      };
    }
    return reject(index, 'names no image: send its imageId or the fileId of an uploaded photo');
  });
}
