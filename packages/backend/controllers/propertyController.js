/**
 * Property Controller
 * Handles property-related operations
 */

const { Property, PropertyModel, RecentlyViewedModel } = require("../models");
const { energyService } = require("../services");
const { logger, businessLogger } = require("../middlewares/logging");
const {
  AppError,
  successResponse,
  paginationResponse,
} = require("../middlewares/errorHandler");

class PropertyController {
  /**
   * Create a new property
   */
  async createProperty(req, res, next) {
    try {
      // Check if user is authenticated
      if (!req.userId) {
        return next(
          new AppError(
            "Authentication required",
            401,
            "AUTHENTICATION_REQUIRED",
          ),
        );
      }

      const propertyData = {
        ...req.body,
        ownerId: req.userId,
      };

      // Handle location data - map to address coordinates
      if (req.body.location && req.body.location.latitude && req.body.location.longitude) {
        if (!propertyData.address) {
          propertyData.address = {};
        }
        propertyData.address.coordinates = {
          lat: req.body.location.latitude,
          lng: req.body.location.longitude
        };
        // Remove the location field as it's not part of the schema
        delete propertyData.location;
      }

      logger.info("Creating property with data", { propertyData });

      // Create and save property using Mongoose model
      const property = new PropertyModel(propertyData);
      const savedProperty = await property.save();

      businessLogger.propertyCreated(savedProperty._id, savedProperty.ownerId);

      res
        .status(201)
        .json(
          successResponse(
            savedProperty.toJSON(),
            "Property created successfully",
          ),
        );
    } catch (error) {
      if (error.name === "ValidationError") {
        const validationErrors = Object.values(error.errors).map(
          (err) => err.message,
        );
        const validationError = new AppError(
          "Property validation failed",
          400,
          "VALIDATION_ERROR",
        );
        validationError.details = validationErrors;
        return next(validationError);
      }
      next(error);
    }
  }

