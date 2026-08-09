/**
 * The DB-owned geo hierarchy: `countries` → `regions` → `cities` →
 * `neighborhoods`.
 *
 * Ported from `models/schemas/{Country,Region,City,Neighborhood}Schema.ts`.
 * These four are the root of Homiio's foreign-key graph — an `addresses` row
 * references three of them, and every property reaches its place through an
 * address — which is why they land in migration 0000.
 *
 * See `CONVENTIONS.md` for the rules every decision below follows.
 */

import { boolean, check, doublePrecision, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxyhq/db';
import { LISTING_CURRENCIES } from '@homiio/shared-types';
import { images } from './images';

export const countries = pgTable(
  'countries',
  {
    id: generatedId(),

    /**
     * ISO-3166-1 alpha-2 code, uppercase (`ES`).
     *
     * Mongoose declared `uppercase: true` and a `^[A-Z]{2}$` validator. Neither
     * becomes a constraint here — see CONVENTIONS.md §"Mongoose behaviour that
     * has no schema counterpart" and §"Format validators are deferred".
     */
    code: text().notNull(),
    /** Canonical English display name (`Spain`). */
    name: text().notNull(),
    /** Default currency for the country. */
    currency: text({ enum: LISTING_CURRENCIES }).notNull().default('EUR'),
    /** Optional emoji flag. */
    flag: text(),
    /** Optional BCP-47 default locale (`es-ES`). */
    defaultLocale: text(),
    isActive: boolean().notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('countries_code_key').on(table.code),
    // `geoResolutionService` and `cityController` look a country up by
    // `{ $regex: '^name$', $options: 'i' }` — a case-insensitive EQUALITY, not a
    // search. A functional index on `lower(name)` is what makes the Postgres
    // form (`lower(name) = lower($1)`) index-backed.
    //
    // The Mongo `{ name: 'text' }` index is deliberately NOT ported: nothing
    // ever issued a `$text` query against countries, so it was dead weight. And
    // no trigram index here either — countries are never typeahead-searched, and
    // an index nobody queries is a write cost with no read.
    index('countries_name_lower_idx').on(sql`lower(${table.name})`),
    check(
      'countries_currency_check',
      sql`${table.currency} in (${sql.raw(inList(LISTING_CURRENCIES))})`,
    ),
  ],
);

export const regions = pgTable(
  'regions',
  {
    id: generatedId(),

    countryId: text()
      .notNull()
      // RESTRICT: a country with regions under it must not be deletable. Nothing
      // deletes a country today, and the correct answer if anything ever tries
      // is to refuse rather than to orphan or cascade-destroy an entire
      // country's geo tree — and every address beneath it.
      .references(() => countries.id, { onDelete: 'restrict' }),
    /** ISO-3166-2 subdivision code where one exists (`ES-CT`). */
    code: text(),
    /** Canonical display name (`Catalonia`). */
    name: text().notNull(),
    /**
     * The region's cover photo.
     *
     * SET NULL: deleting the image must not delete the region. NULL already
     * means "no cover" here, so the action introduces no second meaning.
     */
    coverImageId: text().references(() => images.id, { onDelete: 'set null' }),
    isActive: boolean().notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // A region name is unique within its country ("Valencia" is a province in
    // Spain and a state in Venezuela).
    uniqueIndex('regions_country_name_key').on(table.countryId, table.name),
    // Mongo's standalone `{ countryId: 1 }` is NOT ported: it is the leading
    // prefix of the unique index above, and a btree serves any leading prefix.
    index('regions_name_lower_idx').on(sql`lower(${table.name})`),
    // The SCOPED case-insensitive lookup, and it is a different query from the
    // one above rather than a duplicate of it. `cityController.getCityByLocation`
    // and `resolveRegionRef` both resolve a region name WITHIN a country, and
    // region names genuinely collide across countries — "Valencia" is a province
    // in Spain and a state in Venezuela, which is why the unique index is scoped
    // that way in the first place. The unique `(country_id, name)` index cannot
    // serve it: that one is case-SENSITIVE.
    index('regions_country_name_lower_idx').on(table.countryId, sql`lower(${table.name})`),
  ],
);

export const cities = pgTable(
  'cities',
  {
    id: generatedId(),

    name: text().notNull(),
    countryId: text()
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    regionId: text()
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict' }),

    /**
     * Centre point, for map framing only.
     *
     * PLAIN COLUMNS, with NO `geography` column and NO GiST index — deliberately
     * different from `addresses`, and the difference is the point. Mongo has no
     * `2dsphere` index on `cities.coordinates` and nothing queries a city
     * spatially: a "cities near me" search resolves through `addresses`, which
     * is where the real spatial index lives. Adding a generated point here
     * because the columns look like the ones on `addresses` is exactly the
     * speculative index CONVENTIONS.md forbids — it would cost every write and
     * serve no read.
     *
     * **Re-examined 2026-08-09 against the instruction "para el geo habría que
     * usar PostGIS", and kept — because every proximity query really does
     * resolve through `addresses`.** The claim above was an argument; this is
     * the measurement. Every site in the package that does distance or
     * containment:
     *
     * | Site | Operator | Resolves against |
     * |---|---|---|
     * | `neighborhoodController` (the only ported PostGIS caller) | `ST_DWithin` + `ST_Distance` KNN | `.from(addresses).innerJoin(neighborhoods, …)` |
     * | `controllers/property/areaInsights` | `$near` | `Address.find` |
     * | `services/areaPriceComparison` | `$near` | `Address.find` |
     * | `controllers/property/searchQueryBuilder` | `$geoWithin` / `$centerSphere` | Address → Property |
     * | `controllers/eviction/browse` | `$geoWithin` | `eviction_cases.location`, which has its OWN geography column |
     * | `services/nearbyServicesService` | haversine in JS | Overpass POIs, an external API — not a Homiio table |
     *
     * So `cities.latitude/longitude` and `neighborhoods.latitude/longitude` are
     * read for map framing and nothing else, and the owner's instruction is
     * satisfied by `addresses.geo` (plus `eviction_cases`). Adding a generated
     * `geography` here later is a one-line, additive `pre` migration, so nothing
     * is foreclosed if a city-proximity feature ever arrives — and the honest
     * trigger for it is a query, not a resemblance.
     *
     * What DOES need guarding either way is a lat/lon transposition, which is
     * silent: the swapped pair is a valid point in the wrong hemisphere. Named
     * columns rather than a `{ lat, lng }` object make it unrepresentable in the
     * schema, and `__tests__/db/geoBackfill.test.ts` asks PostGIS for the real
     * Barcelona-to-Madrid distance after a copy, because a non-null coordinate
     * proves nothing.
     */
    latitude: doublePrecision(),
    longitude: doublePrecision(),

    timezone: text(),
    population: integer(),
    description: text(),
    averageRent: doublePrecision(),
    currency: text({ enum: LISTING_CURRENCIES }).notNull().default('EUR'),
    /** The city's cover photo (sourced from Wikimedia Commons by `cityCoverSyncService`). */
    coverImageId: text().references(() => images.id, { onDelete: 'set null' }),
    isActive: boolean().notNull().default(true),
    /** Published properties whose address resolves to this city. */
    propertiesCount: integer().notNull().default(0),
    /**
     * When `propertiesCount` was last recomputed.
     *
     * Kept ALONGSIDE `updated_at` rather than collapsed into it: they are two
     * different facts. `updated_at` moves on any write; this moves only when the
     * count is recomputed, and `cityCoverSyncService` reads it to decide what to
     * refresh.
     */
    lastUpdated: timestamptz().notNull().default(sql`date_trunc('milliseconds', now())`),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // A city name is unique within its region.
    uniqueIndex('cities_region_name_key').on(table.regionId, table.name),
    // `{ countryId: 1 }` IS ported (a country's cities are listed directly);
    // Mongo's standalone `{ regionId: 1 }` is not, being the leading prefix of
    // the unique index above.
    index('cities_country_id_idx').on(table.countryId),
    // Mongo carried `{ isActive: 1 }` and `{ propertiesCount: -1 }` as two
    // separate single-field indexes, and every real query uses them TOGETHER:
    // `cityController.listCities`, `.searchCities` and `getPopularCities` all
    // filter `isActive: true` and sort `{ propertiesCount: -1, name: 1 }`. One
    // partial composite answers all three; the two singles answered none of them
    // completely. This is the "add the index Mongo needed and lacked" case, not
    // a speculative one — it is derived from three existing call sites.
    index('cities_active_popularity_idx')
      .on(sql`${table.propertiesCount} desc`, table.name)
      .where(sql`${table.isActive}`),
    index('cities_name_lower_idx').on(sql`lower(${table.name})`),
    // The region-scoped case-insensitive lookup — `getCityByLocation` with a
    // `state`. Same reasoning as `regions_country_name_lower_idx`: city names
    // collide across regions far more often than region names collide across
    // countries, and the unique `(region_id, name)` index is case-SENSITIVE.
    index('cities_region_name_lower_idx').on(table.regionId, sql`lower(${table.name})`),
    // `searchCities` is `{ $regex: q, $options: 'i' }` with NO anchor — an
    // unanchored substring match. Its Postgres form is `ILIKE '%q%'`, which only
    // uses an index with `gin_trgm_ops`. Without this, every keystroke of the
    // city typeahead is a sequential scan.
    index('cities_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
    check(
      'cities_currency_check',
      sql`${table.currency} in (${sql.raw(inList(LISTING_CURRENCIES))})`,
    ),
  ],
);

export const neighborhoods = pgTable(
  'neighborhoods',
  {
    id: generatedId(),

    cityId: text()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    name: text().notNull(),

    /** Optional centroid for map framing. Plain columns, no `geography` — see `cities`. */
    latitude: doublePrecision(),
    longitude: doublePrecision(),

    // Mongo stored the bounding box as `bbox: [Number]` — a four-element array
    // whose ORDER carries its entire meaning (`[west, south, east, north]`).
    // Four NAMED columns make a transposition unrepresentable: `[2.1, 41.3,
    // 2.2, 41.4]` and `[41.3, 2.1, 41.4, 2.2]` are both valid arrays and only
    // one is Barcelona, whereas `bbox_west = 41.3` is obviously wrong to anyone
    // who reads it. The Mongo validator ("length 0 or 4") becomes the
    // all-or-none CHECK below, which is the same rule stated where the database
    // can enforce it.
    bboxWest: doublePrecision(),
    bboxSouth: doublePrecision(),
    bboxEast: doublePrecision(),
    bboxNorth: doublePrecision(),

    isActive: boolean().notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('neighborhoods_city_name_key').on(table.cityId, table.name),
    // Mongo's standalone `{ cityId: 1 }` is the leading prefix of the unique
    // index above and is not ported.
    index('neighborhoods_name_lower_idx').on(sql`lower(${table.name})`),
    // The city-scoped case-insensitive lookup — `getNeighborhoodByName` with a
    // `city`, and the neighborhood branch of `resolveGeoFilterAddressIds`. This
    // is the one of the three scoped indexes that earns its keep on selectivity
    // alone: neighborhood names repeat constantly across cities ("Centro", "El
    // Carmen", "Downtown"), so the unscoped `lower(name)` index would return a
    // long list to filter.
    index('neighborhoods_city_name_lower_idx').on(table.cityId, sql`lower(${table.name})`),
    // `neighborhoodController` runs the same unanchored `/q/i` typeahead as
    // `cityController.searchCities`; see the trigram index on `cities`.
    index('neighborhoods_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
    check(
      'neighborhoods_bbox_complete_check',
      sql`(
        ${table.bboxWest} is null and ${table.bboxSouth} is null
        and ${table.bboxEast} is null and ${table.bboxNorth} is null
      ) or (
        ${table.bboxWest} is not null and ${table.bboxSouth} is not null
        and ${table.bboxEast} is not null and ${table.bboxNorth} is not null
      )`,
    ),
  ],
);
