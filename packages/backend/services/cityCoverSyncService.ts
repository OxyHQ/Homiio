/**
 * Assigns city cover photos from Wikimedia Commons — fetched once, stored as
 * first-party `entityType: 'city'` images. Never links listing/property photos.
 *
 * ## It moved WITH `imageUploadService`, because it had to
 *
 * This was the one city module that could not go to Postgres in batch 1: it
 * does not merely write a city, it creates the image FIRST, and
 * `cities.cover_image_id` REFERENCES `images.id` for real — so porting the city
 * half while the image half still minted Mongo `_id`s would have made every
 * cover write a guaranteed `23503`. Now that `createImageForEntity` writes the
 * `images` table, both halves are on the same side of the foreign key and the
 * `imageIds[]` array is gone with the Mongo document: the relation it
 * denormalized already exists as `images.(entity_type, entity_id)`.
 */

import { and, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';

import { getDb } from '../db/postgres';
import { cities, countries, images } from '../db/schema';
import imageUploadService, { type ImageBufferInput } from './imageUploadService';
import { isPlausibleCityName } from '../utils/plausibleCityName';
import { Logger } from '../utils/logger';

const logger = new Logger('CityCoverSyncService');

const WIKIMEDIA_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_USER_AGENT = 'Homiio-CityCoverSync/1.0 (+https://homiio.com)';
const DEFAULT_IMAGE_MIME = 'image/jpeg';
const BATCH_DELAY_MS = 300;

const ACCEPTED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type CityCoverFields = {
  id: string;
  name: string;
  countryId: string;
  coverImageId: string | null;
};

type EnsureCoverOptions = {
  force?: boolean;
};

type SyncCoversOptions = {
  limit?: number;
  forceReplaceListingCovers?: boolean;
};

type WikimediaImageInfo = {
  url?: string;
  thumburl?: string;
  mime?: string;
};

type WikimediaSearchResponse = {
  query?: {
    pages?: Record<string, { imageinfo?: WikimediaImageInfo[] }>;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWikimediaSearchQueries(cityName: string, countryName: string): string[] {
  return [
    `${cityName} ${countryName} skyline`,
    `${cityName} ${countryName} cityscape`,
    `${cityName} ${countryName} panorama`,
    `${cityName} ${countryName}`,
  ];
}

function pickImageUrlFromSearchResponse(data: WikimediaSearchResponse): string | null {
  const pages = data.query?.pages;
  if (!pages) {
    return null;
  }

  for (const page of Object.values(pages)) {
    for (const info of page.imageinfo ?? []) {
      const mime = info.mime?.toLowerCase();
      if (mime && !ACCEPTED_IMAGE_MIMES.has(mime)) {
        continue;
      }
      const url = info.thumburl ?? info.url;
      if (url) {
        return url;
      }
    }
  }

  return null;
}

async function fetchWikimediaImageUrl(cityName: string, countryName: string): Promise<string | null> {
  for (const query of buildWikimediaSearchQueries(cityName, countryName)) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6',
      gsrlimit: '5',
      prop: 'imageinfo',
      iiprop: 'url|mime',
      iiurlwidth: '1280',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${WIKIMEDIA_COMMONS_API}?${params}`, {
        signal: controller.signal,
        headers: { 'User-Agent': FETCH_USER_AGENT },
      });
      if (!response.ok) {
        logger.warn('Wikimedia search request failed', {
          query,
          status: response.status,
        });
        continue;
      }

      const data = (await response.json()) as WikimediaSearchResponse;
      const imageUrl = pickImageUrlFromSearchResponse(data);
      if (imageUrl) {
        return imageUrl;
      }
    } catch (error) {
      logger.warn('Wikimedia search error', { query, error });
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

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
    const mimetype =
      contentType && contentType.startsWith('image/') ? contentType : DEFAULT_IMAGE_MIME;
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimetype };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCountryName(countryId: string): Promise<string | null> {
  const [country] = await getDb()
    .select({ name: countries.name })
    .from(countries)
    .where(eq(countries.id, countryId))
    .limit(1);
  return country?.name?.trim() || null;
}

async function shouldSkipExistingCover(coverImageId: string, force: boolean): Promise<boolean> {
  if (force) {
    return false;
  }
  const [coverImage] = await getDb()
    .select({ entityType: images.entityType })
    .from(images)
    .where(eq(images.id, coverImageId))
    .limit(1);
  return coverImage?.entityType === 'city';
}

/** Fetch a Wikimedia cityscape and store it as this city's cover image. */
export async function ensureCover(
  cityId: string,
  options: EnsureCoverOptions = {},
): Promise<void> {
  try {
    const [city]: CityCoverFields[] = await getDb()
      .select({
        id: cities.id,
        name: cities.name,
        countryId: cities.countryId,
        coverImageId: cities.coverImageId,
      })
      .from(cities)
      .where(eq(cities.id, cityId))
      .limit(1);
    if (!city) {
      return;
    }
    if (!isPlausibleCityName(city.name)) {
      return;
    }

    if (city.coverImageId) {
      const skip = await shouldSkipExistingCover(city.coverImageId, options.force === true);
      if (skip) {
        return;
      }
    }

    const countryName = await resolveCountryName(city.countryId);
    if (!countryName) {
      logger.warn('Skipping city cover sync — country not found', {
        cityId: city.id,
        countryId: city.countryId,
      });
      return;
    }

    const imageUrl = await fetchWikimediaImageUrl(city.name, countryName);
    if (!imageUrl) {
      logger.info('No Wikimedia cover found for city', {
        cityId: city.id,
        cityName: city.name,
        countryName,
      });
      return;
    }

    const input = await fetchImageBuffer(imageUrl);
    const allowUnconfiguredStorage = !imageUploadService.isStorageConfigured();
    const image = await imageUploadService.createImageForEntity('city', city.id, input, {
      isPrimary: true,
      order: 0,
      caption: `${city.name}, ${countryName}`,
      allowUnconfiguredStorage,
    });

    // Only the cover pointer is written. The `imageIds[]` array the Mongo
    // document carried alongside it is gone: `createImageForEntity` already
    // stamped `entity_type='city'`/`entity_id=<city>` on the row, so the
    // membership it denormalized is a query, not a second list to keep in sync.
    await getDb()
      .update(cities)
      .set({ coverImageId: image.id })
      .where(eq(cities.id, city.id));
    logger.info('Stored city cover from Wikimedia', {
      cityId: city.id,
      imageId: image.id,
      sourceUrl: imageUrl,
    });
  } catch (error) {
    logger.error('Failed to ensure city cover', error);
  }
}

async function findCitiesNeedingCoverSync(
  limit: number,
  forceReplaceListingCovers: boolean,
): Promise<Array<{ id: string }>> {
  const active = and(eq(cities.isActive, true), gt(cities.propertiesCount, 0));

  if (!forceReplaceListingCovers) {
    return getDb()
      .select({ id: cities.id })
      .from(cities)
      .where(and(active, isNull(cities.coverImageId)))
      .limit(limit);
  }

  // The `$lookup` + second `$match` this replaces existed only to reach the
  // cover image's `entityType`. A LEFT JOIN says the same thing directly, and
  // the three Mongo branches collapse to two: a missing reference and a
  // dangling one are both `images.id IS NULL` here, because the foreign key
  // makes "points at a row that is not there" unrepresentable.
  return getDb()
    .select({ id: cities.id })
    .from(cities)
    .leftJoin(images, eq(cities.coverImageId, images.id))
    .where(and(active, or(isNull(images.id), ne(images.entityType, 'city'))))
    .limit(limit);
}

/** Backfill missing covers and optionally replace listing-linked covers. */
export async function syncCovers(options: SyncCoversOptions = {}): Promise<number> {
  const limit = options.limit ?? 50;
  const forceReplaceListingCovers = options.forceReplaceListingCovers === true;
  const citiesToSync = await findCitiesNeedingCoverSync(limit, forceReplaceListingCovers);

  for (let index = 0; index < citiesToSync.length; index += 1) {
    await ensureCover(citiesToSync[index].id);
    if (index < citiesToSync.length - 1) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return citiesToSync.length;
}

/** Backward-compatible alias for cron callers that still import syncMissingCovers. */
export async function syncMissingCovers(options: { limit?: number } = {}): Promise<number> {
  return syncCovers({ ...options, forceReplaceListingCovers: true });
}
