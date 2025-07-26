/**
 * City Controller
 * Handles city-related API endpoints
 */

import { Request, Response } from 'express';
const { City, Property } = require('../models');

interface CityFilters {
  search?: string;
  state?: string;
  country?: string;
  limit?: number;
  page?: number;
}

interface PropertyFilters {
  city?: string;
  state?: string;
  country?: string;
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
   * Get all cities with optional filtering
   * GET /api/cities
   */
  async getCities(req: Request, res: Response) {
    try {
      const {
        search,
        state,
        country,
        limit = 50,
        page = 1
      }: CityFilters = req.query;

      const query: any = { isActive: true };
      const skip = (page - 1) * limit;

      // Add search filter
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { state: { $regex: search, $options: 'i' } },
          { country: { $regex: search, $options: 'i' } }
        ];
      }

      // Add state filter
      if (state) {
        query.state = { $regex: state, $options: 'i' };
      }

      // Add country filter
      if (country) {
        query.country = { $regex: country, $options: 'i' };
      }

      const cities = await City.find(query)
        .sort({ propertiesCount: -1, name: 1 })
        .skip(skip)
        .limit(limit)
        .select('-__v');

      const total = await City.countDocuments(query);

      res.json({
        success: true,
        data: cities,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching cities:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch cities',
        error: error.message
      });
    }
  }

  /**
   * Get popular cities
   * GET /api/cities/popular
   */
  async getPopularCities(req: Request, res: Response) {
    try {
      const { limit = 10 } = req.query;

      const cities = await City.getPopularCities(Number(limit));

      res.json({
        success: true,
        data: cities
      });
    } catch (error) {
      console.error('Error fetching popular cities:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch popular cities',
        error: error.message
      });
    }
  }

  /**
   * Get city by ID
   * GET /api/cities/:id
   */
  async getCityById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const city = await City.findById(id).select('-__v');

      if (!city) {
        return res.status(404).json({
          success: false,
          message: 'City not found'
        });
      }

      res.json({
        success: true,
        data: city
      });
    } catch (error) {
      console.error('Error fetching city:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch city',
        error: error.message
      });
    }
  }

  /**
   * Get city by name, state, and country
   * GET /api/cities/lookup
   */
  async getCityByLocation(req: Request, res: Response) {
    try {
      const { name, state, country = 'USA' } = req.query;

      if (!name || !state) {
        return res.status(400).json({
          success: false,
          message: 'City name and state are required'
        });
      }

      const city = await City.findOne({
        name: { $regex: name as string, $options: 'i' },
        state: { $regex: state as string, $options: 'i' },
        country: { $regex: country as string, $options: 'i' },
        isActive: true
      }).select('-__v');

      if (!city) {
        return res.status(404).json({
          success: false,
          message: 'City not found'
        });
      }

      res.json({
        success: true,
        data: city
      });
    } catch (error) {
      console.error('Error fetching city by location:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch city',
        error: error.message
      });
    }
  }

  /**
   * Get properties by city
   * GET /api/cities/:id/properties
   */
  async getPropertiesByCity(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const {
        limit = 20,
        page = 1,
        sort = 'createdAt',
        verified,
        eco,
        minBedrooms,
        maxPrice,
        minPrice
      }: PropertyFilters = req.query;

      // Get city details
      const city = await City.findById(id);
      if (!city) {
        return res.status(404).json({
          success: false,
          message: 'City not found'
        });
      }

      const skip = (page - 1) * limit;
      const query: any = {
        'address.city': { $regex: city.name, $options: 'i' },
        'address.state': { $regex: city.state, $options: 'i' },
        'address.country': { $regex: city.country, $options: 'i' },
        isActive: true
      };

      // Add filters
      if (verified === 'true') {
        query.isVerified = true;
      }

      if (eco === 'true') {
        query.isEcoFriendly = true;
      }

      if (minBedrooms) {
        query['rooms.bedrooms'] = { $gte: Number(minBedrooms) };
      }

      if (minPrice || maxPrice) {
        query['rent.amount'] = {};
        if (minPrice) query['rent.amount'].$gte = Number(minPrice);
        if (maxPrice) query['rent.amount'].$lte = Number(maxPrice);
      }

      // Build sort object
      let sortObj: any = {};
      switch (sort) {
        case 'price_asc':
          sortObj['rent.amount'] = 1;
          break;
        case 'price_desc':
          sortObj['rent.amount'] = -1;
          break;
        case 'createdAt':
          sortObj.createdAt = -1;
          break;
        case 'updatedAt':
          sortObj.updatedAt = -1;
          break;
        default:
          sortObj.createdAt = -1;
      }

      const properties = await Property.find(query)
        .sort(sortObj)
        .skip(skip)
        .limit(Number(limit))
        .populate('owner', 'name email avatar')
        .select('-__v');

      const total = await Property.countDocuments(query);

      // Update city properties count if it's outdated
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
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit))
          }
        }
      });
    } catch (error) {
      console.error('Error fetching properties by city:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch properties',
        error: error.message
      });
    }
  }

  /**
   * Create a new city
   * POST /api/cities
   */
  async createCity(req: Request, res: Response) {
    try {
      const cityData = req.body;

      const city = new City(cityData);
      await city.save();

      res.status(201).json({
        success: true,
        data: city
      });
    } catch (error) {
      console.error('Error creating city:', error);
      res.status(400).json({
        success: false,
        message: 'Failed to create city',
        error: error.message
      });
    }
  }

  /**
   * Update city properties count
   * PUT /api/cities/:id/update-count
   */
  async updateCityPropertiesCount(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const city = await City.findById(id);
      if (!city) {
        return res.status(404).json({
          success: false,
          message: 'City not found'
        });
      }

      await city.updatePropertiesCount();

      res.json({
        success: true,
        data: city
      });
    } catch (error) {
      console.error('Error updating city properties count:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update city properties count',
        error: error.message
      });
    }
  }

  /**
   * Search cities
   * GET /api/cities/search
   */
  async searchCities(req: Request, res: Response) {
    try {
      const { q, limit = 10 } = req.query;

      if (!q) {
        return res.status(400).json({
          success: false,
          message: 'Search query is required'
        });
      }

      const cities = await City.findBySearch(q as string)
        .limit(Number(limit))
        .select('-__v');

      res.json({
        success: true,
        data: cities
      });
    } catch (error) {
      console.error('Error searching cities:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search cities',
        error: error.message
      });
    }
  }
}

export default new CityController(); 