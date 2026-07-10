/**
 * One-shot / boot repair for City rows whose lat/lng were mangled by EU
 * thousands-separator parsing (e.g. Barreiros lat 43541 → 43.541).
 */

import { City } from '../models';
import { sanitizeLatLngPair } from '../utils/geoCoordinates';
import { Logger } from '../utils/logger';

const logger = new Logger('CityCoordinateRepair');

type CityCoordsLean = {
  _id: unknown;
  name: string;
  coordinates?: { lat?: number; lng?: number };
};

/**
 * Find cities with out-of-range coordinates and repair when /1000 recovers a
 * valid pair. Returns the number of cities updated.
 */
export async function repairCorruptCityCoordinates(limit = 200): Promise<number> {
  const corrupt = await City.find({
    $or: [
      { 'coordinates.lat': { $gt: 90 } },
      { 'coordinates.lat': { $lt: -90 } },
      { 'coordinates.lng': { $gt: 180 } },
      { 'coordinates.lng': { $lt: -180 } },
    ],
  })
    .select('_id name coordinates')
    .limit(limit)
    .lean<CityCoordsLean[]>();

  let repaired = 0;
  for (const city of corrupt) {
    const lat = city.coordinates?.lat;
    const lng = city.coordinates?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    const pair = sanitizeLatLngPair(lat, lng);
    if (!pair) {
      logger.warn('Could not repair city coordinates', {
        cityId: String(city._id),
        name: city.name,
        lat,
        lng,
      });
      continue;
    }

    if (pair.lat === lat && pair.lng === lng) continue;

    await City.updateOne(
      { _id: city._id },
      { $set: { 'coordinates.lat': pair.lat, 'coordinates.lng': pair.lng } },
    );
    repaired += 1;
    logger.info('Repaired city coordinates', {
      cityId: String(city._id),
      name: city.name,
      from: { lat, lng },
      to: pair,
    });
  }

  return repaired;
}
