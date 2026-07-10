/**
 * Assigns city cover photos from Wikimedia Commons — fetched once, stored as
 * first-party `entityType: 'city'` images. Never links listing/property photos.
 */

import { Types } from 'mongoose';
import { City, Country, Image } from '../models';
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
  _id: Types.ObjectId;
  name: string;
  countryId: Types.ObjectId;
  coverImageId?: Types.ObjectId | null;
  imageIds?: Types.ObjectId[];
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

async function resolveCountryName(countryId: Types.ObjectId): Promise<string | null> {
  const country = await Country.findById(countryId).select('name').lean<{ name?: string }>();
  return country?.name?.trim() || null;
}

async function shouldSkipExistingCover(
  coverImageId: Types.ObjectId,
  force: boolean,
): Promise<boolean> {
  if (force) {
    return false;
  }
  const coverImage = await Image.findById(coverImageId).select('entityType').lean<{ entityType?: string }>();
  return coverImage?.entityType === 'city';
}

/** Fetch a Wikimedia cityscape and store it as this city's cover image. */
export async function ensureCover(
  cityId: Types.ObjectId | string,
  options: EnsureCoverOptions = {},
): Promise<void> {
  try {
    const city = await City.findById(cityId)
      .select('name countryId coverImageId imageIds')
      .lean<CityCoverFields>();
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
        cityId: String(city._id),
        countryId: String(city.countryId),
      });
      return;
    }

    const imageUrl = await fetchWikimediaImageUrl(city.name, countryName);
    if (!imageUrl) {
      logger.info('No Wikimedia cover found for city', {
        cityId: String(city._id),
        cityName: city.name,
        countryName,
      });
      return;
    }

    const input = await fetchImageBuffer(imageUrl);
    const allowUnconfiguredStorage = !imageUploadService.isStorageConfigured();
    const image = await imageUploadService.createImageForEntity('city', city._id, input, {
      isPrimary: true,
      order: 0,
      caption: `${city.name}, ${countryName}`,
      allowUnconfiguredStorage,
    });

    const update: Record<string, unknown> = { coverImageId: image._id };
    const existingImageIds = city.imageIds?.map(String) ?? [];
    if (!existingImageIds.includes(String(image._id))) {
      update.imageIds = [...(city.imageIds ?? []), image._id];
    }

    await City.updateOne({ _id: city._id }, { $set: update });
    logger.info('Stored city cover from Wikimedia', {
      cityId: String(city._id),
      imageId: String(image._id),
      sourceUrl: imageUrl,
    });
  } catch (error) {
    logger.error('Failed to ensure city cover', error);
  }
}

async function findCitiesNeedingCoverSync(
  limit: number,
  forceReplaceListingCovers: boolean,
): Promise<Array<{ _id: Types.ObjectId }>> {
  if (!forceReplaceListingCovers) {
    return City.find({
      isActive: true,
      propertiesCount: { $gt: 0 },
      $or: [{ coverImageId: { $exists: false } }, { coverImageId: null }],
    })
      .select('_id')
      .limit(limit)
      .lean();
  }

  return City.aggregate([
    { $match: { isActive: true, propertiesCount: { $gt: 0 } } },
    {
      $lookup: {
        from: 'images',
        localField: 'coverImageId',
        foreignField: '_id',
        as: 'coverImage',
      },
    },
    {
      $match: {
        $or: [
          { coverImageId: { $exists: false } },
          { coverImageId: null },
          { coverImage: { $size: 0 } },
          { 'coverImage.0.entityType': { $ne: 'city' } },
        ],
      },
    },
    { $project: { _id: 1 } },
    { $limit: limit },
  ]);
}

/** Backfill missing covers and optionally replace listing-linked covers. */
export async function syncCovers(options: SyncCoversOptions = {}): Promise<number> {
  const limit = options.limit ?? 50;
  const forceReplaceListingCovers = options.forceReplaceListingCovers === true;
  const cities = await findCitiesNeedingCoverSync(limit, forceReplaceListingCovers);

  for (let index = 0; index < cities.length; index += 1) {
    await ensureCover(cities[index]._id);
    if (index < cities.length - 1) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return cities.length;
}

/** Backward-compatible alias for cron callers that still import syncMissingCovers. */
export async function syncMissingCovers(options: { limit?: number } = {}): Promise<number> {
  return syncCovers({ ...options, forceReplaceListingCovers: true });
}