  /**
   * Create a new property (development/testing version without auth)
   */
  async createPropertyDev(req, res, next) {
    try {
      const propertyData = {
        ...req.body,
        ownerId: req.userId || "dev_user_" + Date.now(), // Use provided userId or generate one
      };

      logger.info("Creating property with data (dev mode)", { propertyData });

      // Create and save property using Mongoose model
      const property = new PropertyModel(propertyData);
      const savedProperty = await property.save();

      businessLogger.propertyCreated(savedProperty._id, savedProperty.ownerId);

      res
        .status(201)
        .json(
          successResponse(
            savedProperty.toJSON(),
            "Property created successfully (dev mode)",
          ),
        );
    } catch (error) {
      if (error.name === "ValidationError") {
        const validationErrors = Object.values(error.errors).map(
          (err) => err.message,
        );
        const validationError = new AppError(
          "Property validation failed",
          400,
          "VALIDATION_ERROR",
        );
        validationError.details = validationErrors;
        return next(validationError);
      }
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
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      // Build filters
      const filters = {};
      if (type) filters.type = type;
      if (city) filters["address.city"] = new RegExp(city, "i");
      if (bedrooms) filters.bedrooms = parseInt(bedrooms);
      if (bathrooms) filters.bathrooms = parseInt(bathrooms);
      if (available !== undefined) {
        filters["availability.isAvailable"] = available === "true";
        filters.status = "active";
      }
      if (amenities) {
        const amenityList = amenities.split(",");
        filters.amenities = { $in: amenityList };
      }

      // Build rent filter
      if (minRent !== undefined || maxRent !== undefined) {
        filters["rent.amount"] = {};
        if (minRent !== undefined)
          filters["rent.amount"].$gte = parseFloat(minRent);
        if (maxRent !== undefined)
          filters["rent.amount"].$lte = parseFloat(maxRent);
      }

      // Build sort options
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

      // Calculate pagination
      const pageNumber = parseInt(page);
      const limitNumber = parseInt(limit);
      const skip = (pageNumber - 1) * limitNumber;

      // Query database
      const [properties, total] = await Promise.all([
        PropertyModel.find(filters)
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNumber)
          .populate("rooms", "name type status")
          .lean(),
        PropertyModel.countDocuments(filters),
      ]);

      const totalPages = Math.ceil(total / limitNumber);

      res.json(
        paginationResponse(
          properties,
          {
            page: pageNumber,
            limit: limitNumber,
            total,
            totalPages,
            hasNext: pageNumber < totalPages,
            hasPrev: pageNumber > 1,
          },
          "Properties retrieved successfully",
        ),
      );
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

      // Fetch from database
      const property = await PropertyModel.findById(propertyId)
        .populate("rooms", "name type status availability")
        .lean();

      if (!property) {
        return next(
          new AppError("Property not found", 404, "PROPERTY_NOT_FOUND"),
        );
      }

      // Increment view count
      await PropertyModel.findByIdAndUpdate(propertyId, { $inc: { views: 1 } });

      // Update user's recently viewed list if authenticated (async, non-blocking)
      if (req.userId && (req.user?.id || req.user?._id)) {
        const oxyUserId = req.user.id || req.user._id;
        console.log(`Authenticated user ${req.userId} (Oxy ID: ${oxyUserId}) viewing property ${propertyId}`);
        
        // Track recently viewed property using OxyServices user ID
        RecentlyViewedModel.findOneAndUpdate(
          { oxyUserId, propertyId },
          { 
            oxyUserId, 
            propertyId, 
            viewedAt: new Date() 
          },
          { 
            upsert: true, 
            new: true 
          }
        )
        .then(() => {
          console.log(`Successfully tracked property ${propertyId} for Oxy user ${oxyUserId}`);
        })
        .catch((err) => {
          console.error("Failed to track recently viewed property", {
            oxyUserId,
            propertyId,
            error: err.message,
          });
          logger.warn("Failed to track recently viewed property", {
            oxyUserId,
            propertyId,
            error: err.message,
          });
        });
      } else {
        // Guest user - this is expected behavior, not an error
        console.log(`Guest user viewing property ${propertyId} - recently viewed tracking requires authentication`);
      }

      // Get energy data if monitoring is enabled
      let energyData = null;
      if (property.energyMonitoring && property.energyMonitoring.enabled) {
        try {
          energyData = await energyService.getEnergyStats(propertyId);
        } catch (error) {
          logger.warn("Failed to get energy data for property", {
            propertyId,
            error: error.message,
          });
        }
      }

      const response = {
        ...property,
        energyData,
      };

      res.json(successResponse(response, "Property retrieved successfully"));
    } catch (error) {
      if (error.name === "CastError") {
        return next(new AppError("Invalid property ID", 400, "INVALID_ID"));
      }
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
        updatedAt: new Date(),
      });

      const validation = updatedProperty.validate();
      if (!validation.isValid) {
        throw new AppError("Validation failed", 400, "VALIDATION_ERROR");
      }

      res.json(
        successResponse(
          updatedProperty.toJSON(),
          "Property updated successfully",
        ),
      );
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

      res.json(successResponse(null, "Property deleted successfully"));
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
      const { period = "day", startDate, endDate } = req.query;

      const energyData = await energyService.getEnergyStats(propertyId, period);

      const response = {
        propertyId,
        period,
        data: energyData,
      };

      res.json(successResponse(response, "Energy data retrieved successfully"));
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
          id: "prop_1",
          ownerId: ownerId,
          title: "My Downtown Apartment",
          type: "apartment",
          rent: { amount: 3500, currency: "USD" },
          status: "active",
        }),
      ];

      const properties = mockProperties.map((p) => p.toJSON());
      const total = mockProperties.length;

      res.json(
        paginationResponse(
          properties,
          parseInt(page),
          parseInt(limit),
          total,
          "Your properties retrieved successfully",
        ),
      );
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
        alertThresholds,
      };

      // Configure connected devices
      if (enabled && sensors && sensors.length > 0) {
        for (const sensor of sensors) {
          try {
            await energyService.configureDevice(sensor.deviceId, {
              samplingRate: sensor.samplingRate || 60,
              alertThresholds: alertThresholds,
            });
          } catch (error) {
            logger.warn("Failed to configure device", {
              deviceId: sensor.deviceId,
              error: error.message,
            });
          }
        }
      }

      res.json(
        successResponse(
          configuration,
          "Energy monitoring configured successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Search properties
   */
  async searchProperties(req, res, next) {
    try {
      const { 
        query, 
        type, 
        minRent, 
        maxRent, 
        bedrooms, 
        bathrooms, 
        page = 1, 
        limit = 10 
      } = req.query;

      // Build search query
      const searchQuery = {};

      // Use MongoDB text search when a query string is provided
      if (query) {
        searchQuery.$text = { $search: query };
      }

      // Filter by property type
      if (type) {
        searchQuery.type = type;
      }

      // Filter by rent range
      if (minRent || maxRent) {
        searchQuery['rent.amount'] = {};
        if (minRent) searchQuery['rent.amount'].$gte = parseInt(minRent);
        if (maxRent) searchQuery['rent.amount'].$lte = parseInt(maxRent);
      }

      // Filter by bedrooms
      if (bedrooms) {
        searchQuery.bedrooms = parseInt(bedrooms);
      }

      // Filter by bathrooms
      if (bathrooms) {
        searchQuery.bathrooms = parseInt(bathrooms);
      }

      // Only show available properties
      searchQuery['availability.isAvailable'] = true;
      searchQuery.status = 'active';

      // Execute search
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const queryOptions = PropertyModel.find(searchQuery)
        .skip(skip)
        .limit(parseInt(limit));

      // If text search was used, sort by relevance
      if (searchQuery.$text) {
        queryOptions
          .sort({ score: { $meta: 'textScore' } })
          .select({ score: { $meta: 'textScore' } });
      } else {
        queryOptions.sort({ createdAt: -1 });
      }

      const [properties, total] = await Promise.all([
        queryOptions.lean(),
        PropertyModel.countDocuments(searchQuery)
      ]);

      const totalPages = Math.ceil(total / parseInt(limit));

      res.json(
        paginationResponse(
          properties,
          parseInt(page),
          parseInt(limit),
          total,
          "Search completed successfully",
        ),
      );
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
        occupancyRate: 50,
      };

      res.json(
        successResponse(stats, "Property statistics retrieved successfully"),
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new PropertyController();
