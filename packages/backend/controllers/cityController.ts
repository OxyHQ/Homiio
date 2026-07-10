/**
 * City Controller
 *
 * City endpoints over the DB-owned relational geo layer. Cities reference a
 * Country and a Region by id; their canonical names are read via populate.
 * Properties are resolved by `Address.cityId` (no free-text city matching).
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { City, Country, Region, Property, Address } from '../models';
import { isPlausibleCityName } from '../utils/plausibleCityName';
const {
  serializePropertyAddresses,
  ADDRESS_GEO_POPULATE,
} = require('../services/propertyAddressSerializer');
const { serializePropertyImages } = require('../services/imageSerializer');

const DEFAULT_CITY_LIMIT = 50;
const DEFAULT_POPULAR_LIMIT = 10;
const DEFAULT_PROPERTIES_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 10;

/**
 * Common populate spec so every city response carries its country + region and
 * resolves its cover image (the stored Image doc's variant `urls`/`caption`),
 * so the frontend renders the city photo from our own object storage with no
 * live external image dependency.
 */
const GEO_POPULATE = [
  { path: 'countryId', select: 'name code currency flag' },
  { path: 'regionId', select: 'name code' },
  { path: 'coverImageId', select: 'urls caption width height entityType' },
];

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
  maxPrice?: string;
  minPrice?: string;
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

      const query: Record<string, unknown> = { isActive: true };
      const numericLimit = Number(limit);
      const numericPage = Number(page);
      const skip = (numericPage - 1) * numericLimit;

      if (search) {
        query.name = { $regex: search, $options: 'i' };
      }
      if (countryId && Types.ObjectId.isValid(String(countryId))) {
        query.countryId = new Types.ObjectId(String(countryId));
      } else if (countryCode) {
        const country = await Country.findOne({ code: String(countryCode).toUpperCase() }).select('_id').lean();
        if (!country) {
          return res.json({ success: true, data: [], pagination: { page: numericPage, limit: numericLimit, total: 0, pages: 0 } });
        }
        query.countryId = country._id;
      }
      if (regionId && Types.ObjectId.isValid(String(regionId))) {
        query.regionId = new Types.ObjectId(String(regionId));
      }

      const [cities, total] = await Promise.all([
        City.find(query)
          .populate(GEO_POPULATE)
          .sort({ propertiesCount: -1, name: 1 })
          .skip(skip)
          .limit(numericLimit)
          .select('-__v'),
        City.countDocuments(query),
      ]);

      res.json({
        success: true,
        data: cities,
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
      const fetchLimit = Math.max(numericLimit * 2, numericLimit);
      const cities = await City.getPopularCities(fetchLimit).populate(GEO_POPULATE);

      const filtered = cities
        .filter((city) => isPlausibleCityName(city.name) && hasPopulatedCoverImage(city.coverImageId))
        .slice(0, numericLimit);

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
      const city = await City.findById(id).populate(GEO_POPULATE).select('-__v');
      if (!city) {
        return res.status(404).json({ success: false, message: 'City not found' });
      }
      res.json({ success: true, data: city });
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

      const query: Record<string, unknown> = {
        name: { $regex: `^${escapeRegExp(String(name))}$`, $options: 'i' },
        isActive: true,
      };

      // Narrow by region/country NAME by resolving to their canonical ids.
      if (country) {
        const countryDoc = await Country.findOne({
          $or: [
            { code: String(country).toUpperCase() },
            { name: { $regex: `^${escapeRegExp(String(country))}$`, $options: 'i' } },
          ],
        }).select('_id').lean();
        if (!countryDoc) {
          return res.status(404).json({ success: false, message: 'City not found' });
        }
        query.countryId = countryDoc._id;
      }
      if (state) {
        const regionDoc = await Region.findOne({
          name: { $regex: `^${escapeRegExp(String(state))}$`, $options: 'i' },
          ...(query.countryId ? { countryId: query.countryId } : {}),
        }).select('_id').lean();
        if (!regionDoc) {
          return res.status(404).json({ success: false, message: 'City not found' });
        }
        query.regionId = regionDoc._id;
      }

      const city = await City.findOne(query).populate(GEO_POPULATE).select('-__v');
      if (!city) {
        return res.status(404).json({ success: false, message: 'City not found' });
      }
      res.json({ success: true, data: city });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch city', error: (error as Error).message });
    }
  }

  /**
   * Get properties in a city, resolved relationally by `Address.cityId`.
   * GET /api/cities/:id/properties
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
        maxPrice,
        minPrice,
      }: PropertyFilters = req.query;

      const city = await City.findById(id).populate(GEO_POPULATE);
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
          data: { city, properties: [], pagination: { page: numericPage, limit: numericLimit, total: 0, pages: 0 } },
        });
      }

      const query: Record<string, unknown> = {
        addressId: { $in: addressIds },
        status: 'published',
      };

      if (verified === 'true') query.isVerified = true;
      if (eco === 'true') query.isEcoFriendly = true;
      if (minBedrooms) query.bedrooms = { $gte: Number(minBedrooms) };
      if (minPrice || maxPrice) {
        const priceRange: { $gte?: number; $lte?: number } = {};
        if (minPrice) priceRange.$gte = Number(minPrice);
        if (maxPrice) priceRange.$lte = Number(maxPrice);
        query['longTermRent.monthlyAmount'] = priceRange;
      }

      const sortObj: Record<string, 1 | -1> = {};
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

      res.json({
        success: true,
        data: {
          city,
          properties,
          pagination: { page: numericPage, limit: numericLimit, total, pages: Math.ceil(total / numericLimit) },
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch properties', error: (error as Error).message });
    }
  }

  /**
   * Create a city. Accepts country/region by id or name; resolves both to the
   * canonical Country/Region ids before persisting.
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

      const city = new City({ ...rest, name, countryId: resolvedCountryId, regionId: resolvedRegionId });
      await city.save();
      await city.populate(GEO_POPULATE);

      res.status(201).json({ success: true, data: city });
    } catch (error) {
      res.status(400).json({ success: false, message: 'Failed to create city', error: (error as Error).message });
    }
  }

  /**
   * Recompute a city's properties count from its addresses.
   * PUT /api/cities/:id/update-count
   */
  async updateCityPropertiesCount(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const city = await City.findById(id);
      if (!city) {
        return res.status(404).json({ success: false, message: 'City not found' });
      }
      await city.updatePropertiesCount();
      await city.populate(GEO_POPULATE);
      res.json({ success: true, data: city });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update city properties count', error: (error as Error).message });
    }
  }

  /**
   * Search cities by name (text/regex), country + region populated.
   * GET /api/cities/search
   */
  async searchCities(req: Request, res: Response) {
    try {
      const { q, limit = DEFAULT_SEARCH_LIMIT } = req.query;
      if (!q) {
        return res.status(400).json({ success: false, message: 'Search query is required' });
      }
      const cities = await City.find({ name: { $regex: String(q), $options: 'i' }, isActive: true })
        .sort({ propertiesCount: -1, name: 1 })
        .limit(Number(limit))
        .populate(GEO_POPULATE)
        .select('-__v');
      res.json({ success: true, data: cities });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to search cities', error: (error as Error).message });
    }
  }
}

