import { ProfileType } from '@homiio/shared-types';
const { Property } = require('../../models');
const { telegramService } = require('../../services');
const { logger, businessLogger } = require('../../middlewares/logging');
const { AppError, successResponse } = require('../../middlewares/errorHandler');

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
        addressData.coordinates = {
          type: req.body.location.type || 'Point',
          coordinates: coords
        };
      }
      
      // Find or create address
      const address = await Address.findOrCreate(addressData);
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

export async function createPropertyDev(req, res, next) {
  try {
    const oxyUserId = req.user?.id || req.user?._id || req.userId;
    if (!req.body.profileId) {
      const { Profile } = require('../../models');
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) {
        return next(new AppError('Profile ID is required', 400, 'PROFILE_ID_REQUIRED'));
      }
      req.body.profileId = activeProfile._id;
    }
    
    const propertyData = { ...req.body, profileId: req.body.profileId };
    
    // Handle address creation or reference (same as main createProperty)
    let addressId;
    if (req.body.address) {
      const { Address } = require('../../models');
      
      // Extract address data from request
      let addressData = { ...req.body.address };
      
      // Handle coordinates from location field if provided
      if (req.body.location?.coordinates) {
        // Ensure coordinates are numbers
        const coords = req.body.location.coordinates.map(coord => Number(coord));
        addressData.coordinates = {
          type: req.body.location.type || 'Point',
          coordinates: coords
        };
      }
      
      // Find or create address
      const address = await Address.findOrCreate(addressData);
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
    
    logger.info('Creating property with data (dev mode)', { propertyData });
    const property = new Property(propertyData);
    const savedProperty = await property.save();
    
    // Populate address for response
    await savedProperty.populate('addressId');
    
    businessLogger.propertyCreated(savedProperty._id, savedProperty.profileId);
    telegramService.sendPropertyNotification(savedProperty).catch(error => {
      logger.error('Failed to send Telegram notification for new property (dev mode)', { propertyId: savedProperty._id, error: error.message });
    });
    res.status(201).json(successResponse(savedProperty.toJSON(), 'Property created successfully (dev mode)'));
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
