/**
 * One-shot / boot repair for city rows whose lat/lng were mangled by EU
 * thousands-separator parsing (e.g. Barreiros lat 43541 → 43.541).
 *
 * `cities.latitude` / `cities.longitude` deliberately carry NO range CHECK — the
 * corrupt values this repairs are already stored, and a CHECK would have made
 * the migration that created the table reject them mid-copy. (`addresses` is the
 * opposite case and does carry one; see `db/schema/CONVENTIONS.md`.)
 */

import { eq, or, sql } from 'drizzle-orm';

import { getDb } from '../db/postgres';
import { cities } from '../db/schema';
import { sanitizeLatLngPair } from '../utils/geoCoordinates';
import { Logger } from '../utils/logger';

const logger = new Logger('CityCoordinateRepair');

/**
 * Find cities with out-of-range coordinates and repair when /1000 recovers a
 * valid pair. Returns the number of cities updated.
 */
export async function repairCorruptCityCoordinates(limit = 200): Promise<number> {
  const corrupt = await getDb()
    .select({ id: cities.id, name: cities.name, latitude: cities.latitude, longitude: cities.longitude })
    .from(cities)
    .where(
      or(
        sql`${cities.latitude} > 90`,
        sql`${cities.latitude} < -90`,
        sql`${cities.longitude} > 180`,
        sql`${cities.longitude} < -180`,
      ),
    )
    .limit(limit);

  let repaired = 0;
  for (const city of corrupt) {
    const lat = city.latitude;
    const lng = city.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    const pair = sanitizeLatLngPair(lat, lng);
    if (!pair) {
      logger.warn('Could not repair city coordinates', {
        cityId: city.id,
        name: city.name,
        lat,
        lng,
      });
      continue;
    }

    if (pair.lat === lat && pair.lng === lng) continue;

    await getDb().update(cities).set({ latitude: pair.lat, longitude: pair.lng }).where(eq(cities.id, city.id));
    repaired += 1;
    logger.info('Repaired city coordinates', {
      cityId: city.id,
      name: city.name,
      from: { lat, lng },
      to: pair,
    });
  }

  return repaired;
}
