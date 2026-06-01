/**
 * Seed Geo Script
 *
 * Pre-seeds the DB-owned relational geo hierarchy for SPAIN:
 *   Country (ES) → Regions (autonomous communities) → Cities → (Neighborhoods).
 *
 * This is the canonical source the rest of the app reads at request time — no
 * external API is hit to display a city/region/country. Property addresses
 * resolve their geo ids against these rows (see `Address.findOrCreateCanonical`
 * → `geoResolutionService`, which upserts by the SAME canonical keys, so an
 * address whose coordinates land in a seeded city reuses the seeded row rather
 * than creating a duplicate).
 *
 * Idempotent: upserts by canonical key (Country.code, Region (countryId,name),
 * City (regionId,name), Neighborhood (cityId,name)). Re-running creates no
 * duplicates and returns the same ids.
 *
 * Exported `seedGeo()` is also called by `seedProperties.ts` so a single
 * `bun run seed:properties` produces a fully-resolved dataset.
 */

require('dotenv').config();
import type { Types } from 'mongoose';
import database from '../database/connection';

const { Country, Region, City, Neighborhood } = require('../models');

const SPAIN = { code: 'ES', name: 'Spain', currency: 'EUR', flag: '🇪🇸', defaultLocale: 'es-ES' } as const;

/** Autonomous communities (regions) of Spain seeded with their ISO-3166-2 code. */
interface RegionSeed {
  code: string;
  name: string;
}

/** A city seeded with display data and its owning region name. */
interface CitySeed {
  name: string;
  regionName: string;
  /** [longitude, latitude]. */
  coordinates: [number, number];
  population: number;
  description: string;
  timezone: string;
  /** Well-known neighborhoods, seeded into the Neighborhood collection. */
  neighborhoods: string[];
}

const REGIONS: RegionSeed[] = [
  { code: 'ES-CT', name: 'Catalonia' },
  { code: 'ES-MD', name: 'Community of Madrid' },
  { code: 'ES-VC', name: 'Valencian Community' },
  { code: 'ES-AN', name: 'Andalusia' },
  { code: 'ES-PV', name: 'Basque Country' },
  { code: 'ES-GA', name: 'Galicia' },
];

const TIMEZONE_MADRID = 'Europe/Madrid';

const CITIES: CitySeed[] = [
  {
    name: 'Barcelona',
    regionName: 'Catalonia',
    coordinates: [2.1734, 41.3851],
    population: 1620343,
    description:
      'Catalonia’s cosmopolitan capital on the Mediterranean, famed for Gaudí’s architecture, vibrant neighborhoods and a beachfront city centre.',
    timezone: TIMEZONE_MADRID,
    neighborhoods: ['Eixample', 'Gràcia', 'El Born', 'Sants', 'Poblenou', 'Barri Gòtic', 'El Raval', 'Barceloneta', 'Sarrià'],
  },
  {
    name: 'Madrid',
    regionName: 'Community of Madrid',
    coordinates: [-3.7038, 40.4168],
    population: 3223334,
    description:
      'Spain’s capital and largest city, a lively hub of world-class museums, grand boulevards and a famously late-night culture.',
    timezone: TIMEZONE_MADRID,
    neighborhoods: ['Malasaña', 'Chamberí', 'Lavapiés', 'Salamanca', 'Retiro', 'Centro'],
  },
  {
    name: 'València',
    regionName: 'Valencian Community',
    coordinates: [-0.3763, 39.4699],
    population: 800215,
    description:
      'A sunny Mediterranean port city, birthplace of paella, blending a historic old town with the futuristic City of Arts and Sciences.',
    timezone: TIMEZONE_MADRID,
    neighborhoods: ['El Carme', 'Malvarrosa', 'Ruzafa', 'Ciutat Vella'],
  },
  {
    name: 'Sevilla',
    regionName: 'Andalusia',
    coordinates: [-5.9845, 37.3891],
    population: 684234,
    description:
      'The soulful capital of Andalusia, home of flamenco, the Giralda and Plaza de España, with warm streets and orange-tree-lined plazas.',
    timezone: TIMEZONE_MADRID,
    neighborhoods: ['Triana', 'Santa Cruz', 'Macarena', 'Los Remedios'],
  },
  {
    name: 'Málaga',
    regionName: 'Andalusia',
    coordinates: [-4.4214, 36.7213],
    population: 578460,
    description:
      'A Costa del Sol gem and Picasso’s birthplace, pairing golden beaches with a revitalised arts scene and a buzzing historic centre.',
    timezone: TIMEZONE_MADRID,
    neighborhoods: ['Centro Histórico', 'Soho', 'La Malagueta', 'El Palo'],
  },
  {
    name: 'Bilbao',
    regionName: 'Basque Country',
    coordinates: [-2.9350, 43.2630],
    population: 346405,
    description:
      'The Basque Country’s reinvented industrial city, anchored by the Guggenheim Museum and renowned for its pintxos and riverfront design.',
    timezone: TIMEZONE_MADRID,
    neighborhoods: ['Casco Viejo', 'Abando', 'Indautxu', 'Deusto'],
  },
];

