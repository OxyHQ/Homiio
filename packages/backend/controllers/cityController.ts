/**
 * City Controller
 *
 * City endpoints over the DB-owned relational geo layer. Cities reference a
 * country and a region by id; their canonical names come from a JOIN, not a
 * populate.
 *
 * ## Nothing in this file is Mongo any more
 *
 * `getPropertiesByCity` and `updateCityPropertiesCount` were the two holdouts,
 * because both COUNT PROPERTIES and `properties` did not exist in Postgres yet.
 * They now read it through `db/properties/propertyReads` — and in doing so lose
 * the uncapped `Address.find({cityId}).select('_id')` both ran to get an id list
 * for an `$in`, which for a large city was tens of thousands of ids
 * materialized before a single property was looked at.
 *
 * ## The wire format
 *
 * A city serializes with ONE id, `id` — these responses used to carry `_id`
 * beside it and no longer do. It still nests the country / region / cover image
 * as objects with their own `id`, and still reports the city centre as
 * `coordinates: { lat, lng }` even though the table stores named `latitude` /
 * `longitude` columns. {@link serializeCity} is the single place that shape is
 * built, and it OMITS absent values rather than emitting `null`, because
 * Mongoose omitted an unset path and `res.json` ships an explicit `null`.
 *
 * The one field that is genuinely gone is `imageIds` — a denormalized second
 * copy of the `images.(entity_type, entity_id)` relation that could disagree
 * with it, deleted by `db/schema/CONVENTIONS.md` §"Arrays and objects" and read
 * by nothing in the frontend.
 */

import { Request, Response } from 'express';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { getDb } from '../db/postgres';
import { escapeLikePattern } from '../db/likePattern';
import { cities, countries, images, properties as propertiesTable, regions } from '../db/schema';
import { MAX_LOOKUP_LIMIT, lookupCityPlaces, type PlaceLookupInput } from '../db/geo/placeLookup';
import { isPlausibleCityName } from '../utils/plausibleCityName';
import {
  allOf,
  countProperties,
  findProperties,
  nullsLast,
  propertyOrderBy,
  NEWEST_FIRST,
} from '../db/properties/propertyReads';
import { booleanIs, inCity, inRange, statusIs } from '../db/properties/propertyFilters';
import { serializeProperty } from '../db/properties/propertySerializer';

const DEFAULT_CITY_LIMIT = 50;
const DEFAULT_POPULAR_LIMIT = 10;
const DEFAULT_PROPERTIES_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 10;

interface CityFilters {
  search?: string;
  countryId?: string;
  countryCode?: string;
  regionId?: string;
  limit?: number;
  page?: number;
}

interface PropertyFilters {
  limit?: number;
  page?: number;
  sort?: string;
  verified?: string;
  eco?: string;
  minBedrooms?: string;
  minBathrooms?: string;
  maxPrice?: string;
  minPrice?: string;
}

/**
 * The columns every city response reads, joined to the country / region / cover
 * image the old `GEO_POPULATE` spec expanded.
 *
 * `leftJoin` on the cover image because it is genuinely optional
 * (`ON DELETE SET NULL`); the country and region are NOT NULL with RESTRICT
 * foreign keys, so their join kind cannot change the row count — the same kind
 * is used for all three so no reader has to work out which is which.
 */
function cityQuery() {
  return getDb()
    .select({
      city: cities,
      country: {
        id: countries.id,
        name: countries.name,
        code: countries.code,
        currency: countries.currency,
        flag: countries.flag,
      },
      region: { id: regions.id, name: regions.name, code: regions.code },
      coverImage: {
        id: images.id,
        urlsOriginal: images.urlsOriginal,
        urlsSmall: images.urlsSmall,
        urlsMedium: images.urlsMedium,
        urlsLarge: images.urlsLarge,
        caption: images.caption,
        width: images.width,
        height: images.height,
        entityType: images.entityType,
      },
    })
    .from(cities)
    .leftJoin(countries, eq(cities.countryId, countries.id))
    .leftJoin(regions, eq(cities.regionId, regions.id))
    .leftJoin(images, eq(cities.coverImageId, images.id));
}

type CityQueryRow = Awaited<ReturnType<typeof cityQuery>>[number];