/** Escape a user string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when populate resolved coverImageId to an Image doc with variant urls. */
function hasPopulatedCoverImage(coverImageId: unknown): boolean {
  if (coverImageId == null || typeof coverImageId !== 'object') {
    return false;
  }
  const urls = (coverImageId as { urls?: unknown }).urls;
  return urls != null && typeof urls === 'object';
}

/** Resolve a country ref (id or name/code) to a Country `_id`, or null. */
async function resolveCountryRef(input: { countryId?: string; country?: string }): Promise<Types.ObjectId | null> {
  if (input.countryId && Types.ObjectId.isValid(input.countryId)) {
    const byId = await Country.findById(input.countryId).select('_id').lean();
    if (byId) return byId._id;
  }
  if (input.country) {
    const doc = await Country.findOne({
      $or: [
        { code: String(input.country).toUpperCase() },
        { name: { $regex: `^${escapeRegExp(String(input.country))}$`, $options: 'i' } },
      ],
    }).select('_id').lean();
    if (doc) return doc._id;
  }
  return null;
}

/** Resolve a region ref (id or name within a country) to a Region `_id`, or null. */
async function resolveRegionRef(input: { regionId?: string; state?: string; countryId: Types.ObjectId }): Promise<Types.ObjectId | null> {
  if (input.regionId && Types.ObjectId.isValid(input.regionId)) {
    const byId = await Region.findById(input.regionId).select('_id').lean();
    if (byId) return byId._id;
  }
  if (input.state) {
    const doc = await Region.findOne({
      name: { $regex: `^${escapeRegExp(String(input.state))}$`, $options: 'i' },
      countryId: input.countryId,
    }).select('_id').lean();
    if (doc) return doc._id;
  }
  return null;
}

module.exports = new CityController();
