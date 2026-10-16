/**
 * Image serializer.
 *
 * Projects `images` rows into the denormalized `Property.images[]` entries the
 * write path stores on `property_images` — the single source of truth for the
 * historical `{ url, caption, isPrimary }` read shape, so it can never drift.
 *
 * `url` is the MEDIUM rendition — the default for card and list rendering —
 * and the full `urls` map is carried alongside so callers can opt into another
 * (e.g. `large` on a detail hero). For a photo in Oxy Files those are Oxy CDN
 * renditions (`services/files/imageUrls.ts`); for a legacy row, the legacy
 * route, rewritten from a direct S3 URL if the row predates even that.
 *
 * A WRITE-path module: `db/properties/propertySerializer` handles reads.
 */

import type { ImageVariantName, PropertyImageRef } from '@homiio/shared-types';

import type { ImageRow } from '../db/images/imageWrites';
import { resolveStoredImageUrl } from './files/legacyImages';

/** The variant used as the default `url` on a denormalized property image entry. */
const DEFAULT_DISPLAY_VARIANT: ImageVariantName = 'medium';

/** The four rendition URLs of a row, each through the legacy rewrite. */
function urlsOf(row: ImageRow): Record<ImageVariantName, string> {
  return {
    original: resolveStoredImageUrl(row.urlsOriginal),
    small: resolveStoredImageUrl(row.urlsSmall),
    medium: resolveStoredImageUrl(row.urlsMedium),
    large: resolveStoredImageUrl(row.urlsLarge),
  };
}

/** The denormalized `Property.images[]` entry for one row. */
export function toPropertyImageRef(row: ImageRow): PropertyImageRef {
  const urls = urlsOf(row);
  return {
    imageId: row.id,
    url: urls[DEFAULT_DISPLAY_VARIANT],
    caption: row.caption ?? undefined,
    isPrimary: row.isPrimary ?? false,
    order: row.order ?? 0,
    urls,
  };
}

/**
 * A property's full embedded `images[]` array from its rows, ordered by each
 * row's `order` (ascending, stable). Exactly one entry is marked primary: the
 * first flagged `isPrimary`, else the first by order.
 */
export function toPropertyImages(rows: readonly ImageRow[]): PropertyImageRef[] {
  const ordered = [...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const primaryIndex = Math.max(
    0,
    ordered.findIndex((row) => row.isPrimary === true),
  );

  return ordered.map((row, index) => ({
    ...toPropertyImageRef(row),
    isPrimary: index === primaryIndex,
    order: index,
  }));
}