/** Drop keys whose value is null/undefined, matching Mongoose's omission of unset paths. */
function withoutAbsent(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/** An entity's id, ahead of its own fields, as every geo response emits it. */
function withIds(id: string, rest: Record<string, unknown>): Record<string, unknown> {
  return { id, ...withoutAbsent(rest) };
}

/** Build the city response object, including its expanded refs. */
function serializeCity(row: CityQueryRow): Record<string, unknown> {
  const { city, country, region, coverImage } = row;
  const coordinates =
    typeof city.latitude === 'number' && typeof city.longitude === 'number'
      ? { lat: city.latitude, lng: city.longitude }
      : undefined;

  return withIds(city.id, {
    name: city.name,
    // The database-computed URL-safe label (#295). Emitted so a client can build
    // a link without re-implementing the slug rule — a second implementation of
    // it is exactly what `db/geo/placeSlug.ts` exists to prevent. It is a LABEL:
    // two cities can share one, which is why nothing resolves by it alone.
    slug: city.slug,
    countryId: country ? withIds(country.id, { name: country.name, code: country.code, currency: country.currency, flag: country.flag }) : city.countryId,
    regionId: region ? withIds(region.id, { name: region.name, code: region.code }) : city.regionId,
    coordinates,
    timezone: city.timezone,
    population: city.population,
    description: city.description,
    averageRent: city.averageRent,
    currency: city.currency,
    coverImageId: coverImage
      ? withIds(coverImage.id, {
          urls: {
            original: coverImage.urlsOriginal,
            small: coverImage.urlsSmall,
            medium: coverImage.urlsMedium,
            large: coverImage.urlsLarge,
          },
          caption: coverImage.caption,
          width: coverImage.width,
          height: coverImage.height,
          entityType: coverImage.entityType,
        })
      : city.coverImageId,
    isActive: city.isActive,
    propertiesCount: city.propertiesCount,
    lastUpdated: city.lastUpdated,
    createdAt: city.createdAt,
    updatedAt: city.updatedAt,
  });
}

/**
 * `lower(name) = lower($1)` — the port of `{ $regex: '^name$', $options: 'i' }`.
 *
 * That regex is a case-insensitive EQUALITY, not a search, which is why it
 * becomes `=` rather than `ILIKE`: `ILIKE` would additionally treat a `%` or `_`
 * in the term as a wildcard. The `lower(name)` functional btree indexes make it
 * an index lookup rather than the collection scan the anchored `/i` regex was.
 */
function nameEquals(column: AnyPgColumn, value: string): SQL {
  return sql`lower(${column}) = lower(${value})`;
}

/**
 * The marker a query-string parser returns for "present and malformed".
 *
 * Distinct from `undefined` ("absent") on purpose: absent is legal and means the
 * filter does not apply, malformed is a 400. Collapsing the two is how a typo'd
 * `?bounds=` silently becomes a global search.
 */
const INVALID = Symbol('invalid');

/** The first of several query aliases that carries a non-empty string. */
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function finiteNumbers(value: string, count: number): number[] | typeof INVALID {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== count || parts.some((part) => !Number.isFinite(part))) return INVALID;
  return parts;
}

/** `lng,lat` in degrees. */
function parsePoint(value: string | undefined): { longitude: number; latitude: number } | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  const parts = finiteNumbers(value, 2);
  if (parts === INVALID) return INVALID;
  const [longitude, latitude] = parts;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return INVALID;
  return { longitude, latitude };
}

/**
 * `west,south,east,north` in degrees.
 *
 * Latitude order is validated (`south <= north`); longitude order is NOT, and
 * that is the point rather than an omission: `west > east` is how a box says it
 * crosses the antimeridian (`docs/adr/0002` §9.3). Adding a `west <= east` check
 * here would silently invert every such query into its complement.
 */
function parseBounds(
  value: string | undefined,
): { west: number; south: number; east: number; north: number } | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  const parts = finiteNumbers(value, 4);
  if (parts === INVALID) return INVALID;
  const [west, south, east, north] = parts;
  if ([west, east].some((degrees) => degrees < -180 || degrees > 180)) return INVALID;
  if ([south, north].some((degrees) => degrees < -90 || degrees > 90)) return INVALID;
  if (south > north) return INVALID;
  return { west, south, east, north };
}

function parseLimit(value: string | undefined): number | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LOOKUP_LIMIT) return INVALID;
  return parsed;
}

