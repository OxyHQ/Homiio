/**
 * Image serializer.
 *
 * Projects canonical {@link ImageDocument} records into the shapes consumers
 * expect. The single source of truth for how an Image becomes a property's
 * embedded `images[]` entry, so the historical `{ url, caption, isPrimary }`
 * read shape is defined in exactly one place and can never drift.
 *
 * `url` resolves to the stored MEDIUM variant — a sensible default for card and
 * list rendering — while the full `urls` map is carried alongside so callers
 * can opt into a specific rendition (e.g. `large` on a detail hero).
 */

import type { ImageVariantName, PropertyImageRef } from '@homiio/shared-types';
import type { ImageDocument } from './imageUploadService';

/** The variant used as the default `url` on a denormalized property image entry. */
const DEFAULT_DISPLAY_VARIANT: ImageVariantName = 'medium';

/**
 * Build the denormalized `Property.images[]` entry for one Image document.
 * `url` is the stored medium variant (preserving the legacy shape every reader
 * consumes); `urls` carries every variant for opt-in use.
 */
export function toPropertyImageRef(image: ImageDocument): PropertyImageRef {
  return {
    imageId: String(image._id),
    url: image.urls[DEFAULT_DISPLAY_VARIANT],
    caption: image.caption,
    isPrimary: image.isPrimary ?? false,
    order: image.order ?? 0,
    urls: { ...image.urls },
  };
}

/**
 * Build a property's full embedded `images[]` array from its Image documents,
 * ordered by each image's `order` (ascending, stable). Exactly one entry is
 * marked primary: the first image flagged `isPrimary`, else the first by order.
 */
export function toPropertyImages(images: readonly ImageDocument[]): PropertyImageRef[] {
  const ordered = [...images].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const primaryIndex = Math.max(
    0,
    ordered.findIndex((image) => image.isPrimary === true)
  );

  return ordered.map((image, index) => ({
    ...toPropertyImageRef(image),
    isPrimary: index === primaryIndex,
    order: index,
  }));
}
