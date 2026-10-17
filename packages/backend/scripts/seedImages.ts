/**
 * Seed Images helper
 *
 * Turns the demo dataset's image URLs into photos in Oxy Files and rows of the
 * canonical `images` table. Two flows:
 *
 *   - Property photos: each seed photo URL is imported once by Oxy as a file
 *     owned by the Homiio application (`importApplicationImages`, the same path
 *     the listing ingest takes), with the listing's use registered, and
 *     recorded as an `images` row (`entity_type: 'property'`). The resolved
 *     `PropertyImageRef[]` is returned so the seeder can point
 *     `property_images` at them.
 *
 *   - City covers (local demo seed only): the six curated city images (the SAME
 *     URLs the frontend `CITY_SHOWCASE` array hardcodes), imported once and
 *     stored as `images` rows (`entity_type: 'city'`). Production covers come
 *     from `cityCoverSyncService` (Wikimedia Commons, credited).
 *
 * The seed needs an Oxy API and a Homiio service credential holding
 * `files:app:write` and `files:references:write` (`OXY_API_URL`,
 * `OXY_SERVICE_API_KEY`/`SECRET`). Without them the import fails and the seed
 * says so — there is no local storage to fall back to.
 */

import type { PropertyImageRef } from '@homiio/shared-types';

import config from '../config';
import type { ImageRow } from '../db/images/imageWrites';
import {
  importApplicationImage,
  importApplicationImages,
  insertOxyImage,
} from '../services/files/publicImages';
import { toPropertyImages } from '../services/imageSerializer';
import { Logger } from '../utils/logger';

const logger = new Logger('SeedImages');

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

/**
 * Import a property's photo URLs as `images` rows (`entityType: 'property'`)
 * and return the resolved `PropertyImageRef[]` (ordered, exactly one primary).
 * The first URL becomes the cover. A photo Oxy cannot import fails the seed:
 * a demo listing silently missing photos is a fixture nobody can trust.
 */
export async function seedPropertyImages(
  propertyId: string,
  imageUrls: readonly string[],
): Promise<PropertyImageRef[]> {
  const outcomes = await importApplicationImages(imageUrls, {
    entityType: 'property',
    entityId: propertyId,
  });
  const rows: ImageRow[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    if (!outcome.ok) {
      throw new Error(
        `Seed photo #${index} of ${propertyId} could not be imported (${outcome.status} ${outcome.code})`,
      );
    }
    rows.push(
      await insertOxyImage('property', propertyId, outcome.image, {
        isPrimary: index === 0,
        order: index,
      }),
    );
  }
  return toPropertyImages(rows);
}

/**
 * Import a single cover image for a city or region and return the created
 * `images` row's id. Returns null when no curated URL is available.
 */
export async function seedEntityCoverImage(
  entityType: 'city' | 'region',
  entityId: string,
  url: string | undefined,
  caption: string,
): Promise<string | null> {
  if (!url) return null;
  const stored = await importApplicationImage(url, { entityType, entityId });
  const row = await insertOxyImage(entityType, entityId, stored, {
    isPrimary: true,
    order: 0,
    caption,
  });
  return row.id;
}

/** Say once, at the start of a run, where seed photos are going. */
export function logStorageMode(): void {
  logger.info(
    `Seed photos are imported into Oxy Files through ${config.oxy.baseURL} as the Homiio application.`,
  );
}