class CityController {
  /**
   * Get all cities with optional filtering.
   * GET /api/cities
   */
  async getCities(req: Request, res: Response) {
    try {
      const {
        search,
        countryId,
        countryCode,
        regionId,
        limit = DEFAULT_CITY_LIMIT,
        page = 1,
      }: CityFilters = req.query;

      const numericLimit = Number(limit);
      const numericPage = Number(page);
      const skip = (numericPage - 1) * numericLimit;

      const conditions: SQL[] = [eq(cities.isActive, true)];

      if (search) {
        // Unanchored `{ $regex: search, $options: 'i' }` — a substring match.
        // `ILIKE '%…%'` is its port and uses the `gin_trgm_ops` index on `name`;
        // the term is escaped because `%` and `_` are LIKE metacharacters and a
        // user typing either would otherwise silently stop filtering.
        conditions.push(ilike(cities.name, `%${escapeLikePattern(String(search))}%`));
      }
      if (countryId) {
        conditions.push(eq(cities.countryId, String(countryId)));
      } else if (countryCode) {
        const country = await getDb()
          .select({ id: countries.id })
          .from(countries)
          .where(eq(countries.code, String(countryCode).toUpperCase()))
          .limit(1);
        if (!country[0]) {
          return res.json({ success: true, data: [], pagination: { page: numericPage, limit: numericLimit, total: 0, pages: 0 } });
        }
        conditions.push(eq(cities.countryId, country[0].id));
      }
      if (regionId) {
        conditions.push(eq(cities.regionId, String(regionId)));
      }

      const where = and(...conditions);
      const [rows, totals] = await Promise.all([
        cityQuery()
          .where(where)
          // `properties_count` and `name` are both NOT NULL, so Mongo's
          // "missing sorts first" and Postgres' "NULLs last" cannot differ here.
          //
          // `id` last (#295): two cities can share a name AND a listing count —
          // the two Barcelonas do — and without a unique final key their order
          // is the plan's choice, which for a PAGED list means a row can appear
          // on two pages or on none.
          .orderBy(desc(cities.propertiesCount), asc(cities.name), asc(cities.id))
          .limit(numericLimit)
          .offset(skip),
        // `count()` carries drizzle's Number mapper; postgres.js returns bigint
        // as a STRING, and an unmapped one would ship `"7"` on the wire.
        getDb().select({ total: count() }).from(cities).where(where),
      ]);
      const total = totals[0]?.total ?? 0;

      res.json({
        success: true,
        data: rows.map(serializeCity),
        pagination: {
          page: numericPage,
          limit: numericLimit,
          total,
          pages: Math.ceil(total / numericLimit),
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch cities', error: (error as Error).message });
    }
  }

  /**
   * Get popular cities.
   * GET /api/cities/popular
   */
  async getPopularCities(req: Request, res: Response) {
    try {
      const { limit = DEFAULT_POPULAR_LIMIT } = req.query;
      const numericLimit = Number(limit);
      // Over-fetch, because the plausible-name filter below runs in the
      // application and can discard an arbitrary share of the page.
      const fetchLimit = Math.max(numericLimit * 2, numericLimit);

      const rows = await cityQuery()
        .where(and(eq(cities.isActive, true), sql`${cities.coverImageId} is not null`))
        // `id` last: see `getCities` — the popular carousel is the surface where
        // a plan-dependent tie is most visible, because two same-named cities
        // would swap places between two identical loads.
        .orderBy(desc(cities.propertiesCount), asc(cities.name), asc(cities.id))
        .limit(fetchLimit);

      const filtered = rows
        // `coverImage` is null when `cover_image_id` names a row that no longer
        // exists — the same "cover failed to resolve" case the populate-based
        // check covered, now answered by the join.
        .filter((row) => isPlausibleCityName(row.city.name) && row.coverImage !== null)
        .slice(0, numericLimit)
        .map(serializeCity);

      res.json({ success: true, data: filtered });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch popular cities', error: (error as Error).message });
    }
  }

  /**
   * Get city by ID.
   * GET /api/cities/:id
   */
  async getCityById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const rows = await cityQuery().where(eq(cities.id, id)).limit(1);
      if (!rows[0]) {
        return res.status(404).json({ success: false, message: 'City not found' });
      }
      res.json({ success: true, data: serializeCity(rows[0]) });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch city', error: (error as Error).message });
    }
  }

  /**
   * Resolve a city from a token (id, name or slug) plus any discriminators.
   * GET /api/cities/lookup?name=&slug=&countryCode=&regionId=&near=&bounds=
   *
   * ## The contract, and why the status codes are what they are (#295)
   *
   * The body is the `CityLookupResult` union from `@homiio/shared-types`, and a
   * consumer switches on `status` rather than on the HTTP code:
   *
   * | Outcome | HTTP | Body |
   * |---|---|---|
   * | one place | `200` | `{ success: true, data: { status: 'resolved', place } }` |
   * | several equally valid places | `200` | `{ success: true, data: { status: 'ambiguous', code: 'AMBIGUOUS_LOCATION', candidates } }` |
   * | nothing matched | `404` | `{ success: false, code: 'PLACE_NOT_FOUND', … }` |
   * | the request itself is wrong | `400` | `{ success: false, code: 'INVALID_PLACE_QUERY', … }` |
   *
   * `ambiguous` is a **200**, and that is a decision rather than laziness: the
   * server answered the question it was asked ("which places match this?")
   * completely and correctly. Making it a 4xx would put the one answer a caller
   * most needs to render — the list to choose from — on the error path of every
   * HTTP client in the app, which is how it ends up being swallowed and replaced
   * by `candidates[0]`. The `code: 'AMBIGUOUS_LOCATION'` marker is there for the
   * caller that genuinely requires a single city; what it must never do is pick.
   *
   * `not_found` stays a **404** because it already was one, and the wire
   * contract test (`__tests__/integration/wireIdContract.test.ts`) pins the
   * shape of that error body.
   *
   * ## Compatibility
   *
   * `?name=` and `?state=`/`?country=` (names) are the parameters this endpoint
   * has always taken and they still work; `?slug=`, `?q=`, `?countryCode=`,
   * `?countryId=`, `?regionId=`, `?near=` and `?bounds=` are new. An old link
   * carrying `?city=barcelona` therefore keeps resolving — and where it is now
   * genuinely ambiguous it says so instead of quietly resolving to a different
   * city than it did last year, which is the behaviour #295 exists to remove.
   */
  async lookupCity(req: Request, res: Response) {
    try {
      const token = firstString(req.query.name, req.query.slug, req.query.q, req.query.city);
      if (!token) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PLACE_QUERY',
          message: 'A city name, slug or id is required (?name=, ?slug=, ?q= or ?city=)',
        });
      }

