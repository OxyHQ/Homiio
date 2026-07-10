/**
 * Seed Images helper
 *
 * Turns the demo dataset's image URLs into rows of the canonical Image
 * collection, then links them back to their owning entity. Two flows:
 *
 *   - Property photos: each property's seed photo URLs are fetched once, run
 *     through the Sharp pipeline and persisted as `Image` docs
 *     (`entityType: 'property'`). The resolved `PropertyImageRef[]` (the
 *     `{ url, caption, isPrimary }` shape the frontend already consumes, `url` =
 *     stored medium variant, plus the full variant `urls`) is returned so the
 *     seeder can embed it on the property — preserving the historical read shape
 *     while backing it with the Image collection.
 *
 *   - City covers (local demo seed only): the six curated city images (the SAME
 *     URLs the frontend `CITY_SHOWCASE` array hardcodes) are fetched ONCE,
 *     processed and stored as `Image` docs (`entityType: 'city'`). Production
 *     covers use `cityCoverSyncService` (Wikimedia Commons), not this seed path.
 *
 * Storage caveat: when object storage is not configured (no S3 credentials —
 * e.g. this local seed environment), the Image documents are still created with
 * REAL Sharp-derived dimensions/format/byte sizes and the variant keys/urls
 * where the bytes WOULD live; only the upload of the processed bytes is skipped
 * (via `allowUnconfiguredStorage`). Nothing is faked — the structure and linkage
 * are correct, and a credentialed environment uploads the bytes unchanged.
 */

import type { Types } from 'mongoose';
import type { ImageEntityType, PropertyImageRef } from '@homiio/shared-types';
import imageUploadService, { type ImageBufferInput } from '../services/imageUploadService';
import { toPropertyImages } from '../services/imageSerializer';
import { Logger } from '../utils/logger';

const logger = new Logger('SeedImages');

/** Abort budget (ms) for fetching one seed image. */
const FETCH_TIMEOUT_MS = 20_000;

/** Fallback MIME type when a fetched image omits a usable Content-Type. */
const DEFAULT_IMAGE_MIME = 'image/jpeg';

/**
 * Descriptive User-Agent for image fetches. Wikimedia Commons (a source of some
 * curated city covers) REQUIRES an identifying User-Agent and rate-limits
 * generic ones; this also keeps Unsplash fetches polite.
 */
const FETCH_USER_AGENT = 'Homiio-Seed/1.0 (+https://homiio.com)';

/**
 * Curated city cover images, keyed by the seeded city name (must match `seedGeo`
 * CITIES names, including diacritics: `València`, `Málaga`). Fetched once and
 * stored in our own object storage so the runtime never depends on an external
 * image host.
 *
 * Barcelona / Madrid / Málaga are the SAME Unsplash URLs the frontend
 * `CITY_SHOWCASE` array uses. The frontend's València / Sevilla / Bilbao Unsplash
 * URLs now 404 (a frontend-data bug — see the contract note for the frontend
 * agent), so those three use stable, verified Wikimedia Commons photos of each
 * city's iconic landmark (City of Arts and Sciences / Plaza de España /
 * Guggenheim) instead. Fetch-once-then-store makes this rot invisible at runtime.
 */
export const CITY_COVER_IMAGE_URLS: Readonly<Record<string, string>> = {
  Barcelona:
    'https://images.unsplash.com/photo-1583422409516-2895a77efded?auto=format&fit=crop&w=1280&q=80',
  Madrid:
    'https://images.unsplash.com/photo-1543783207-ec64e4d95325?auto=format&fit=crop&w=1280&q=80',
  València:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/City_of_Arts_and_Sciences%2C_Valencia%2C_Spain.jpg/1280px-City_of_Arts_and_Sciences%2C_Valencia%2C_Spain.jpg',
  Sevilla:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Plaza_de_Espa%C3%B1a_%28Sevilla%29_-_01.jpg/1280px-Plaza_de_Espa%C3%B1a_%28Sevilla%29_-_01.jpg',
  Málaga:
    'https://images.unsplash.com/photo-1601158935942-52255782d322?auto=format&fit=crop&w=1280&q=80',
  Bilbao:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Bilbao_-_Museo_Guggenheim_01.jpg/1280px-Bilbao_-_Museo_Guggenheim_01.jpg',
};

/** Fetch one image URL into a buffer + its resolved MIME type. Throws on failure. */
async function fetchImageBuffer(url: string): Promise<ImageBufferInput> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': FETCH_USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`Image fetch failed: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type');
    const mimetype = contentType && contentType.startsWith('image/') ? contentType : DEFAULT_IMAGE_MIME;
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimetype };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the seed should skip the actual byte upload (storage unconfigured).
 * When true, Image docs are still created with real metadata + keys/urls.
 */
function shouldAllowUnconfiguredStorage(): boolean {
  return !imageUploadService.isStorageConfigured();
}

/**
 * Create Image docs (`entityType: 'property'`) for a property's photo URLs and
 * return the resolved embedded `PropertyImageRef[]` (ordered, exactly one
 * primary). The first URL becomes the primary/cover image.
 */
export async function seedPropertyImages(
  propertyId: Types.ObjectId | string,
  imageUrls: readonly string[]
): Promise<PropertyImageRef[]> {
  const allowUnconfiguredStorage = shouldAllowUnconfiguredStorage();
  const created = [];

  for (let index = 0; index < imageUrls.length; index += 1) {
    const input = await fetchImageBuffer(imageUrls[index]);
    const image = await imageUploadService.createImageForEntity('property', propertyId, input, {
      isPrimary: index === 0,
      order: index,
      allowUnconfiguredStorage,
    });
    created.push(image);
  }

  return toPropertyImages(created);
}

/**
 * Fetch + store a single cover image for a geo entity (city / region / country)
 * and return the created Image document's id. Returns null when no curated URL
 * is available for the entity.
 */
export async function seedEntityCoverImage(
  entityType: ImageEntityType,
  entityId: Types.ObjectId | string,
  url: string | undefined,
  caption: string
): Promise<Types.ObjectId | null> {
  if (!url) return null;
  const allowUnconfiguredStorage = shouldAllowUnconfiguredStorage();
  const input = await fetchImageBuffer(url);
  const image = await imageUploadService.createImageForEntity(entityType, entityId, input, {
    isPrimary: true,
    order: 0,
    caption,
    allowUnconfiguredStorage,
  });
  return image._id;
}

/** Log the storage mode once at the start of an image-seeding run. */
export function logStorageMode(): void {
  if (imageUploadService.isStorageConfigured()) {
    logger.info('Object storage configured — seed images will be uploaded to S3.');
  } else {
    logger.info(
      'Object storage NOT configured (no S3 credentials): processed image bytes are persisted to the self-hosted local store and served by the backend at /api/images/file/*. Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY to use S3 instead.'
    );
  }
}
