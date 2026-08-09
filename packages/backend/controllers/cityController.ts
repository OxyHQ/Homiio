/**
 * City Controller
 *
 * City endpoints over the DB-owned relational geo layer. Cities reference a
 * country and a region by id; their canonical names come from a JOIN, not a
 * populate.
 *
 * ## What is still Mongo in this file, and why
 *
 * `getPropertiesByCity` and `updateCityPropertiesCount` both COUNT PROPERTIES,
 * and `properties` does not exist in Postgres yet (batch 3). They are left
 * exactly as they were — Mongoose city read included — rather than half-ported,
 * because a city read from one store and a property read from the other cannot
 * be joined by anything. They move with the property read path in batch 4.
 *
 * ## The wire format is unchanged
 *
 * Batch 10 owns the `_id` → `id` cut, so every response here still carries BOTH
 * (class B), still nests the country / region / cover image as objects with
 * their own `_id` + `id`, and still reports the city centre as
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
import { Types } from 'mongoose';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { City, Property, Address } from '../models';
import { getDb } from '../db/postgres';
import { escapeLikePattern } from '../db/likePattern';
import { cities, countries, images, regions } from '../db/schema';
import { isPlausibleCityName } from '../utils/plausibleCityName';
import { FIELD_HAS_IMAGES } from './property/searchQueryBuilder';
import { serializePropertyAddresses, ADDRESS_GEO_POPULATE } from '../services/propertyAddressSerializer';
import { serializePropertyImages } from '../services/imageSerializer';

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

/** Both id spellings, as every geo response has emitted since before the port. */
function withIds(id: string, rest: Record<string, unknown>): Record<string, unknown> {
  return { _id: id, id, ...withoutAbsent(rest) };
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
          .orderBy(desc(cities.propertiesCount), asc(cities.name))
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
        .orderBy(desc(cities.propertiesCount), asc(cities.name))
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
   * Get city by name, optionally narrowed by region and/or country.
   * GET /api/cities/lookup?name=&state=&country=
   */
  async getCityByLocation(req: Request, res: Response) {
    try {
      const { name, state, country } = req.query;
      if (!name) {
        return res.status(400).json({ success: false, message: 'City name is required' });
      }

      const conditions: SQL[] = [nameEquals(cities.name, String(name)), eq(cities.isActive, true)];

      // Narrow by region/country NAME by resolving to their canonical ids.
      let resolvedCountryId: string | undefined;
      if (country) {
        const countryRows = await getDb()
          .select({ id: countries.id })
          .from(countries)
          .where(or(eq(countries.code, String(country).toUpperCase()), nameEquals(countries.name, String(country))))
          .limit(1);
        if (!countryRows[0]) {
          return res.status(404).json({ success: false, message: 'City not found' });
        }
        resolvedCountryId = countryRows[0].id;
        conditions.push(eq(cities.countryId, resolvedCountryId));
      }
      if (state) {
        const regionRows = await getDb()
          .select({ id: regions.id })
          .from(regions)
          .where(
            resolvedCountryId
              ? and(nameEquals(regions.name, String(state)), eq(regions.countryId, resolvedCountryId))
              : nameEquals(regions.name, String(state)),
          )
          .limit(1);
        if (!regionRows[0]) {
          return res.status(404).json({ success: false, message: 'City not found' });
        }
        conditions.push(eq(cities.regionId, regionRows[0].id));
      }

      const rows = await cityQuery().where(and(...conditions)).limit(1);
      if (!rows[0]) {
        return res.status(404).json({ success: false, message: 'City not found' });
      }
      res.json({ success: true, data: serializeCity(rows[0]) });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch city', error: (error as Error).message });
    }
  }

  /**
   * Get properties in a city, resolved relationally by `Address.cityId`.
   * GET /api/cities/:id/properties
   *
   * STILL MONGO, deliberately: this handler counts and pages PROPERTIES, and
   * `properties` lands in batch 3. Porting the city half alone would leave a
   * Postgres city and a Mongo property with nothing to join them by. Moves with
   * the property read path in batch 4.
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

      const city = await City.findById(id).populate([
        { path: 'countryId', select: 'name code currency flag' },
        { path: 'regionId', select: 'name code' },
        { path: 'coverImageId', select: 'urls caption width height entityType' },
      ]);
      if (!city) {
        return res.status(404).json({ success: false, message: 'City not found' });
      }

      const numericLimit = Number(limit);
      const numericPage = Number(page);
      const skip = (numericPage - 1) * numericLimit;

      // Relational: all addresses whose canonical cityId is this city.
      const cityAddresses = await Address.find({ cityId: city._id }).select('_id').lean();
      const addressIds = cityAddresses.map((addr: { _id: Types.ObjectId }) => addr._id);

      if (addressIds.length === 0) {
        return res.json({
          success: true,
          message: 'Properties retrieved successfully',
          // Flat `hasMore`/`totalPages` aliases mirror `/properties/search` so
          // the infinite city hook reads paging metadata the same way; the
          // `pagination` key is kept so `normalizeEnvelope` preserves the envelope.
          data: {
            city,
            properties: [],
            pagination: { page: numericPage, limit: numericLimit, total: 0, pages: 0 },
            hasMore: false,
            totalPages: 0,
          },
        });
      }

      const query: Record<string, unknown> = {
        addressId: { $in: addressIds },
        status: 'published',
      };

      if (verified === 'true') query.isVerified = true;
      if (eco === 'true') query.isEcoFriendly = true;
      if (minBedrooms) query.bedrooms = { $gte: Number(minBedrooms) };
      if (minBathrooms) query.bathrooms = { $gte: Number(minBathrooms) };
      if (minPrice || maxPrice) {
        const priceRange: { $gte?: number; $lte?: number } = {};
        if (minPrice) priceRange.$gte = Number(minPrice);
        if (maxPrice) priceRange.$lte = Number(maxPrice);
        query['longTermRent.monthlyAmount'] = priceRange;
      }

      // Image-bearing listings first (product rule), then the requested order.
      const sortObj: Record<string, 1 | -1> = { [FIELD_HAS_IMAGES]: -1 };
      switch (sort) {
        case 'price_asc': sortObj['longTermRent.monthlyAmount'] = 1; break;
        case 'price_desc': sortObj['longTermRent.monthlyAmount'] = -1; break;
        case 'updatedAt': sortObj.updatedAt = -1; break;
        default: sortObj.createdAt = -1;
      }

      const [properties, total] = await Promise.all([
        Property.find(query)
          .sort(sortObj)
          .skip(skip)
          .limit(numericLimit)
          .populate(ADDRESS_GEO_POPULATE)
          .select('-__v')
          .lean(),
        Property.countDocuments(query),
      ]);

      // The lean post-find hook renames the populated `addressId` to `address`;
      // resolve each address's city/region/country NAMES from the deep-populated
      // geo refs, then flatten the refs back to ids, so cards in the city view
      // render a location label without an N+1 lookup.
      serializePropertyAddresses(properties);
      serializePropertyImages(properties);

      // Keep the cached count fresh (cheap, single field write when it drifts).
      if (city.propertiesCount !== total) {
        city.propertiesCount = total;
        city.lastUpdated = new Date();
        await city.save();
      }

      const pages = Math.ceil(total / numericLimit);
      res.json({
        success: true,
        data: {
          city,
          properties,
          pagination: { page: numericPage, limit: numericLimit, total, pages },
          // Flat aliases for parity with `/properties/search` — the infinite city
          // hook reads `hasMore` in `getNextPageParam` and `totalPages` for display.
          hasMore: skip + properties.length < total,
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
   * STILL MONGO — see {@link getPropertiesByCity}; the count it recomputes is a
   * count of properties.
   */
  async updateCityPropertiesCount(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const city = await City.findById(id);
      if (!city) {
        return res.status(404).json({ success: false, message: 'City not found' });
      }
      await city.updatePropertiesCount();
      await city.populate([
        { path: 'countryId', select: 'name code currency flag' },
        { path: 'regionId', select: 'name code' },
        { path: 'coverImageId', select: 'urls caption width height entityType' },
      ]);
      res.json({ success: true, data: city });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update city properties count', error: (error as Error).message });
    }
  }

  /**
   * Search cities by name, country + region expanded.
   * GET /api/cities/search
   */
  async searchCities(req: Request, res: Response) {
    try {
      const { q, limit = DEFAULT_SEARCH_LIMIT } = req.query;
      if (!q) {
        return res.status(400).json({ success: false, message: 'Search query is required' });
      }
      const rows = await cityQuery()
        .where(and(ilike(cities.name, `%${escapeLikePattern(String(q))}%`), eq(cities.isActive, true)))
        .orderBy(desc(cities.propertiesCount), asc(cities.name))
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