      const near = parsePoint(firstString(req.query.near));
      if (near === INVALID) {
        return res.status(400).json({ success: false, code: 'INVALID_PLACE_QUERY', message: '`near` must be `lng,lat` in degrees' });
      }
      const bounds = parseBounds(firstString(req.query.bounds));
      if (bounds === INVALID) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PLACE_QUERY',
          message: '`bounds` must be `west,south,east,north` in degrees, with south <= north',
        });
      }
      const limit = parseLimit(firstString(req.query.limit));
      if (limit === INVALID) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PLACE_QUERY',
          message: `\`limit\` must be a whole number between 1 and ${MAX_LOOKUP_LIMIT}`,
        });
      }

      const input: PlaceLookupInput = {
        token,
        countryCode: firstString(req.query.countryCode),
        countryId: firstString(req.query.countryId),
        country: firstString(req.query.country),
        regionId: firstString(req.query.regionId),
        // `state` is what this endpoint has always called a region.
        region: firstString(req.query.region, req.query.state),
        ...(near ? { near } : {}),
        ...(bounds ? { bounds } : {}),
        ...(limit ? { limit } : {}),
      };

      const outcome = await lookupCityPlaces(input);
      if (outcome.status === 'not_found') {
        return res.status(404).json({ success: false, code: 'PLACE_NOT_FOUND', message: 'City not found' });
      }
      if (outcome.status === 'ambiguous') {
        return res.json({
          success: true,
          data: { status: 'ambiguous', code: 'AMBIGUOUS_LOCATION', candidates: outcome.candidates },
        });
      }
      res.json({ success: true, data: { status: 'resolved', place: outcome.place } });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch city', error: (error as Error).message });
    }
  }

  /**
   * Get properties in a city, resolved relationally by `Address.cityId`.
   * GET /api/cities/:id/properties
   *
   * ONE statement, where there used to be three round trips: the city, then
   * every address id in it (`Address.find({cityId}).select('_id')`, uncapped —
   * Barcelona is tens of thousands of ids), then the properties under an `$in`
   * of that list. `addresses.city_id` is a column on the row the property read
   * already joins, so the whole middle step is a predicate now.
   */
  async getPropertiesByCity(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const {
        limit = DEFAULT_PROPERTIES_LIMIT,
        page = 1,
        sort = 'createdAt',
        verified,
        eco,
        minBedrooms,
        minBathrooms,
        maxPrice,
        minPrice,
      }: PropertyFilters = req.query;

      const cityRows = await cityQuery().where(eq(cities.id, id)).limit(1);
      if (!cityRows[0]) {
        return res.status(404).json({ success: false, message: 'City not found' });
      }
      const city = serializeCity(cityRows[0]);

      const numericLimit = Number(limit);
      const numericPage = Number(page);
      const skip = (numericPage - 1) * numericLimit;

      const where = allOf([
        inCity(id),
        statusIs('published'),
        verified === 'true' ? booleanIs(propertiesTable.isVerified, true) : undefined,
        eco === 'true' ? booleanIs(propertiesTable.isEcoFriendly, true) : undefined,
        minBedrooms ? inRange(propertiesTable.bedrooms, Number(minBedrooms), undefined) : undefined,
        minBathrooms ? inRange(propertiesTable.bathrooms, Number(minBathrooms), undefined) : undefined,
        inRange(
          propertiesTable.longTermRentMonthlyAmount,
          minPrice ? Number(minPrice) : undefined,
          maxPrice ? Number(maxPrice) : undefined,
        ),
      ]);

      // Image-bearing listings first (product rule), then the requested order.
      const withinImages: SQL[] = (() => {
        switch (sort) {
          case 'price_asc': return [nullsLast(propertiesTable.longTermRentMonthlyAmount, 'asc')];
          case 'price_desc': return [nullsLast(propertiesTable.longTermRentMonthlyAmount, 'desc')];
          case 'updatedAt': return [desc(propertiesTable.updatedAt)];
          default: return [NEWEST_FIRST];
        }
      })();

      const [hydrated, total] = await Promise.all([
        findProperties({
          where,
          orderBy: propertyOrderBy(...withinImages),
          limit: numericLimit,
          offset: skip,
        }),
        countProperties(where),
      ]);

      // Keep the cached count fresh (cheap, single field write when it drifts).
      //
      // This is the ONE write in the ported read paths, and it is safe to make
      // here: `cities.properties_count` was copied verbatim by the geo backfill
      // precisely because properties did not exist in Postgres yet, and the
      // Mongo `City` document is no longer read by any endpoint on this route.
      // It is a cache of a count this statement just computed, not a fact only
      // Mongo holds.
      if (cityRows[0].city.propertiesCount !== total) {
        await getDb()
          .update(cities)
          .set({ propertiesCount: total, lastUpdated: new Date() })
          .where(eq(cities.id, id));
      }

      const pages = Math.ceil(total / numericLimit);
      res.json({
        success: true,
        data: {
          city,
          properties: hydrated.map(serializeProperty),
          pagination: { page: numericPage, limit: numericLimit, total, pages },
          // Flat aliases for parity with `/properties/search` — the infinite city
          // hook reads `hasMore` in `getNextPageParam` and `totalPages` for display.
          hasMore: skip + hydrated.length < total,
          totalPages: pages,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch properties', error: (error as Error).message });
    }
  }

  /**
   * Create a city. Accepts country/region by id or name; resolves both to the
   * canonical country/region ids before persisting.
   * POST /api/cities
   */
  async createCity(req: Request, res: Response) {
    try {
      const { name, country, countryId, state, regionId, ...rest } = req.body;
      if (!name) {
        return res.status(400).json({ success: false, message: 'City name is required' });
      }

      const resolvedCountryId = await resolveCountryRef({ countryId, country });
      if (!resolvedCountryId) {
        return res.status(400).json({ success: false, message: 'A valid country (id or name) is required' });
      }
      const resolvedRegionId = await resolveRegionRef({ regionId, state, countryId: resolvedCountryId });
      if (!resolvedRegionId) {
        return res.status(400).json({ success: false, message: 'A valid region/state (id or name) is required' });
      }

      // The city centre arrives as `{ lat, lng }` on the wire and is stored in
      // NAMED columns, so the pair cannot be transposed on the way in.
      const coordinates = rest.coordinates as { lat?: number; lng?: number } | undefined;
      const [created] = await getDb()
        .insert(cities)
        .values({
          name: String(name),
          countryId: resolvedCountryId,
          regionId: resolvedRegionId,
          latitude: typeof coordinates?.lat === 'number' ? coordinates.lat : null,
          longitude: typeof coordinates?.lng === 'number' ? coordinates.lng : null,
          timezone: typeof rest.timezone === 'string' ? rest.timezone : null,
          population: typeof rest.population === 'number' ? rest.population : null,
          description: typeof rest.description === 'string' ? rest.description : null,
          averageRent: typeof rest.averageRent === 'number' ? rest.averageRent : null,
          ...(typeof rest.currency === 'string' ? { currency: rest.currency as typeof cities.$inferInsert.currency } : {}),
          ...(typeof rest.isActive === 'boolean' ? { isActive: rest.isActive } : {}),
        })
        .returning({ id: cities.id });

      const rows = await cityQuery().where(eq(cities.id, created.id)).limit(1);
      res.status(201).json({ success: true, data: serializeCity(rows[0]) });
    } catch (error) {
      res.status(400).json({ success: false, message: 'Failed to create city', error: (error as Error).message });
    }
  }

  /**
   * Recompute a city's properties count from its addresses.
   * PUT /api/cities/:id/update-count
   *
   * The Mongoose method this replaces (`City.updatePropertiesCount`) ran the
   * same uncapped two-phase query as the city feed did — every address id in the
   * city, then a `countDocuments` under an `$in` of them. Here it is one join.
   *
   * It counts EVERY property at an address in the city, with no status or
   * visibility filter, exactly as the method did — which is why the number it
   * writes can legitimately differ from the total the city feed reports, and why
   * that difference is preserved rather than quietly reconciled.
   */
  async updateCityPropertiesCount(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const existing = await getDb().select({ id: cities.id }).from(cities).where(eq(cities.id, id)).limit(1);
      if (!existing[0]) {
        return res.status(404).json({ success: false, message: 'City not found' });
      }

      const total = await countProperties(inCity(id));
      await getDb()
        .update(cities)
        .set({ propertiesCount: total, lastUpdated: new Date() })
        .where(eq(cities.id, id));

      const rows = await cityQuery().where(eq(cities.id, id)).limit(1);
      res.json({ success: true, data: serializeCity(rows[0]) });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update city properties count', error: (error as Error).message });
    }
  }

  /**
   * Search cities by name, country + region expanded.
   * GET /api/cities/search
   *
   * This is the TYPEAHEAD — an unanchored substring match returning a list the
   * user picks from — and it stays that. It is not a resolver and never was:
   * `/api/cities/lookup` is what answers "which city is this?", and #295 is the
   * change that stopped a caller taking `data[0]` from here and calling it an
   * answer.
   */
  async searchCities(req: Request, res: Response) {
    try {
      const { q, limit = DEFAULT_SEARCH_LIMIT } = req.query;
      if (!q) {
        return res.status(400).json({ success: false, message: 'Search query is required' });
      }
      const rows = await cityQuery()
        .where(and(ilike(cities.name, `%${escapeLikePattern(String(q))}%`), eq(cities.isActive, true)))
        // `id` last: two same-named cities with the same listing count tie on
        // both keys, and a typeahead that reorders itself between keystrokes for
        // no reason is the visible face of a plan-dependent sort.
        .orderBy(desc(cities.propertiesCount), asc(cities.name), asc(cities.id))
        .limit(Number(limit));
      res.json({ success: true, data: rows.map(serializeCity) });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to search cities', error: (error as Error).message });
    }
  }
}

