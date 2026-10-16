/**
 * Assigns city cover photos from Wikimedia Commons — imported once into Oxy
 * Files as HOMIIO's own files (ADR 0043), stored as `entityType: 'city'`
 * images, credited. Never links listing/property photos.
 *
 * ## Imported by Oxy, credited by Homiio
 *
 * Oxy fetches the rendition itself (`importApplicationImage`) and registers
 * the city's use in the same request; importing the same Commons URL again
 * answers the existing file without a download. A Commons photo is licensed —
 * almost always CC BY or CC BY-SA, which require naming the author, the
 * licence and the source — and Oxy keeps the source URL only as hashed
 * provenance, so the credit is read from Commons' own `extmetadata` and stored
 * on the `images` row (`attribution_*`), and `GET /api/cities/:id` serves it
 * with the cover. A photo whose licence Commons does not state is skipped: a
 * cover Homiio cannot credit is not one it may show.
 *
 * `cities.cover_image_id` REFERENCES `images.id`, so the image row is created
 * FIRST and the pointer written after.
 */

import { and, eq, gt, isNull, ne, or } from 'drizzle-orm';
import type { ImageAttribution } from '@homiio/shared-types';

import { getDb } from '../db/postgres';
import { cities, countries, images } from '../db/schema';
import { importApplicationImage, insertOxyImage } from './files/publicImages';
import { isPlausibleCityName } from '../utils/plausibleCityName';
import { Logger } from '../utils/logger';

const logger = new Logger('CityCoverSyncService');

const WIKIMEDIA_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_USER_AGENT = 'Homiio-CityCoverSync/1.0 (+https://homiio.com)';
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

type ExtMetadataValue = { value?: unknown };

type WikimediaImageInfo = {
  url?: string;
  thumburl?: string;
  mime?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, ExtMetadataValue | undefined>;
};

type WikimediaSearchResponse = {
  query?: {
    pages?: Record<string, { imageinfo?: WikimediaImageInfo[] }>;
  };
};

/** A Commons photo Homiio may show: where to import it from, and its credit. */
export interface WikimediaCover {
  imageUrl: string;
  attribution: ImageAttribution;
}

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

/**
 * Commons' metadata values are HTML fragments (`<a href=…>Name</a>`). The
 * credit is shown as text, so tags and entities are reduced to plain words,
 * and an empty result is no value.
 */
export function plainText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // `&amp;` LAST: decoded first, `&amp;lt;` would become `<` — the text
    // says `&lt;`, and a second pass must not unescape what the first made.
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text.slice(0, 500) : undefined;
}

/** An `https:` URL, or undefined. */
function httpsUrl(value: unknown): string | undefined {
  const text = plainText(value);
  if (!text) return undefined;
  const withScheme = text.startsWith('//') ? `https:${text}` : text;
  return withScheme.startsWith('https://') ? withScheme : undefined;
}

/** The first result Homiio may show — an accepted type AND a stated licence. */
export function pickCoverFromSearchResponse(data: WikimediaSearchResponse): WikimediaCover | null {
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
      const imageUrl = info.thumburl ?? info.url;
      const sourceUrl = httpsUrl(info.descriptionurl);
      const license = plainText(info.extmetadata?.LicenseShortName?.value);
      if (!imageUrl || !sourceUrl || !license) {
        continue;
      }
      const author = plainText(info.extmetadata?.Artist?.value);
      const licenseUrl = httpsUrl(info.extmetadata?.LicenseUrl?.value);
      return {
        imageUrl,
        attribution: {
          sourceUrl,
          license,
          ...(licenseUrl ? { licenseUrl } : {}),
          ...(author ? { author } : {}),
        },
      };
    }
  }

  return null;
}

async function fetchWikimediaCover(
  cityName: string,
  countryName: string,
): Promise<WikimediaCover | null> {
  for (const query of buildWikimediaSearchQueries(cityName, countryName)) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6',
      gsrlimit: '5',
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
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
      const cover = pickCoverFromSearchResponse(data);
      if (cover) {
        return cover;
      }
    } catch (error) {
      logger.warn('Wikimedia search error', { query, error });
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
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
export async function ensureCover(cityId: string, options: EnsureCoverOptions = {}): Promise<void> {
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

    const cover = await fetchWikimediaCover(city.name, countryName);
    if (!cover) {
      logger.info('No creditable Wikimedia cover found for city', {
        cityId: city.id,
        cityName: city.name,
        countryName,
      });
      return;
    }

    const stored = await importApplicationImage(cover.imageUrl, {
      entityType: 'city',
      entityId: city.id,
    });
    const image = await insertOxyImage('city', city.id, stored, {
      isPrimary: true,
      order: 0,
      caption: `${city.name}, ${countryName}`,
      attribution: cover.attribution,
    });

    // Only the cover pointer is written: `insertOxyImage` already stamped
    // `entity_type='city'`/`entity_id=<city>` on the row. Writing the pointer
    // is what registers the city's use with Oxy (the cover trigger); a cover
    // it replaces stops being shown, and the unused-image sweep removes it.
    await getDb().update(cities).set({ coverImageId: image.id }).where(eq(cities.id, city.id));
    logger.info('Stored city cover from Wikimedia', {
      cityId: city.id,
      imageId: image.id,
      oxyFileId: stored.fileId,
      sourceUrl: cover.attribution.sourceUrl,
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

  // A LEFT JOIN reaches the cover image's `entity_type` directly. A missing
  // reference and a dangling one are both `images.id IS NULL` here, because the foreign key
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