async function upsertCountry(): Promise<Types.ObjectId> {
  const doc = await Country.findOneAndUpdate(
    { code: SPAIN.code },
    { $set: { name: SPAIN.name, currency: SPAIN.currency, flag: SPAIN.flag, defaultLocale: SPAIN.defaultLocale, isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc._id;
}

async function upsertRegions(countryId: Types.ObjectId): Promise<Map<string, Types.ObjectId>> {
  const map = new Map<string, Types.ObjectId>();
  for (const region of REGIONS) {
    const doc = await Region.findOneAndUpdate(
      { countryId, name: region.name },
      { $set: { code: region.code, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    map.set(region.name, doc._id);
  }
  return map;
}

async function upsertCities(
  countryId: Types.ObjectId,
  regionIds: Map<string, Types.ObjectId>
): Promise<number> {
  let neighborhoodCount = 0;
  for (const city of CITIES) {
    const regionId = regionIds.get(city.regionName);
    if (!regionId) {
      throw new Error(`Region "${city.regionName}" not seeded for city "${city.name}"`);
    }
    const cityDoc = await City.findOneAndUpdate(
      { regionId, name: city.name },
      {
        $set: {
          countryId,
          coordinates: { lng: city.coordinates[0], lat: city.coordinates[1] },
          population: city.population,
          description: city.description,
          timezone: city.timezone,
          currency: SPAIN.currency,
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    for (const name of city.neighborhoods) {
      await Neighborhood.findOneAndUpdate(
        { cityId: cityDoc._id, name },
        { $set: { isActive: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      neighborhoodCount += 1;
    }
  }
  return neighborhoodCount;
}

/**
 * Seed the full Spain geo hierarchy. Idempotent. Returns a summary of the
 * counts so callers (and the CLI) can log the result.
 */
export async function seedGeo(): Promise<{ countries: number; regions: number; cities: number; neighborhoods: number }> {
  const countryId = await upsertCountry();
  const regionIds = await upsertRegions(countryId);
  const neighborhoods = await upsertCities(countryId, regionIds);
  return { countries: 1, regions: regionIds.size, cities: CITIES.length, neighborhoods };
}

/** CLI entrypoint: wipe + reseed the geo hierarchy standalone. */
async function run(): Promise<void> {
  console.log('[seed-geo] Connecting to database...');
  await database.connect();

  console.log('[seed-geo] Wiping existing geo collections...');
  await Promise.all([
    Country.deleteMany({}),
    Region.deleteMany({}),
    City.deleteMany({}),
    Neighborhood.deleteMany({}),
  ]);

  const summary = await seedGeo();
  console.log('[seed-geo] ----------------------------------------');
  console.log(`[seed-geo] Countries:     ${summary.countries}`);
  console.log(`[seed-geo] Regions:       ${summary.regions}`);
  console.log(`[seed-geo] Cities:        ${summary.cities}`);
  console.log(`[seed-geo] Neighborhoods: ${summary.neighborhoods}`);
  console.log('[seed-geo] Done.');
}

// Only auto-run when invoked directly (not when imported by seedProperties).
if (require.main === module) {
  run()
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[seed-geo] FAILED:', message);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await database.disconnect();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[seed-geo] disconnect error:', message);
      }
      process.exit(process.exitCode ?? 0);
    });
}
