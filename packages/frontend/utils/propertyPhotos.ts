/**
 * The listing's photos, between the picker and the request body.
 *
 * Two things live here because two modules need the same answer and a second
 * copy of either would drift: the cover-first arrangement `ImageUpload` draws
 * and `buildPropertyPayload` publishes, and the `images[]` entries the publish
 * body carries.
 *
 * ## What the body used to carry, and why that could not work
 *
 * `{ url, caption, isPrimary }`. No id, and no position. The server stores a
 * photo as a row in `property_images` whose `image_id` is NOT NULL and
 * references the canonical `images` row — so a body with no id could not be
 * stored at all, and a body with no position could not preserve a reorder the
 * host had just made in the grid. Publishing with photos answered 500.
 *
 * The id could not simply be added: the upload endpoint returns an `imageId`
 * that is a FRAGMENT OF A STORAGE KEY, not a row id, and it persists no row —
 * a photo is uploaded before the listing exists, and `images.entity_id` names
 * the listing. So what the body carries instead is the upload's own storage
 * KEYS, and the server mints the canonical row at publish, once the listing has
 * an id. A photo loaded back by the edit screen already has a row, and states
 * its `imageId`.
 */
import type { PropertyImageWrite } from '@homiio/shared-types';

import type { UploadedImage } from '@/services/imageUploadService';

/**
 * The primary image first, the rest in their stored order.
 *
 * The cover is a position, not just a flag: the grid draws it first, the detail
 * page leads with it, and `order` is published from this arrangement.
 */
export function coverFirst<T extends { isPrimary?: boolean }>(images: T[]): T[] {
  const primary = images.findIndex((image) => image.isPrimary);
  if (primary <= 0) return images;
  return [images[primary], ...images.filter((_, index) => index !== primary)];
}

/** The four processed variant keys, when the upload returned a complete set. */
function variantKeys(image: UploadedImage): PropertyImageWrite['keys'] | undefined {
  const { original, variants } = image.keys ?? {};
  if (!original || !variants?.small || !variants.medium || !variants.large) return undefined;
  return {
    original,
    small: variants.small,
    medium: variants.medium,
    large: variants.large,
  };
}

/**
 * The publish body's `images[]`, in the order the host arranged them.
 *
 * Position IS the order — index 0 is the cover and the only photo flagged
 * primary, which is also what keeps a body from ever claiming two covers (the
 * database permits one per listing and would reject the whole publish).
 *
 * A photo the server already stores is sent by `imageId` alone, so a save that
 * only reorders creates nothing. A photo with neither a row nor a complete set
 * of keys is dropped rather than sent: the server would refuse it, and failing
 * the whole publish over one unusable entry loses the other photos too.
 */
export function toPublishImages(images: readonly UploadedImage[] = []): PropertyImageWrite[] {
  return coverFirst([...images]).flatMap((image, index): PropertyImageWrite[] => {
    const common = {
      caption: image.caption || '',
      isPrimary: index === 0,
      order: index,
    };
    if (image.storedImageId) return [{ imageId: image.storedImageId, ...common }];
    const keys = variantKeys(image);
    if (!keys) return [];
    return [
      {
        keys,
        ...common,
        bytes: image.metadata?.originalSize,
        width: image.metadata?.width,
        height: image.metadata?.height,
      },
    ];
  });
}
