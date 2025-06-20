/**
 * Property Controller
 * Handles property-related operations
 */

const { Property } = require('../models');
const { energyService } = require('../services');
const { logger, businessLogger } = require('../middlewares/logging');
const { AppError, successResponse, paginationResponse } = require('../middlewares/errorHandler');

class PropertyController {
  /**
   * Create a new property
   */
  async createProperty(req, res, next) {
    try {
      const propertyData = {
        ...req.body,
        ownerId: req.userId
      };

      const property = new Property(propertyData);
      const validation = property.validate();
      
      if (!validation.isValid) {
        throw new AppError('Validation failed', 400, 'VALIDATION_ERROR');
      }

      // In a real implementation, save to database
      // const savedProperty = await PropertyModel.create(property);
      property.id = `prop_${Date.now()}`;

      businessLogger.propertyCreated(property.id, property.ownerId);

      res.status(201).json(successResponse(
        property.toJSON(),
        'Property created successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all properties (with pagination and filters)
   */
  async getProperties(req, res, next) {
    try {
      const {
        page = 1,
        limit = 10,
        type,
        minRent,
        maxRent,
        city,
        bedrooms,
        bathrooms,
        amenities,
        available,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // Build filters
      const filters = {};
      if (type) filters.type = type;
      if (minRent) filters.minRent = parseFloat(minRent);
      if (maxRent) filters.maxRent = parseFloat(maxRent);
      if (city) filters.city = city;
      if (bedrooms) filters.bedrooms = parseInt(bedrooms);
      if (bathrooms) filters.bathrooms = parseInt(bathrooms);
      if (amenities) filters.amenities = amenities.split(',');
      if (available !== undefined) filters.available = available === 'true';

      // In a real implementation, query database with filters
      // const { properties, total } = await PropertyModel.findWithFilters(filters, { page, limit, sortBy, sortOrder });
      
      // Mock data for demonstration
      const mockProperties = [
        new Property({
          id: 'prop_1',
          ownerId: 'user_1',
          title: 'Modern Downtown Apartment',
          address: { city: 'San Francisco', state: 'CA' },
          type: 'apartment',
          bedrooms: 2,
          bathrooms: 2,
          rent: { amount: 3500, currency: 'USD' }
        }),
        new Property({
          id: 'prop_2',
          ownerId: 'user_2',
          title: 'Cozy Suburban House',
          address: { city: 'Austin', state: 'TX' },
          type: 'house',
          bedrooms: 3,
          bathrooms: 2.5,
          rent: { amount: 2200, currency: 'USD' }
        })
      ];

      const properties = mockProperties.map(p => p.toJSON());
      const total = mockProperties.length;

      res.json(paginationResponse(
        properties,
        parseInt(page),
        parseInt(limit),
        total,
        'Properties retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get property by ID
   */
  async getPropertyById(req, res, next) {
    try {
      const { propertyId } = req.params;

      // In a real implementation, fetch from database
      // const property = await PropertyModel.findById(propertyId);
      
      const mockProperty = new Property({
        id: propertyId,
        ownerId: 'user_1',
        title: 'Modern Downtown Apartment',
        description: 'Beautiful 2-bedroom apartment with city views',
        address: {
          street: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          zipCode: '94102',
          country: 'USA'
        },
        type: 'apartment',
        bedrooms: 2,
        bathrooms: 2,
        squareFootage: 1200,
        rent: { amount: 3500, currency: 'USD', paymentFrequency: 'monthly' },
        amenities: ['gym', 'pool', 'parking', 'laundry'],
        energyMonitoring: { enabled: true, sensors: ['main_meter'] }
      });

      if (!mockProperty) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }

      // Get energy data if monitoring is enabled
      let energyData = null;
      if (mockProperty.energyMonitoring.enabled) {
        try {
          energyData = await energyService.getEnergyStats(propertyId);
        } catch (error) {
          logger.warn('Failed to get energy data for property', { propertyId, error: error.message });
        }
      }

      const response = {
        ...mockProperty.toJSON(),
        energyData
      };

      res.json(successResponse(
        response,
        'Property retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update property
   */
  async updateProperty(req, res, next) {
    try {
      const { propertyId } = req.params;
      const updateData = req.body;

      // In a real implementation, check ownership and update in database
      // const property = await PropertyModel.findById(propertyId);
      // if (property.ownerId !== req.userId) {
      //   throw new AppError('Access denied', 403, 'FORBIDDEN');
      // }

      const updatedProperty = new Property({
        id: propertyId,
        ...updateData,
        updatedAt: new Date()
      });

      const validation = updatedProperty.validate();
      if (!validation.isValid) {
        throw new AppError('Validation failed', 400, 'VALIDATION_ERROR');
      }

      res.json(successResponse(
        updatedProperty.toJSON(),
        'Property updated successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete property
   */
  async deleteProperty(req, res, next) {
    try {
      const { propertyId } = req.params;

      // In a real implementation, check ownership and soft delete
      // const property = await PropertyModel.findById(propertyId);
      // if (property.ownerId !== req.userId) {
      //   throw new AppError('Access denied', 403, 'FORBIDDEN');
      // }
      // await PropertyModel.softDelete(propertyId);

      res.json(successResponse(
        null,
        'Property deleted successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get property energy data
   */
  async getPropertyEnergyData(req, res, next) {
    try {
      const { propertyId } = req.params;
      const { period = 'day', startDate, endDate } = req.query;

      const energyData = await energyService.getEnergyStats(propertyId, period);
      
      const response = {
        propertyId,
        period,
        data: energyData
      };

      res.json(successResponse(
        response,
        'Energy data retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get properties owned by current user
   */
  async getMyProperties(req, res, next) {
    try {
      const { page = 1, limit = 10 } = req.query;
      const ownerId = req.userId;

      // In a real implementation, query database for user's properties
      // const { properties, total } = await PropertyModel.findByOwner(ownerId, { page, limit });

      const mockProperties = [
        new Property({
          id: 'prop_1',
          ownerId: ownerId,
          title: 'My Downtown Apartment',
          type: 'apartment',
          rent: { amount: 3500, currency: 'USD' },
          status: 'active'
        })
      ];

      const properties = mockProperties.map(p => p.toJSON());
      const total = mockProperties.length;

      res.json(paginationResponse(
        properties,
        parseInt(page),
        parseInt(limit),
        total,
        'Your properties retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Configure property energy monitoring
   */
  async configureEnergyMonitoring(req, res, next) {
    try {
      const { propertyId } = req.params;
      const { enabled, sensors, alertThresholds } = req.body;

      // In a real implementation, update property configuration
      const configuration = {
        enabled,
        sensors,
        alertThresholds
      };

      // Configure connected devices
      if (enabled && sensors && sensors.length > 0) {
        for (const sensor of sensors) {
          try {
            await energyService.configureDevice(sensor.deviceId, {
              samplingRate: sensor.samplingRate || 60,
              alertThresholds: alertThresholds
            });
          } catch (error) {
            logger.warn('Failed to configure device', { 
              deviceId: sensor.deviceId, 
              error: error.message 
            });
          }
        }
      }

      res.json(successResponse(
        configuration,
        'Energy monitoring configured successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Search properties
   */
  async searchProperties(req, res, next) {
    try {
      const { query, page = 1, limit = 10 } = req.query;

      // In a real implementation, perform database search
      const mockResults = [
        new Property({
          id: 'prop_search_1',
          ownerId: 'user_1',
          title: `Result for ${query}`,
          type: 'apartment',
          rent: { amount: 1000, currency: 'USD' }
        })
      ];

      res.json(paginationResponse(
        mockResults.map(p => p.toJSON()),
        parseInt(page),
        parseInt(limit),
        mockResults.length,
        'Search completed successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get property statistics
   */
  async getPropertyStats(req, res, next) {
    try {
      const { propertyId } = req.params;

      // In a real implementation, calculate statistics from database
      const stats = {
        totalRooms: 4,
        occupiedRooms: 2,
        availableRooms: 2,
        monthlyRevenue: 4500,
        averageRent: 1125,
        occupancyRate: 50
      };

      res.json(successResponse(
        stats,
        'Property statistics retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new PropertyController();