/** Resolve a country ref (id or name/code) to a country id, or null. */
async function resolveCountryRef(input: { countryId?: string; country?: string }): Promise<string | null> {
  const db = getDb();
  if (input.countryId) {
    const byId = await db.select({ id: countries.id }).from(countries).where(eq(countries.id, input.countryId)).limit(1);
    if (byId[0]) return byId[0].id;
  }
  if (input.country) {
    const byName = await db
      .select({ id: countries.id })
      .from(countries)
      .where(or(eq(countries.code, String(input.country).toUpperCase()), nameEquals(countries.name, String(input.country))))
      .limit(1);
    if (byName[0]) return byName[0].id;
  }
  return null;
}

/** Resolve a region ref (id or name within a country) to a region id, or null. */
async function resolveRegionRef(input: { regionId?: string; state?: string; countryId: string }): Promise<string | null> {
  const db = getDb();
  if (input.regionId) {
    const byId = await db.select({ id: regions.id }).from(regions).where(eq(regions.id, input.regionId)).limit(1);
    if (byId[0]) return byId[0].id;
  }
  if (input.state) {
    const byName = await db
      .select({ id: regions.id })
      .from(regions)
      .where(and(nameEquals(regions.name, String(input.state)), eq(regions.countryId, input.countryId)))
      .limit(1);
    if (byName[0]) return byName[0].id;
  }
  return null;
}

const cityController = new CityController();
export default cityController;
