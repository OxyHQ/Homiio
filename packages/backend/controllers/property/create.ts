import { ProfileType } from '@homiio/shared-types';
const { Property } = require('../../models');
const { telegramService } = require('../../services');
const { logger, businessLogger } = require('../../middlewares/logging');
const { AppError, successResponse } = require('../../middlewares/errorHandler');

/**
 * Validates and fixes coordinate order to ensure GeoJSON compliance
 * GeoJSON standard requires [longitude, latitude] format
 * 
 * @param coords - Array of coordinates [number, number]
 * @returns Array in correct [longitude, latitude] format
 */
function validateAndFixCoordinateOrder(coords: number[]): number[] {
  if (!Array.isArray(coords) || coords.length !== 2) {
    throw new Error('Coordinates must be an array of exactly 2 numbers');
  }
  
  const [first, second] = coords;
  
  // Validate that both are valid numbers
  if (isNaN(first) || isNaN(second)) {
    throw new Error('Coordinates must be valid numbers');
  }
  
  // Basic range validation - both values must be within reasonable bounds
  if (Math.abs(first) > 180 || Math.abs(second) > 180) {
    throw new Error('Coordinates out of valid range');
  }
  
  // Improved heuristic to detect if coordinates are swapped
  // Strong indicators that coordinates are in [lat, lng] format instead of [lng, lat]:
  
  // 1. Clear case: first value in lat range, second clearly longitude (> 90 or < -90)
  const firstInLatRange = first >= -90 && first <= 90;
  const secondClearlyLongitude = Math.abs(second) > 90;
  
  // 2. Geographical pattern: positive first value (likely latitude) with negative second
  // BUT only if the negative second has reasonable magnitude for longitude
  const positiveLatNegativeLng = first > 0 && first <= 90 && 
                                second < 0 && Math.abs(second) > 10; // Must be significant longitude
  
  // 3. For Eastern hemisphere: small positive first value with larger positive second
  const smallFirstLargeSecond = first > 0 && first <= 90 && 
                               second > 90 && second <= 180;
  
  // Only swap if we have strong evidence of incorrect order
  const shouldSwap = (firstInLatRange && secondClearlyLongitude) ||
                    positiveLatNegativeLng ||
                    smallFirstLargeSecond;
  
  let finalCoords;
  if (shouldSwap) {
    finalCoords = [second, first]; // Swap to [longitude, latitude]
  } else {
    finalCoords = [first, second]; // Keep as [longitude, latitude]
  }
  
  // Final validation of corrected coordinates
  const [lng, lat] = finalCoords;
  if (lng < -180 || lng > 180) {
    throw new Error('Longitude must be between -180 and 180 degrees');
  }
  if (lat < -90 || lat > 90) {
    throw new Error('Latitude must be between -90 and 90 degrees');
  }
  
  return finalCoords;
}

export async function createProperty(req, res, next) {
  try {
    if (!req.userId) {
      return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    }
    const oxyUserId = req.user?.id || req.user?._id || req.userId;
    if (!req.body.profileId) {
      const { Profile } = require('../../models');
      let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) {
        activeProfile = await Profile.create({
          oxyUserId,
            profileType: ProfileType.PERSONAL,
            isPrimary: true,
            isActive: true,
            personalProfile: {}
        });
      }
      req.body.profileId = activeProfile._id;
    }

    const propertyData = { ...req.body, profileId: req.body.profileId };
    
    // Handle address creation or reference
    let addressId;
    if (req.body.address) {
      const { Address } = require('../../models');
      
      // Extract address data from request
      let addressData = { ...req.body.address };
      
      // Handle coordinates from location field if provided
      if (req.body.location?.coordinates) {
        // Ensure coordinates are numbers
        const coords = req.body.location.coordinates.map(coord => Number(coord));
        
        // Validate coordinate order and fix if reversed
        // GeoJSON standard requires [longitude, latitude] format
        const validatedCoords = validateAndFixCoordinateOrder(coords);
        
        addressData.coordinates = {
          type: req.body.location.type || 'Point',
          coordinates: validatedCoords
        };
        
        // Log coordinate correction for debugging
        if (validatedCoords[0] !== coords[0] || validatedCoords[1] !== coords[1]) {
          logger.info('Corrected coordinate order', { 
            original: coords, 
            corrected: validatedCoords,
            reason: 'Coordinates appeared to be in [latitude, longitude] format, corrected to [longitude, latitude]'
          });
        }
      }
      
      // Find or create address using new canonical method
      const address = await Address.findOrCreateCanonical(addressData);
      addressId = address._id;
    } else if (req.body.addressId) {
      // Address ID directly provided
      addressId = req.body.addressId;
    } else {
      return next(new AppError('Address information is required', 400, 'MISSING_ADDRESS'));
    }

    // Remove address data from property and set addressId
    delete propertyData.address;
    delete propertyData.location;
    propertyData.addressId = addressId;

    logger.info('Creating property with data', { propertyData });
    const property = new Property(propertyData);
    const savedProperty = await property.save();
    
    // Populate address for response
    await savedProperty.populate('addressId');
    
    businessLogger.propertyCreated(savedProperty._id, savedProperty.profileId);
    telegramService.sendPropertyNotification(savedProperty).catch(error => {
      logger.error('Failed to send Telegram notification for new property', { propertyId: savedProperty._id, error: error.message });
    });
    res.status(201).json(successResponse(savedProperty.toJSON(), 'Property created successfully'));
  } catch (error) {
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map((err: any) => err.message);
      const validationError: any = new AppError('Property validation failed', 400, 'VALIDATION_ERROR');
      validationError.details = validationErrors;
      return next(validationError);
    }
    next(error);
  }
}
