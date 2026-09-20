/**
 * The publish wizard's photos, turned into something the write path can store.
 *
 * ## The defect this module exists to close
 *
 * `property_images.image_id` is `NOT NULL` and RESTRICT-references `images.id`,
 * and the write path built its rows from `image.imageId`. The wizard's body
 * carried `{ url, caption, isPrimary }` and nothing else, so every publish that
 * carried a photo raised `23502` and answered 500 — since the property write
 * path moved to Postgres (#281), for every host who added a photo.
 *
 * It could not be fixed by forwarding the id the upload endpoint returns:
 * `POST /api/images/upload` with no `entityType`/`entityId` persists nothing,
 * and its `imageId` is the first segment of a storage key, not a row id.
 *
 * ## Where the canonical `images` row is created: at PUBLISH, from the keys
 *
 * `images.entity_id` is `NOT NULL` and names the listing. While the wizard is
 * uploading there is no listing — so the upload CANNOT mint the row, and this
 * module instead carries the upload's own keys forward to the write
 * transaction, which mints it once the listing has an id
 * (`db/properties/propertyWrites.ts#resolveImageRows`). The upload response
 * already returns everything needed; nothing new is stored in between.
 *
 * ## Nothing the client sends reaches a URL column
 *
 * A key is a bucket-relative path the SERVER minted
 * (`<folder>/<uuid>-<variant>.<ext>`). The client echoes it back, so it is
 * untrusted input: every key goes through `validateImageStoreKey` — the same
 * gate the delivery route uses, which rejects traversal, absolute and Windows
 * paths, the private `applications/documents/` prefix and any non-image
 * extension. The four public URLs are then DERIVED from the validated keys by
 * `imageUploadService.getImageUrl`, never taken from the body, so a caller
 * cannot get an arbitrary string rendered as a listing photo.
 *
 * What a key is NOT is a capability. Nothing here proves the caller uploaded
 * the object it names, so an authenticated host could name the key of a photo
 * already published on somebody else's listing and show it on their own. That
 * is the same thing they could do by right-clicking the image, and it is the
 * reason the private prefix is refused above — the keys this route can reach
 * are the ones the public delivery route already serves to anyone. Proving
 * ownership would mean remembering who uploaded what, which is a table, and the
 * thing it would prevent is a copied photo rather than a leaked one.
 *
 * `bytes`, `width` and `height` are the one soft spot: they are advisory
 * metadata echoed from the upload response, clamped to non-negative integers
 * here, and never a security boundary. Verifying them would mean fetching every
 * variant back out of object storage on every publish, which buys nothing — the
 * worst a wrong number can do is misreport a file size.
 *
 * A photo that already HAS a row (every photo an edit loads back from the
 * server) is identified by `imageId` alone; its URLs are read from the row
 * rather than from the request, for the same reason.
 */

import type { ImageVariantName } from '@homiio/shared-types';

import { findImagesByIds, type ImageRow } from '../../db/images/imageWrites';
import type { NewPropertyImageUpload, PropertyImageInput } from '../../db/properties/propertyWrites';
import imageUploadService from '../../services/imageUploadService';
import { validateImageStoreKey } from '../../utils/imageStoreKey';
import { AppError } from '../../middlewares/errorHandler';

/** The four variants a processed upload always has; all or nothing. */
const VARIANTS: readonly ImageVariantName[] = ['original', 'small', 'medium', 'large'];

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

/**
 * The stored format, read off the ORIGINAL key's extension rather than taken
 * from the body. `images.format` is `NOT NULL` and describes bytes the server
 * produced, so the server's own filename is the honest source: the upload
 * pipeline names the file `<uuid>-original.<format>`.
 */
function formatOf(originalKey: string): string {
  const extension = originalKey.slice(originalKey.lastIndexOf('.') + 1).toLowerCase();
  return extension === 'jpg' ? 'jpeg' : extension;
}

/**
 * Read the four variant keys off a request entry and validate every one of
 * them. Accepts both shapes the upload endpoint has returned: the flat
 * `{ original, small, medium, large }` map, and the
 * `{ original, variants: { … } }` pair the single-upload response carries.
 */
function variantKeys(entry: Record<string, unknown>, index: number): Record<string, string> {
  const keys = asRecord(entry.keys);
  if (!keys) reject(index, 'has no imageId and no upload keys to create one from');
  const variants = asRecord(keys.variants) ?? keys;

  const validated: Record<string, string> = {};
  for (const variant of VARIANTS) {
    const raw = text(variant === 'original' ? (keys.original ?? variants.original) : variants[variant]);
    if (raw === undefined) reject(index, `is missing the ${variant} variant key`);
    const check = validateImageStoreKey(raw);
    // The rejection reason is echoed: these keys came from our own upload
    // response, so a host seeing this has a real problem worth naming.
    if (!check.ok) reject(index, `${variant} key rejected (${check.reason})`);
    validated[variant] = check.key;
  }
  return validated;
}

function uploadBlock(entry: Record<string, unknown>, index: number): NewPropertyImageUpload {
  const keys = variantKeys(entry, index);
  const metadata = asRecord(entry.metadata) ?? {};
  const complete = {
    original: keys.original,
    small: keys.small,
    medium: keys.medium,
    large: keys.large,
  };
  return {
    keys: complete,
    urls: {
      original: imageUploadService.getImageUrl(complete.original),
      small: imageUploadService.getImageUrl(complete.small),
      medium: imageUploadService.getImageUrl(complete.medium),
      large: imageUploadService.getImageUrl(complete.large),
    },
    format: formatOf(complete.original),
    // `images.bytes` is NOT NULL; 0 is this codebase's existing "not measured"
    // (see `scripts/seedImages`), not an invented figure.
    bytes: count(entry.bytes) ?? count(metadata.originalSize) ?? 0,
    width: count(entry.width) ?? count(metadata.width),
    height: count(entry.height) ?? count(metadata.height),
  };
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
export async function normalizePropertyPhotos(payload: Record<string, unknown>): Promise<void> {
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
    return { upload: uploadBlock(entry, index), caption, isPrimary, order };
  });
}
