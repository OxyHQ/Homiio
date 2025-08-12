/**
 * Property Controller
 * Handles property-related operations
 */

const { Property, RecentlyViewed } = require("../models");
const { energyService, telegramService } = require("../services");
const { logger, businessLogger } = require("../middlewares/logging");
const {
  AppError,
  successResponse,
  paginationResponse,
} = require("../middlewares/errorHandler");
const { Profile } = require("../models");
const { ProfileType } = require("@homiio/shared-types");

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
      
      // Use the same user ID fix as in getPropertyById
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      
      if (!req.body.profileId) {
        // Try to fetch the active profile for the current user
        const Profile = require('../models').Profile;
        let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
        if (!activeProfile) {
          // Auto-create a personal profile for the user
          activeProfile = await Profile.create({
            oxyUserId: oxyUserId,
            profileType: ProfileType.PERSONAL,
            isPrimary: true,
            isActive: true,
            personalProfile: {}
          });
        }
        req.body.profileId = activeProfile._id;
      }
      const propertyData = {
        ...req.body,
        profileId: req.body.profileId,
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
      const property = new Property(propertyData);
      const savedProperty = await property.save();

      businessLogger.propertyCreated(savedProperty._id, savedProperty.profileId);

      // Send Telegram notification for new property (non-blocking)
      logger.info('Attempting to send Telegram notification for new property', {
        propertyId: savedProperty._id,
        city: savedProperty.address?.city,
        type: savedProperty.type
      });
      
      telegramService.sendPropertyNotification(savedProperty)
        .then(success => {
          if (success) {
            logger.info('Telegram notification sent successfully', {
              propertyId: savedProperty._id,
              city: savedProperty.address?.city
            });
          } else {
            logger.warn('Telegram notification failed (returned false)', {
              propertyId: savedProperty._id,
              city: savedProperty.address?.city
            });
          }
        })
        .catch(error => {
          logger.error('Failed to send Telegram notification for new property', {
            propertyId: savedProperty._id,
            error: error.message,
            stack: error.stack
          });
        });

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
          (err: any) => err.message,
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
      // Use the same user ID fix as in getPropertyById
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      
      if (!req.body.profileId) {
        // Try to fetch the active profile for the current user
        const Profile = require('../models').Profile;
        const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
        if (!activeProfile) {
          return next(
            new AppError(
              "Profile ID is required",
              400,
              "PROFILE_ID_REQUIRED",
            ),
          );
        }
        req.body.profileId = activeProfile._id;
      }
      const propertyData = {
        ...req.body,
        profileId: req.body.profileId,
      };

      logger.info("Creating property with data (dev mode)", { propertyData });

      // Create and save property using Mongoose model
      const property = new Property(propertyData);
      const savedProperty = await property.save();

      businessLogger.propertyCreated(savedProperty._id, savedProperty.profileId);

      // Send Telegram notification for new property (non-blocking)
      logger.info('Attempting to send Telegram notification for new property (dev mode)', {
        propertyId: savedProperty._id,
        city: savedProperty.address?.city,
        type: savedProperty.type
      });
      
      telegramService.sendPropertyNotification(savedProperty)
        .then(success => {
          if (success) {
            logger.info('Telegram notification sent successfully (dev mode)', {
              propertyId: savedProperty._id,
              city: savedProperty.address?.city
            });
          } else {
            logger.warn('Telegram notification failed (returned false) (dev mode)', {
              propertyId: savedProperty._id,
              city: savedProperty.address?.city
            });
          }
        })
        .catch(error => {
          logger.error('Failed to send Telegram notification for new property (dev mode)', {
            propertyId: savedProperty._id,
            error: error.message,
            stack: error.stack
          });
        });

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
          (err: any) => err.message,
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
  verified,
  eco,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      // Build filters
      const filters: any = {};
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

      // Optional verified/eco filters
      if (verified === 'true') {
        filters.isVerified = true;
      }
      if (eco === 'true') {
        filters.isEcoFriendly = true;
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
        Property.find(filters)
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNumber)
          .populate("rooms", "name type status")
          .lean(),
        Property.countDocuments(filters),
      ]);

      const totalPages = Math.ceil(total / limitNumber);

      res.json(
        paginationResponse(
          properties,
          pageNumber,
          limitNumber,
          total,
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
      console.log('[getPropertyById] Called for propertyId:', propertyId);
      const property = await Property.findById(propertyId).lean();
      if (!property) {
        return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      }

      // Increment view count
              await Property.findByIdAndUpdate(propertyId, { $inc: { views: 1 } });

      // Update recently viewed list if authenticated
      if (req.userId && (req.user?.id || req.user?._id)) {
        const oxyUserId = req.user.id || req.user._id;
        console.log(`[getPropertyById] Authenticated user ${req.userId} (Oxy ID: ${oxyUserId}) viewing property ${propertyId}`);
        
        // Get the current active profile for this Oxy user
        try {
          const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
          if (activeProfile) {
            const profileId = activeProfile._id;
            console.log(`[getPropertyById] Found active profile: ${profileId} for Oxy user ${oxyUserId}`);
            
            // Track recently viewed property using profile ID
            RecentlyViewed.findOneAndUpdate(
              { profileId, propertyId },
              { profileId, propertyId, viewedAt: new Date() },
              { upsert: true, new: true }
            )
            .then((result) => {
              console.log(`[getPropertyById] Successfully tracked property ${propertyId} for profile ${profileId}`, {
                wasNew: !result.createdAt || result.createdAt.getTime() === result.updatedAt.getTime(),
                viewedAt: result.viewedAt
              });
            })
            .catch((err) => {
              console.error('[getPropertyById] Failed to track recently viewed property', {
                profileId,
                propertyId,
                error: err.message,
              });
            });
          } else {
            console.log(`[getPropertyById] No active profile found for Oxy user ${oxyUserId} - will create one on next profile request`);
          }
        } catch (profileError) {
          console.error('[getPropertyById] Error finding active profile:', profileError);
        }
      } else {
        // Guest user - this is expected behavior, not an error
        console.log(`[getPropertyById] Guest user viewing property ${propertyId} - recently viewed tracking requires authentication`);
      }

      // Get energy data if monitoring is enabled
      let energyData = null;
      if (property.energyMonitoring && property.energyMonitoring.enabled) {
        try {
          energyData = await energyService.getEnergyStats(propertyId);
        } catch (error) {
          logger.warn('Failed to get energy data for property', {
            propertyId,
            error: error.message,
          });
        }
      }

      res.json(successResponse({ ...property, energyData }, 'Property retrieved successfully'));
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
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
      const oxyUserId = req.user?.id || req.user?._id || req.userId;

      if (!oxyUserId) {
        return next(
          new AppError(
            "Authentication required",
            401,
            "AUTHENTICATION_REQUIRED",
          ),
        );
      }

      // Get the active profile for the current user
      const Profile = require('../models').Profile;
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      
      if (!activeProfile) {
        return next(
          new AppError(
            "No active profile found",
            404,
            "PROFILE_NOT_FOUND",
          ),
        );
      }

      // Find the property and check ownership
      const property = await Property.findById(propertyId);
      
      if (!property) {
        return next(
          new AppError(
            "Property not found",
            404,
            "PROPERTY_NOT_FOUND",
          ),
        );
      }

      // Check if the property belongs to the current user's profile
      if (property.profileId.toString() !== activeProfile._id.toString()) {
        return next(
          new AppError(
            "Access denied - you can only edit your own properties",
            403,
            "FORBIDDEN",
          ),
        );
      }

      // Update the property
      const updatedProperty = await Property.findByIdAndUpdate(
        propertyId,
        {
          ...updateData,
          updatedAt: new Date(),
        },
        { new: true, runValidators: true }
      );

      if (!updatedProperty) {
        return next(
          new AppError(
            "Failed to update property",
            500,
            "UPDATE_FAILED",
          ),
        );
      }

      res.json(
        successResponse(
          updatedProperty,
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
   * Get user's properties
   */
  async getMyProperties(req, res, next) {
    try {
      const { page = 1, limit = 10 } = req.query;
      const oxyUserId = req.userId;

      // Get the active profile for the current user
      const Profile = require('../models').Profile;
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      
      if (!activeProfile) {
        return res.json(
          paginationResponse(
            [],
            parseInt(page),
            parseInt(limit),
            0,
            "No profile found for user",
          ),
        );
      }

      // Query database for user's properties using profileId
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [properties, total] = await Promise.all([
        Property.find({ profileId: activeProfile._id, status: { $ne: 'archived' } })
          .skip(skip)
          .limit(parseInt(limit))
          .sort({ createdAt: -1 })
          .lean(),
        Property.countDocuments({ profileId: activeProfile._id, status: { $ne: 'archived' } })
      ]);

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
        city,
        bedrooms, 
        bathrooms,
        amenities,
        available,
  verified,
  eco,
        // Location parameters
        lat,
        lng,
        radius,
        page = 1, 
        limit = 10 
      } = req.query;

      // Build search query
      const searchQuery: any = {};

      // Use MongoDB text search when a query string is provided
      if (query) {
        searchQuery.$text = { $search: query };
      }

      // Filter by property type
      if (type) {
        searchQuery.type = type;
      }

      // Filter by city/location
      if (city) {
        searchQuery['address.city'] = new RegExp(city, 'i');
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

      // Filter by amenities
      if (amenities) {
        const amenityList = amenities.split(',').map(a => a.trim());
        searchQuery.amenities = { $in: amenityList };
      }

      // Filter by verified/eco-friendly
      if (verified === 'true') {
        searchQuery.isVerified = true;
      }
      if (eco === 'true') {
        searchQuery.isEcoFriendly = true;
      }

      // Filter by availability
      if (available !== undefined) {
        searchQuery['availability.isAvailable'] = available === 'true';
      } else {
        // Default to available properties
        searchQuery['availability.isAvailable'] = true;
      }
      
      // Only show active properties
      searchQuery.status = 'active';

      // Add geospatial query if location parameters are provided
      if (lat && lng && radius) {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);
        const radiusInMeters = parseFloat(radius);

        // Validate coordinates
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          return res.status(400).json({
            success: false,
            message: 'Invalid coordinates provided',
            error: 'INVALID_COORDINATES'
          });
        }

        // Add geospatial query
        searchQuery.location = {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [longitude, latitude] // GeoJSON format: [lng, lat]
            },
            $maxDistance: radiusInMeters
          }
        };
      }

      // Execute search
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const queryOptions = Property.find(searchQuery)
        .skip(skip)
        .limit(parseInt(limit));

      // If text search was used, sort by relevance
      if (searchQuery.$text) {
        queryOptions
          .sort({ score: { $meta: 'textScore' } })
          .select({ score: { $meta: 'textScore' } });
      } else if (searchQuery.location) {
        // If geospatial query is used, sort by distance (closest first)
        queryOptions.sort({ location: { $meta: 'geoNear' } });
      } else {
        queryOptions.sort({ createdAt: -1 });
      }

      const [properties, total] = await Promise.all([
        queryOptions.lean(),
        Property.countDocuments(searchQuery)
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
   * Find properties near a specific location
   */
  async findNearbyProperties(req, res, next) {
    try {
      const { 
        longitude, 
        latitude, 
        maxDistance = 10000,
        type, 
        minRent, 
        maxRent, 
        bedrooms, 
        bathrooms,
        amenities,
        available,
  verified,
  eco,
        page = 1, 
        limit = 10 
      } = req.query;

      // Validate required parameters
      if (!longitude || !latitude) {
        return res.status(400).json({
          success: false,
          message: 'Longitude and latitude are required',
          error: 'MISSING_COORDINATES'
        });
      }

      const lng = parseFloat(longitude);
      const lat = parseFloat(latitude);
      const distance = parseFloat(maxDistance);

      // Validate coordinates
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates provided',
          error: 'INVALID_COORDINATES'
        });
      }

      // Build search query
      const searchQuery: any = {
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [lng, lat]
            },
            $maxDistance: distance
          }
        },
        'availability.isAvailable': available !== undefined ? available === 'true' : true,
  status: 'active'
      };

      // Add additional filters
      if (type) searchQuery.type = type;
      if (minRent || maxRent) {
        searchQuery['rent.amount'] = {};
        if (minRent) searchQuery['rent.amount'].$gte = parseInt(minRent);
        if (maxRent) searchQuery['rent.amount'].$lte = parseInt(maxRent);
      }
      if (bedrooms) searchQuery.bedrooms = parseInt(bedrooms);
      if (bathrooms) searchQuery.bathrooms = parseInt(bathrooms);
      if (amenities) {
        const amenityList = amenities.split(',').map(a => a.trim());
        searchQuery.amenities = { $in: amenityList };
      }
  if (verified === 'true') searchQuery.isVerified = true;
  if (eco === 'true') searchQuery.isEcoFriendly = true;

      // Execute search
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [properties, total] = await Promise.all([
        Property.find(searchQuery)
          .sort({ location: { $meta: 'geoNear' } })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Property.countDocuments(searchQuery)
      ]);

      const totalPages = Math.ceil(total / parseInt(limit));

      res.json(
        paginationResponse(
          properties,
          parseInt(page),
          parseInt(limit),
          total,
          "Nearby properties found successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Find properties within a specific radius
   */
  async findPropertiesInRadius(req, res, next) {
    try {
      const { 
        longitude, 
        latitude, 
        radius,
        type, 
        minRent, 
        maxRent, 
        bedrooms, 
        bathrooms,
        amenities,
        available,
  verified,
  eco,
        page = 1, 
        limit = 10 
      } = req.query;

      // Validate required parameters
      if (!longitude || !latitude || !radius) {
        return res.status(400).json({
          success: false,
          message: 'Longitude, latitude, and radius are required',
          error: 'MISSING_PARAMETERS'
        });
      }

      const lng = parseFloat(longitude);
      const lat = parseFloat(latitude);
      const radiusInMeters = parseFloat(radius);

      // Validate coordinates
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates provided',
          error: 'INVALID_COORDINATES'
        });
      }

      // Build search query
      const searchQuery: any = {
        location: {
          $geoWithin: {
            $centerSphere: [[lng, lat], radiusInMeters / 6371000] // Convert to radians
          }
        },
        'availability.isAvailable': available !== undefined ? available === 'true' : true,
  status: 'active'
      };

      // Add additional filters
      if (type) searchQuery.type = type;
      if (minRent || maxRent) {
        searchQuery['rent.amount'] = {};
        if (minRent) searchQuery['rent.amount'].$gte = parseInt(minRent);
        if (maxRent) searchQuery['rent.amount'].$lte = parseInt(maxRent);
      }
      if (bedrooms) searchQuery.bedrooms = parseInt(bedrooms);
      if (bathrooms) searchQuery.bathrooms = parseInt(bathrooms);
      if (amenities) {
        const amenityList = amenities.split(',').map(a => a.trim());
        searchQuery.amenities = { $in: amenityList };
      }
  if (verified === 'true') searchQuery.isVerified = true;
  if (eco === 'true') searchQuery.isEcoFriendly = true;

      // Execute search
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [properties, total] = await Promise.all([
        Property.find(searchQuery)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Property.countDocuments(searchQuery)
      ]);

      const totalPages = Math.ceil(total / parseInt(limit));

      res.json(
        paginationResponse(
          properties,
          parseInt(page),
          parseInt(limit),
          total,
          "Properties in radius found successfully",
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

      // Validate propertyId
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(propertyId)) {
        return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
      }

      // Ensure property exists
      const exists = await Property.exists({ _id: propertyId });
      if (!exists) {
        return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      }

      // Calculate statistics from database
      // savesCount: number of unique profiles that have saved this property in any folder
      const { SavedPropertyFolder } = require('../models');

      let savesCount = 0;
      try {
        const result = await SavedPropertyFolder.aggregate([
          { $match: { 'properties.propertyId': new mongoose.Types.ObjectId(propertyId) } },
          { $group: { _id: '$profileId' } },
          { $count: 'count' }
        ]);
        savesCount = result?.[0]?.count || 0;
      } catch (aggError) {
        // Don't fail the whole stats endpoint if aggregation fails; just log and continue
        console.error('[getPropertyStats] Failed to aggregate savesCount', {
          propertyId,
          error: aggError?.message,
        });
        savesCount = 0;
      }

      // Compute real-time stats
      const { Room, Lease } = require('../models');
      const now = new Date();

      // Prepare objectId once
      const objId = new mongoose.Types.ObjectId(propertyId);

      // Run core queries in parallel for performance
      const [
        totalRoomsResult,
        occupiedRoomsResult,
        availableRoomsResult,
        leaseAgg,
        roomRentAgg,
        propertyDoc
      ] = await Promise.all([
        // Total rooms linked to this property
        Room.countDocuments({ propertyId: objId }).catch(() => 0),
        // Rooms considered occupied if they have any occupants or explicit occupied status
        Room.countDocuments({
          propertyId: objId,
          $or: [
            { 'occupancy.currentOccupants': { $gt: 0 } },
            { status: 'occupied' }
          ]
        }).catch(() => 0),
        // Available rooms by status and availability flag
        Room.countDocuments({
          propertyId: objId,
          status: 'available',
          'availability.isAvailable': true
        }).catch(() => 0),
        // Active leases for this property (time-bounded)
        Lease.aggregate([
          {
            $match: {
              propertyId: objId,
              status: 'active',
              'leaseTerms.startDate': { $lte: now },
              'leaseTerms.endDate': { $gte: now }
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$rentDetails.monthlyRent' },
              avg: { $avg: '$rentDetails.monthlyRent' },
              count: { $sum: 1 }
            }
          }
        ]).catch(() => []),
        // Average room rent (if defined)
        Room.aggregate([
          { $match: { propertyId: objId, 'rent.amount': { $gt: 0 } } },
          { $group: { _id: null, avg: { $avg: '$rent.amount' }, count: { $sum: 1 } } }
        ]).catch(() => []),
        // Fetch property as fallback for rent
        Property.findById(propertyId).select('rent').lean().catch(() => null)
      ]);

      const totalRooms = typeof totalRoomsResult === 'number' ? totalRoomsResult : 0;
      const occupiedRooms = typeof occupiedRoomsResult === 'number' ? occupiedRoomsResult : 0;
      const availableRooms = typeof availableRoomsResult === 'number' ? availableRoomsResult : Math.max(totalRooms - occupiedRooms, 0);

      // Monthly revenue and average from leases
      const leaseTotals = Array.isArray(leaseAgg) && leaseAgg[0] ? leaseAgg[0] : { total: 0, avg: null, count: 0 };
      const monthlyRevenue = leaseTotals.total || 0;

      // Determine average rent with sensible fallbacks
      let averageRent = 0;
      if (leaseTotals.count > 0 && leaseTotals.avg != null) {
        averageRent = leaseTotals.avg;
      } else if (Array.isArray(roomRentAgg) && roomRentAgg[0]?.avg != null) {
        averageRent = roomRentAgg[0].avg;
      } else if (propertyDoc?.rent?.amount != null) {
        averageRent = propertyDoc.rent.amount;
      }

      const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

      const stats = {
        totalRooms,
        occupiedRooms,
        availableRooms,
        monthlyRevenue,
        averageRent,
        occupancyRate,
        savesCount,
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
