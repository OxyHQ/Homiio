/**
 * Media (Image) types shared across Homiio frontend and backend.
 *
 * A single, reusable Image collection backs every photo in the product —
 * property listings, geo entities (city / region / country) and profiles. Each
 * stored photo is processed once through the Sharp pipeline into four variants
 * (small / medium / large / original) and persisted to object storage; the
 * Image document is the canonical record of those variants, their storage keys
 * and the source metadata.
 *
 * Consumers reference an Image by `_id` and read a ready-to-render `urls` map.
 * The legacy property `images[{ url, caption, isPrimary }]` shape is preserved
 * on the Property as a denormalized projection of these documents (its `url` is
 * the stored medium variant), so existing readers never break while the canonical
 * variants become available via `urls`.
 */

/**
 * The kind of entity an Image belongs to. Drives the
 * `{ entityType, entityId }` lookup that lists an entity's photos.
 */
export type ImageEntityType = 'property' | 'city' | 'region' | 'country' | 'profile';

/** The four processed renditions every stored image is resized into. */
export type ImageVariantName = 'original' | 'small' | 'medium' | 'large';

/** Object-storage keys for each processed variant (bucket-relative paths). */
export type ImageVariantKeys = Record<ImageVariantName, string>;

/** Publicly resolvable URLs for each processed variant. */
export type ImageVariantUrls = Record<ImageVariantName, string>;

/**
 * A stored image. The canonical record of one uploaded photo's processed
 * variants, their storage keys/urls and source metadata, scoped to the entity
 * it belongs to via `{ entityType, entityId }`.
 */
export interface Image {
  _id: string;
  /** Which kind of entity this image belongs to. */
  entityType: ImageEntityType;
  /** The owning entity's `_id` (Property / City / Region / Country / Profile). */
  entityId: string;
  /** Object-storage keys (bucket-relative) for each processed variant. */
  keys: ImageVariantKeys;
  /** Publicly resolvable URLs for each processed variant. */
  urls: ImageVariantUrls;
  /** Pixel width of the source image, when known. */
  width?: number;
  /** Pixel height of the source image, when known. */
  height?: number;
  /** Source image format (e.g. `jpeg`, `png`, `webp`). */
  format: string;
  /** Byte size of the stored original variant. */
  bytes: number;
  /** Optional human caption. */
  caption?: string;
  /** Whether this is the entity's primary/cover image. */
  isPrimary?: boolean;
  /** Sort order within the entity's image list (ascending). */
  order?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The denormalized image entry embedded on a Property's `images` array. Keeps
 * the historical `{ url, caption, isPrimary }` shape every reader already
 * consumes (`url` = the stored medium variant) while adding a reference to the
 * canonical {@link Image} document and its full variant `urls` for opt-in use.
 */
export interface PropertyImageRef {
  /** Reference to the canonical {@link Image} document. */
  imageId: string;
  /** Ready-to-render URL — the stored medium variant. Preserves the legacy shape. */
  url: string;
  /** Optional human caption. */
  caption?: string;
  /** Whether this is the property's primary/cover image. */
  isPrimary?: boolean;
  /** Sort order within the property's image list (ascending). */
  order?: number;
  /** All processed variant URLs, for callers that want a specific rendition. */
  urls?: ImageVariantUrls;
}
