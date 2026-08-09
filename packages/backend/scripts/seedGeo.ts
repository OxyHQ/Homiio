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
 * Idempotent, and now by CONSTRUCTION rather than by convention: each upsert is
 * an `INSERT ... ON CONFLICT DO UPDATE` on the table's own unique index
 * (`countries_code_key`, `regions_country_name_key`, `cities_region_name_key`,
 * `neighborhoods_city_name_key`). Where Mongo's `findOneAndUpdate({upsert:true})`
 * could interleave two racers into a duplicate, the index cannot.
 *
 * Exported `seedGeo()` is also called by `seedProperties.ts` so a single
 * `bun run seed:properties` produces a fully-resolved dataset.
 */

import 'dotenv/config';
import { sql } from 'drizzle-orm';

import { closePostgres, connectPostgres, getDb } from '../db/postgres';
import { cities, countries, neighborhoods, regions } from '../db/schema';


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

async function upsertCountry(): Promise<string> {
  const [row] = await getDb()
    .insert(countries)
    .values({
      code: SPAIN.code,
      name: SPAIN.name,
      currency: SPAIN.currency,
      flag: SPAIN.flag,
      defaultLocale: SPAIN.defaultLocale,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: countries.code,
      set: {
        name: SPAIN.name,
        currency: SPAIN.currency,
        flag: SPAIN.flag,
        defaultLocale: SPAIN.defaultLocale,
        isActive: true,
      },
    })
    .returning({ id: countries.id });
  return row.id;
}

async function upsertRegions(countryId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const region of REGIONS) {
    const [row] = await getDb()
      .insert(regions)
      .values({ countryId, name: region.name, code: region.code, isActive: true })
      .onConflictDoUpdate({
        target: [regions.countryId, regions.name],
        set: { code: region.code, isActive: true },
      })
      .returning({ id: regions.id });
    map.set(region.name, row.id);
  }
  return map;
}

async function upsertCities(countryId: string, regionIds: Map<string, string>): Promise<number> {
  let neighborhoodCount = 0;
  for (const city of CITIES) {
    const regionId = regionIds.get(city.regionName);
    if (!regionId) {
      throw new Error(`Region "${city.regionName}" not seeded for city "${city.name}"`);
    }
    // Mongo stored a `{lng, lat}` object; the table has NAMED columns, which is
    // what makes a transposed pair unrepresentable rather than merely unlikely.
    const [cityRow] = await getDb()
      .insert(cities)
      .values({
        countryId,
        regionId,
        name: city.name,
        longitude: city.coordinates[0],
        latitude: city.coordinates[1],
        population: city.population,
        description: city.description,
        timezone: city.timezone,
        currency: SPAIN.currency,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [cities.regionId, cities.name],
        set: {
          countryId,
          longitude: city.coordinates[0],
          latitude: city.coordinates[1],
          population: city.population,
          description: city.description,
          timezone: city.timezone,
          currency: SPAIN.currency,
          isActive: true,
        },
      })
      .returning({ id: cities.id });

    for (const name of city.neighborhoods) {
      await getDb()
        .insert(neighborhoods)
        .values({ cityId: cityRow.id, name, isActive: true })
        .onConflictDoUpdate({
          target: [neighborhoods.cityId, neighborhoods.name],
          set: { isActive: true },
        });
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
  await connectPostgres();

  // ONE statement, and it has to be: `addresses`, `properties` and `images` all
  // reference this hierarchy, so four independent `DELETE`s would fail on the
  // first table that something still points at. `CASCADE` is what the Mongo
  // version was silently assuming when it deleted four collections in parallel
  // and left every address pointing at a city that no longer existed.
  console.log('[seed-geo] Wiping existing geo tables...');
  await getDb().execute(
    sql`truncate table ${countries}, ${regions}, ${cities}, ${neighborhoods} cascade`,
  );

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
        await closePostgres();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[seed-geo] disconnect error:', message);
      }
      process.exit(process.exitCode ?? 0);
    });
}
