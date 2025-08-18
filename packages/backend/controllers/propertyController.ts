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
  state,
        bedrooms,
        bathrooms,
  minBedrooms,
  maxBedrooms,
  minBathrooms,
  maxBathrooms,
  minSquareFootage,
  maxSquareFootage,
  minYearBuilt,
  maxYearBuilt,
        amenities,
        available,
 hasPhotos,
  verified,
  eco,
  housingType,
  layoutType,
  furnishedStatus,
  petFriendly,
  utilitiesIncluded,
  parkingType,
  petPolicy,
  leaseTerm,
  priceUnit,
  proximityToTransport,
  proximityToSchools,
  proximityToShopping,
  availableFromBefore,
  availableFromAfter,
  excludeIds,
        sortBy = "createdAt",
        sortOrder = "desc",
        profileId,
        // Optional coordinates and radius for preference-based ordering
        lat,
        lng,
        radius
      } = req.query;

      // Build filters
      const filters: any = {};
      // Optional filter by profileId (supports viewing listings for a specific profile)
      if (profileId) filters.profileId = profileId;
      if (type) filters.type = type;
      if (city) filters["address.city"] = new RegExp(city, "i");
      if (state) filters["address.state"] = new RegExp(String(state), "i");
      // Bedrooms exact or range
      if (minBedrooms || maxBedrooms) {
        const br: any = {};
        if (minBedrooms) br.$gte = parseInt(String(minBedrooms));
        if (maxBedrooms) br.$lte = parseInt(String(maxBedrooms));
        filters.bedrooms = br;
      } else if (bedrooms) {
        filters.bedrooms = parseInt(String(bedrooms));
      }
      // Bathrooms exact or range
      if (minBathrooms || maxBathrooms) {
        const ba: any = {};
        if (minBathrooms) ba.$gte = parseInt(String(minBathrooms));
        if (maxBathrooms) ba.$lte = parseInt(String(maxBathrooms));
        filters.bathrooms = ba;
      } else if (bathrooms) {
        filters.bathrooms = parseInt(String(bathrooms));
      }
      // Square footage range
      if (minSquareFootage || maxSquareFootage) {
        const sf: any = {};
        if (minSquareFootage) sf.$gte = parseInt(String(minSquareFootage));
        if (maxSquareFootage) sf.$lte = parseInt(String(maxSquareFootage));
        filters.squareFootage = sf;
      }
      // Year built range
      if (minYearBuilt || maxYearBuilt) {
        const yb: any = {};
        if (minYearBuilt) yb.$gte = parseInt(String(minYearBuilt));
        if (maxYearBuilt) yb.$lte = parseInt(String(maxYearBuilt));
        filters.yearBuilt = yb;
      }
      if (available !== undefined) {
        filters["availability.isAvailable"] = available === "true";
        filters.status = "active";
      }
      if (amenities) {
        const amenityList = amenities.split(",");
        filters.amenities = { $in: amenityList };
      }

      // Optional photos filter
      if (hasPhotos === 'true') {
        filters['images.url'] = { $exists: true, $nin: [null, ''] };
      }

      // Optional verified/eco filters
      if (verified === 'true') {
        filters.isVerified = true;
      }
      if (eco === 'true') {
        filters.isEcoFriendly = true;
      }

      // Additional attribute filters
      if (housingType) filters.housingType = String(housingType);
      if (layoutType) filters.layoutType = String(layoutType);
      if (furnishedStatus) filters.furnishedStatus = String(furnishedStatus);
      if (petPolicy) filters.petPolicy = String(petPolicy);
      if (leaseTerm) filters.leaseTerm = String(leaseTerm);
      if (priceUnit) filters.priceUnit = String(priceUnit);
      if (parkingType) filters.parkingType = String(parkingType);
      if (petFriendly !== undefined) filters.petFriendly = String(petFriendly) === 'true';
      if (utilitiesIncluded !== undefined) filters.utilitiesIncluded = String(utilitiesIncluded) === 'true';
      if (proximityToTransport !== undefined) filters.proximityToTransport = String(proximityToTransport) === 'true';
      if (proximityToSchools !== undefined) filters.proximityToSchools = String(proximityToSchools) === 'true';
      if (proximityToShopping !== undefined) filters.proximityToShopping = String(proximityToShopping) === 'true';
      // AvailableFrom date range
      if (availableFromBefore || availableFromAfter) {
        const af: any = {};
        if (availableFromAfter) {
          const d = new Date(String(availableFromAfter));
          if (!isNaN(d.getTime())) af.$gte = d;
        }
        if (availableFromBefore) {
          const d = new Date(String(availableFromBefore));
          if (!isNaN(d.getTime())) af.$lte = d;
        }
        if (Object.keys(af).length) filters.availableFrom = af;
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

      // Query database (base list)
      // Apply excludeIds on base filters
      if (excludeIds) {
        try {
          const mongoose = require('mongoose');
          const list = String(excludeIds)
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
            .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
            .map((id: string) => new mongoose.Types.ObjectId(id));
          if (list.length) filters._id = { $nin: list };
        } catch {}
      }

      const [properties, total] = await Promise.all([
        Property.find(filters)
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNumber)
          .populate("rooms", "name type status")
          .lean(),
        Property.countDocuments(filters),
      ]);

      // Build savesCount map in a single aggregation for returned list
      const mongoose = require('mongoose');
      const { Saved } = require('../models');
      const ids = properties.map(p => p._id).filter(Boolean).map((id: any) => new mongoose.Types.ObjectId(id));
      let savesMap: Record<string, number> = {};
      if (ids.length > 0) {
        const savesAgg = await Saved.aggregate([
          { $match: { targetType: 'property', targetId: { $in: ids } } },
          { $group: { _id: '$targetId', count: { $sum: 1 } } }
        ]).catch(() => []);
        savesMap = Array.isArray(savesAgg) ? savesAgg.reduce((acc: Record<string, number>, doc: any) => {
          acc[String(doc._id)] = doc.count || 0;
          return acc;
        }, {}) : {};
      }

      // If coordinates are provided, prefer items within radius and order by saves then distance
      let ordered = properties;
      const hasCoords = lat !== undefined && lng !== undefined && lat !== null && lng !== null;
      const preferredRadiusMeters = radius ? parseFloat(radius) : 45000; // default 45km preference

      if (hasCoords) {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        try {
          // Compute distance and decorate
          const R = 6371000; // meters
          const toRadians = (deg: number) => deg * Math.PI / 180;
          const computeDistance = (prop: any): number => {
            const coords = prop?.location?.coordinates;
            if (!Array.isArray(coords) || coords.length !== 2) return Number.POSITIVE_INFINITY;
            const [propLng, propLat] = coords;
            const dLat = toRadians(latitude - propLat);
            const dLng = toRadians(longitude - propLng);
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(toRadians(propLat)) * Math.cos(toRadians(latitude)) * Math.sin(dLng/2) * Math.sin(dLng/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
          };

          const decorated = properties.map((p: any, index: number) => {
            const distance = computeDistance(p);
            const savesCount = savesMap[String(p._id)] || 0;
            return { index, distance, savesCount, inside: Number.isFinite(distance) && distance <= preferredRadiusMeters, prop: p };
          });

          decorated.sort((a, b) => {
            if (a.inside !== b.inside) return a.inside ? -1 : 1; // prefer inside radius
            if (b.savesCount !== a.savesCount) return b.savesCount - a.savesCount; // higher saves first
            if (a.distance !== b.distance) return a.distance - b.distance; // nearer first
            return a.index - b.index; // stable fallback
          });

          ordered = decorated.map(d => ({ ...d.prop, savesCount: d.savesCount, distance: d.distance }));
        } catch (e) {
          // On any failure, keep original ordering but attach savesCount
          ordered = properties.map((p: any) => ({ ...p, savesCount: savesMap[String(p._id)] || 0 }));
        }
      } else {
        // No coordinates: attach savesCount without reordering
        ordered = properties.map((p: any) => ({ ...p, savesCount: savesMap[String(p._id)] || 0 }));
      }

      // Personalized recommendations for authenticated users
      if (req.user?.id || req.user?._id) {
        try {
          const oxyUserId = req.user.id || req.user._id;
          console.log(`[getProperties] Applying personalized recommendations for user: ${oxyUserId}`);
          
          // Get user's profile and preferences
          const { Profile, RecentlyViewed, Saved } = require('../models');
          const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
          
          if (activeProfile) {
            // Get user's recently viewed properties to understand preferences
            const recentlyViewed = await RecentlyViewed.find({ profileId: activeProfile._id })
              .sort({ viewedAt: -1 })
              .limit(10)
              .lean();
            
            // Get user's saved properties
            const savedProperties = await Saved.find({ 
              profileId: activeProfile._id, 
              targetType: 'property' 
            }).lean();
            
            // Create preference weights based on user behavior
            const preferenceWeights = {
              propertyTypes: {},
              priceRanges: {},
              locations: {},
              amenities: {}
            };
            
            // Analyze recently viewed properties
            recentlyViewed.forEach(view => {
              const property = ordered.find(p => p._id.toString() === view.propertyId.toString());
              if (property) {
                // Property type preference
                preferenceWeights.propertyTypes[property.type] = 
                  (preferenceWeights.propertyTypes[property.type] || 0) + 1;
                
                // Price range preference
                const rent = property.rent?.amount || 0;
                if (rent > 0) {
                  const priceRange = rent < 1000 ? 'low' : rent < 2000 ? 'medium' : 'high';
                  preferenceWeights.priceRanges[priceRange] = 
                    (preferenceWeights.priceRanges[priceRange] || 0) + 1;
                }
                
                // Location preference
                if (property.address?.city) {
                  preferenceWeights.locations[property.address.city] = 
                    (preferenceWeights.locations[property.address.city] || 0) + 1;
                }
                
                // Amenities preference
                if (property.amenities) {
                  property.amenities.forEach(amenity => {
                    preferenceWeights.amenities[amenity] = 
                      (preferenceWeights.amenities[amenity] || 0) + 1;
                  });
                }
              }
            });
            
            // Apply personalized scoring
            const personalizedProperties = ordered.map(property => {
              let personalizedScore = 0;
              
              // Base score from saves count (popularity)
              personalizedScore += (property.savesCount || 0) * 10;
              
              // Property type preference bonus
              const typeWeight = preferenceWeights.propertyTypes[property.type] || 0;
              personalizedScore += typeWeight * 15;
              
              // Price range preference bonus
              const rent = property.rent?.amount || 0;
              if (rent > 0) {
                const priceRange = rent < 1000 ? 'low' : rent < 2000 ? 'medium' : 'high';
                const priceWeight = preferenceWeights.priceRanges[priceRange] || 0;
                personalizedScore += priceWeight * 12;
              }
              
              // Location preference bonus
              if (property.address?.city) {
                const locationWeight = preferenceWeights.locations[property.address.city] || 0;
                personalizedScore += locationWeight * 20;
              }
              
              // Amenities preference bonus
              if (property.amenities) {
                property.amenities.forEach(amenity => {
                  const amenityWeight = preferenceWeights.amenities[amenity] || 0;
                  personalizedScore += amenityWeight * 5;
                });
              }
              
              // Verified properties bonus
              if (property.isVerified) {
                personalizedScore += 25;
              }
              
              // Eco-friendly bonus
              if (property.isEcoFriendly) {
                personalizedScore += 15;
              }
              
              // Recently viewed penalty (avoid showing same properties)
              const isRecentlyViewed = recentlyViewed.some(view => 
                view.propertyId.toString() === property._id.toString()
              );
              if (isRecentlyViewed) {
                personalizedScore -= 30;
              }
              
              // Saved properties penalty (avoid showing already saved)
              const isSaved = savedProperties.some(saved => 
                saved.targetId.toString() === property._id.toString()
              );
              if (isSaved) {
                personalizedScore -= 20;
              }
              
              return { ...property, personalizedScore };
            });
            
            // Sort by personalized score
            personalizedProperties.sort((a, b) => (b.personalizedScore || 0) - (a.personalizedScore || 0));
            
            // Update the ordered list with personalized results
            ordered = personalizedProperties;
            
            console.log(`[getProperties] Applied personalized scoring for ${personalizedProperties.length} properties`);
          }
        } catch (error) {
          console.error('[getProperties] Error applying personalized recommendations:', error);
          // Continue with non-personalized results if there's an error
        }
      }

      const totalPages = Math.ceil(total / limitNumber);

      res.json(
        paginationResponse(
          ordered,
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
  state,
        bedrooms, 
        bathrooms,
  minBedrooms,
  maxBedrooms,
  minBathrooms,
  maxBathrooms,
  minSquareFootage,
  maxSquareFootage,
  minYearBuilt,
  maxYearBuilt,
        amenities,
        available,
 hasPhotos,
  verified,
  eco,
  housingType,
  layoutType,
  furnishedStatus,
  petFriendly,
  utilitiesIncluded,
  parkingType,
  petPolicy,
  leaseTerm,
  priceUnit,
  proximityToTransport,
  proximityToSchools,
  proximityToShopping,
  availableFromBefore,
  availableFromAfter,
  excludeIds,
        // Location parameters
        lat,
        lng,
        radius,
        budgetFriendly,
        page = 1, 
        limit = 10 
      } = req.query;

  // No language-based parsing here. All filters must come via explicit URL params.

      // Helper: escape regex special chars for safe partial search
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Build filters using $and to combine filters cleanly
      const andConditions: any[] = [];

      // Filter by property type
  const effType = type;
      if (effType) {
        andConditions.push({ type: effType });
      }

      // Filter by city/state/location
  const effCity = city;
      if (effCity) {
        andConditions.push({ 'address.city': new RegExp(String(effCity), 'i') });
      }
      if (state) {
        andConditions.push({ 'address.state': new RegExp(String(state), 'i') });
      }

      // Filter by rent range
  const effMin = minRent;
  const effMax = maxRent;
      if (effMin || effMax) {
        const rentFilter: any = {};
        if (effMin) rentFilter.$gte = parseInt(String(effMin));
        if (effMax) rentFilter.$lte = parseInt(String(effMax));
        andConditions.push({ 'rent.amount': rentFilter });
      }

      // Filter by bedrooms (exact or range)
  const effBeds = bedrooms;
      if (minBedrooms || maxBedrooms) {
        const br: any = {};
        if (minBedrooms) br.$gte = parseInt(String(minBedrooms));
        if (maxBedrooms) br.$lte = parseInt(String(maxBedrooms));
        andConditions.push({ bedrooms: br });
      } else if (effBeds) {
        andConditions.push({ bedrooms: parseInt(String(effBeds)) });
      }

      // Filter by bathrooms (exact or range)
  const effBaths = bathrooms;
      if (minBathrooms || maxBathrooms) {
        const ba: any = {};
        if (minBathrooms) ba.$gte = parseInt(String(minBathrooms));
        if (maxBathrooms) ba.$lte = parseInt(String(maxBathrooms));
        andConditions.push({ bathrooms: ba });
      } else if (effBaths) {
        andConditions.push({ bathrooms: parseInt(String(effBaths)) });
      }

      // Square footage range
      if (minSquareFootage || maxSquareFootage) {
        const sf: any = {};
        if (minSquareFootage) sf.$gte = parseInt(String(minSquareFootage));
        if (maxSquareFootage) sf.$lte = parseInt(String(maxSquareFootage));
        andConditions.push({ squareFootage: sf });
      }

      // Year built range
      if (minYearBuilt || maxYearBuilt) {
        const yb: any = {};
        if (minYearBuilt) yb.$gte = parseInt(String(minYearBuilt));
        if (maxYearBuilt) yb.$lte = parseInt(String(maxYearBuilt));
        andConditions.push({ yearBuilt: yb });
      }

      // Filter by amenities (exact list match)
      if (amenities) {
        const amenityList = String(amenities).split(',').map(a => a.trim()).filter(Boolean);
        andConditions.push({ amenities: { $in: amenityList } });
      }

  // Filter by photos (must have valid image URL)
  if (hasPhotos === 'true') {
    andConditions.push({ 'images.url': { $exists: true, $nin: [null, ''] } });
  }

      // Filter by verified/eco-friendly
      if (verified === 'true') {
        andConditions.push({ isVerified: true });
      }
      if (eco === 'true') {
        andConditions.push({ isEcoFriendly: true });
      }

      // Additional attribute filters
      if (housingType) andConditions.push({ housingType: String(housingType) });
      if (layoutType) andConditions.push({ layoutType: String(layoutType) });
      if (furnishedStatus) andConditions.push({ furnishedStatus: String(furnishedStatus) });
      if (petPolicy) andConditions.push({ petPolicy: String(petPolicy) });
      if (leaseTerm) andConditions.push({ leaseTerm: String(leaseTerm) });
      if (priceUnit) andConditions.push({ priceUnit: String(priceUnit) });
      if (parkingType) andConditions.push({ parkingType: String(parkingType) });
      if (petFriendly !== undefined) andConditions.push({ petFriendly: String(petFriendly) === 'true' });
      if (utilitiesIncluded !== undefined) andConditions.push({ utilitiesIncluded: String(utilitiesIncluded) === 'true' });
      if (proximityToTransport !== undefined) andConditions.push({ proximityToTransport: String(proximityToTransport) === 'true' });
      if (proximityToSchools !== undefined) andConditions.push({ proximityToSchools: String(proximityToSchools) === 'true' });
      if (proximityToShopping !== undefined) andConditions.push({ proximityToShopping: String(proximityToShopping) === 'true' });
      if (availableFromBefore || availableFromAfter) {
        const af: any = {};
        if (availableFromAfter) {
          const d = new Date(String(availableFromAfter));
          if (!isNaN(d.getTime())) af.$gte = d;
        }
        if (availableFromBefore) {
          const d = new Date(String(availableFromBefore));
          if (!isNaN(d.getTime())) af.$lte = d;
        }
        if (Object.keys(af).length) andConditions.push({ availableFrom: af });
      }

      // Filter by availability
  const effAvailable = available !== undefined ? available === 'true' : undefined;
      if (effAvailable !== undefined) {
        andConditions.push({ 'availability.isAvailable': effAvailable });
      } else {
        // Default to available properties
        andConditions.push({ 'availability.isAvailable': true });
      }
      
      // Only show active properties
      andConditions.push({ status: 'active' });

      // Exclude specific property IDs if provided
      if (excludeIds) {
        try {
          const mongoose = require('mongoose');
          const list = String(excludeIds)
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
            .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
            .map((id: string) => new mongoose.Types.ObjectId(id));
          if (list.length) andConditions.push({ _id: { $nin: list } });
        } catch {}
      }

      // Track whether geo filter is applied (for sorting hint)
      let hasGeo = false;

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
        andConditions.push({
          location: {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: [longitude, latitude] // GeoJSON format: [lng, lat]
              },
              $maxDistance: radiusInMeters
            }
          }
        });
        hasGeo = true;
      }

      // Execute search with two-phase strategy to support partial matches and text relevance
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Base filter from collected conditions
      const baseFilter = andConditions.length > 0 ? { $and: andConditions } : {};

      // Utility to run a query with optional text sort
      const runQuery = async (filter: any, useTextSort: boolean) => {
        const q = Property.find(filter).skip(skip).limit(parseInt(limit));
  const effBudget = (String(budgetFriendly).toLowerCase() === 'true');
        if (useTextSort) {
          if (effBudget) {
            q.sort({ score: { $meta: 'textScore' }, 'rent.amount': 1 }).select({ score: { $meta: 'textScore' } });
          } else {
            q.sort({ score: { $meta: 'textScore' } }).select({ score: { $meta: 'textScore' } });
          }
        } else {
          if (effBudget) {
            q.sort({ 'rent.amount': 1 });
          } else {
            q.sort({ createdAt: -1 });
          }
        }
        const [items, count] = await Promise.all([
          q.lean(),
          Property.countDocuments(filter),
        ]);
        return { items, count };
      };

      let resultItems: any[] = [];
      let resultTotal = 0;

      if (query) {
        // First attempt: full-text search for better relevance
        const textFilter: any = { ...baseFilter, $text: { $search: String(query) } };
        const textRes = await runQuery(textFilter, true);
        if (textRes.count > 0) {
          resultItems = textRes.items;
          resultTotal = textRes.count;
        } else {
          // Fallback to case-insensitive partial matching across key fields
          const safe = escapeRegExp(String(query));
          const regex = new RegExp(safe, 'i');
          const orRegex = [
            { title: regex },
            { description: regex },
            { 'address.city': regex },
            { 'address.state': regex },
            { 'address.street': regex },
            { amenities: regex },
          ];
          const regexFilter: any = { ...baseFilter, $or: orRegex };
          const regexRes = await runQuery(regexFilter, false);
          resultItems = regexRes.items;
          resultTotal = regexRes.count;
        }
      } else {
        // No query: just apply base filters
        const baseRes = await runQuery(baseFilter, false);
        resultItems = baseRes.items;
        resultTotal = baseRes.count;
      }

      res.json(
        paginationResponse(
          resultItems,
          parseInt(page),
          parseInt(limit),
          resultTotal,
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
        query,
        type, 
        minRent, 
        maxRent, 
  state,
        bedrooms, 
        bathrooms,
  minBedrooms,
  maxBedrooms,
  minBathrooms,
  maxBathrooms,
  minSquareFootage,
  maxSquareFootage,
  minYearBuilt,
  maxYearBuilt,
        amenities,
        available,
 hasPhotos,
  verified,
  eco,
  housingType,
  layoutType,
  furnishedStatus,
  petFriendly,
  utilitiesIncluded,
  parkingType,
  petPolicy,
  leaseTerm,
  priceUnit,
  proximityToTransport,
  proximityToSchools,
  proximityToShopping,
  availableFromBefore,
  availableFromAfter,
  excludeIds,
        page = 1, 
        limit = 10 
      } = req.query;

  // No language-based parsing here. All filters must come via explicit URL params.

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

      // Exclude specific property IDs if provided
      if (excludeIds) {
        try {
          const mongoose = require('mongoose');
          const list = String(excludeIds)
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
            .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
            .map((id: string) => new mongoose.Types.ObjectId(id));
          if (list.length) searchQuery._id = { $nin: list };
        } catch {}
      }

      // Add additional filters
  const effTypeN = type;
      if (effTypeN) searchQuery.type = effTypeN;
  const effMinN = minRent;
  const effMaxN = maxRent;
      if (effMinN || effMaxN) {
        searchQuery['rent.amount'] = {};
        if (effMinN) searchQuery['rent.amount'].$gte = parseInt(String(effMinN));
        if (effMaxN) searchQuery['rent.amount'].$lte = parseInt(String(effMaxN));
      }
  const effBedsN = bedrooms;
      if (minBedrooms || maxBedrooms) {
        const br: any = {};
        if (minBedrooms) br.$gte = parseInt(String(minBedrooms));
        if (maxBedrooms) br.$lte = parseInt(String(maxBedrooms));
        searchQuery.bedrooms = br;
      } else if (effBedsN) {
        searchQuery.bedrooms = parseInt(String(effBedsN));
      }
  const effBathsN = bathrooms;
      if (minBathrooms || maxBathrooms) {
        const ba: any = {};
        if (minBathrooms) ba.$gte = parseInt(String(minBathrooms));
        if (maxBathrooms) ba.$lte = parseInt(String(maxBathrooms));
        searchQuery.bathrooms = ba;
      } else if (effBathsN) {
        searchQuery.bathrooms = parseInt(String(effBathsN));
      }
      if (minSquareFootage || maxSquareFootage) {
        const sf: any = {};
        if (minSquareFootage) sf.$gte = parseInt(String(minSquareFootage));
        if (maxSquareFootage) sf.$lte = parseInt(String(maxSquareFootage));
        searchQuery.squareFootage = sf;
      }
      if (minYearBuilt || maxYearBuilt) {
        const yb: any = {};
        if (minYearBuilt) yb.$gte = parseInt(String(minYearBuilt));
        if (maxYearBuilt) yb.$lte = parseInt(String(maxYearBuilt));
        searchQuery.yearBuilt = yb;
      }
  const amenityListN = (amenities ? String(amenities).split(',').map(a => a.trim()) : []).filter(Boolean);
      if (amenityListN.length) searchQuery.amenities = { $in: amenityListN };
  if (hasPhotos === 'true') searchQuery['images.url'] = { $exists: true, $nin: [null, ''] };
  if (verified === 'true') searchQuery.isVerified = true;
  if (eco === 'true') searchQuery.isEcoFriendly = true;
      if (housingType) searchQuery.housingType = String(housingType);
      if (layoutType) searchQuery.layoutType = String(layoutType);
      if (furnishedStatus) searchQuery.furnishedStatus = String(furnishedStatus);
      if (petPolicy) searchQuery.petPolicy = String(petPolicy);
      if (leaseTerm) searchQuery.leaseTerm = String(leaseTerm);
      if (priceUnit) searchQuery.priceUnit = String(priceUnit);
      if (parkingType) searchQuery.parkingType = String(parkingType);
      if (petFriendly !== undefined) searchQuery.petFriendly = String(petFriendly) === 'true';
      if (utilitiesIncluded !== undefined) searchQuery.utilitiesIncluded = String(utilitiesIncluded) === 'true';
      if (proximityToTransport !== undefined) searchQuery.proximityToTransport = String(proximityToTransport) === 'true';
      if (proximityToSchools !== undefined) searchQuery.proximityToSchools = String(proximityToSchools) === 'true';
      if (proximityToShopping !== undefined) searchQuery.proximityToShopping = String(proximityToShopping) === 'true';
      if (availableFromBefore || availableFromAfter) {
        const af: any = {};
        if (availableFromAfter) {
          const d = new Date(String(availableFromAfter));
          if (!isNaN(d.getTime())) af.$gte = d;
        }
        if (availableFromBefore) {
          const d = new Date(String(availableFromBefore));
          if (!isNaN(d.getTime())) af.$lte = d;
        }
        if (Object.keys(af).length) searchQuery.availableFrom = af;
      }

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
        query,
        type, 
        minRent, 
        maxRent, 
  state,
        bedrooms, 
        bathrooms,
  minBedrooms,
  maxBedrooms,
  minBathrooms,
  maxBathrooms,
  minSquareFootage,
  maxSquareFootage,
  minYearBuilt,
  maxYearBuilt,
        amenities,
        available,
 hasPhotos,
  verified,
  eco,
  housingType,
  layoutType,
  furnishedStatus,
  petFriendly,
  utilitiesIncluded,
  parkingType,
  petPolicy,
  leaseTerm,
  priceUnit,
  proximityToTransport,
  proximityToSchools,
  proximityToShopping,
  availableFromBefore,
  availableFromAfter,
  excludeIds,
        page = 1, 
        limit = 10 
      } = req.query;

  // No language-based parsing here. All filters must come via explicit URL params.

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

      // Exclude specific property IDs if provided
      if (excludeIds) {
        try {
          const mongoose = require('mongoose');
          const list = String(excludeIds)
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
            .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
            .map((id: string) => new mongoose.Types.ObjectId(id));
          if (list.length) searchQuery._id = { $nin: list };
        } catch {}
      }

      // Add additional filters
  const effTypeR = type;
      if (effTypeR) searchQuery.type = effTypeR;
  const effMinR = minRent;
  const effMaxR = maxRent;
      if (effMinR || effMaxR) {
        searchQuery['rent.amount'] = {};
        if (effMinR) searchQuery['rent.amount'].$gte = parseInt(String(effMinR));
        if (effMaxR) searchQuery['rent.amount'].$lte = parseInt(String(effMaxR));
      }
  const effBedsR = bedrooms;
      if (minBedrooms || maxBedrooms) {
        const br: any = {};
        if (minBedrooms) br.$gte = parseInt(String(minBedrooms));
        if (maxBedrooms) br.$lte = parseInt(String(maxBedrooms));
        searchQuery.bedrooms = br;
      } else if (effBedsR) {
        searchQuery.bedrooms = parseInt(String(effBedsR));
      }
  const effBathsR = bathrooms;
      if (minBathrooms || maxBathrooms) {
        const ba: any = {};
        if (minBathrooms) ba.$gte = parseInt(String(minBathrooms));
        if (maxBathrooms) ba.$lte = parseInt(String(maxBathrooms));
        searchQuery.bathrooms = ba;
      } else if (effBathsR) {
        searchQuery.bathrooms = parseInt(String(effBathsR));
      }
      if (minSquareFootage || maxSquareFootage) {
        const sf: any = {};
        if (minSquareFootage) sf.$gte = parseInt(String(minSquareFootage));
        if (maxSquareFootage) sf.$lte = parseInt(String(maxSquareFootage));
        searchQuery.squareFootage = sf;
      }
      if (minYearBuilt || maxYearBuilt) {
        const yb: any = {};
        if (minYearBuilt) yb.$gte = parseInt(String(minYearBuilt));
        if (maxYearBuilt) yb.$lte = parseInt(String(maxYearBuilt));
        searchQuery.yearBuilt = yb;
      }
  const amenityListR = (amenities ? String(amenities).split(',').map(a => a.trim()) : []).filter(Boolean);
      if (amenityListR.length) searchQuery.amenities = { $in: amenityListR };
  if (hasPhotos === 'true') searchQuery['images.url'] = { $exists: true, $nin: [null, ''] };
  if (verified === 'true') searchQuery.isVerified = true;
  if (eco === 'true') searchQuery.isEcoFriendly = true;
      if (housingType) searchQuery.housingType = String(housingType);
      if (layoutType) searchQuery.layoutType = String(layoutType);
      if (furnishedStatus) searchQuery.furnishedStatus = String(furnishedStatus);
      if (petPolicy) searchQuery.petPolicy = String(petPolicy);
      if (leaseTerm) searchQuery.leaseTerm = String(leaseTerm);
      if (priceUnit) searchQuery.priceUnit = String(priceUnit);
      if (parkingType) searchQuery.parkingType = String(parkingType);
      if (petFriendly !== undefined) searchQuery.petFriendly = String(petFriendly) === 'true';
      if (utilitiesIncluded !== undefined) searchQuery.utilitiesIncluded = String(utilitiesIncluded) === 'true';
      if (proximityToTransport !== undefined) searchQuery.proximityToTransport = String(proximityToTransport) === 'true';
      if (proximityToSchools !== undefined) searchQuery.proximityToSchools = String(proximityToSchools) === 'true';
      if (proximityToShopping !== undefined) searchQuery.proximityToShopping = String(proximityToShopping) === 'true';
      if (availableFromBefore || availableFromAfter) {
        const af: any = {};
        if (availableFromAfter) {
          const d = new Date(String(availableFromAfter));
          if (!isNaN(d.getTime())) af.$gte = d;
        }
        if (availableFromBefore) {
          const d = new Date(String(availableFromBefore));
          if (!isNaN(d.getTime())) af.$lte = d;
        }
        if (Object.keys(af).length) searchQuery.availableFrom = af;
      }

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
  /**
   * Get properties by owner profile ID
   */
  async getPropertiesByOwner(req, res, next) {
    try {
      const { profileId } = req.params;
      const { exclude } = req.query;
      const { page = 1, limit = 10 } = req.query;

      // Validate profileId
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(profileId)) {
        return next(new AppError('Invalid profile ID', 400, 'INVALID_ID'));
      }

      // Build query
      const query: any = {
        profileId: new mongoose.Types.ObjectId(profileId),
        status: 'active',
      };

      // Exclude specific property if requested
      if (exclude && mongoose.Types.ObjectId.isValid(exclude)) {
        query._id = { $ne: new mongoose.Types.ObjectId(exclude) };
      }

      // Execute query with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [properties, total] = await Promise.all([
        Property.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Property.countDocuments(query),
      ]);

      res.json(
        paginationResponse(
          properties,
          parseInt(page),
          parseInt(limit),
          total,
          "Owner's properties retrieved successfully",
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

      // Calculate statistics from database using unified Saved collection
      const { Saved } = require('../models');
      let savesCount = await Saved.countDocuments({ targetType: 'property', targetId: new mongoose.Types.ObjectId(propertyId) }).catch(() => 0);

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

  /**
   * Batch: Get multiple properties by IDs
   * GET /api/properties/by-ids?ids=a,b,c
   */
  async getPropertiesByIds(req, res, next) {
    try {
      const { ids } = req.query;
      if (!ids) {
        return res.status(400).json({ success: false, message: 'ids is required' });
      }
      const mongoose = require('mongoose');
      const list = String(ids)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
        .map((id: string) => new mongoose.Types.ObjectId(id));
      if (!list.length) {
        return res.json(paginationResponse([], 1, 0, 0, 'No valid IDs provided'));
      }
      const docs = await Property.find({ _id: { $in: list }, status: 'active' })
        .lean();
      return res.json(successResponse(docs, 'Properties fetched by IDs'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new PropertyController();
