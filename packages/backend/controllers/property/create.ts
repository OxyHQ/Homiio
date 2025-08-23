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
    if (req.body.location?.coordinates) {
      propertyData.address = propertyData.address || {};
      // Ensure coordinates are numbers
      const coords = req.body.location.coordinates.map(coord => Number(coord));
      propertyData.address.coordinates = {
        type: req.body.location.type,
        coordinates: coords
      };
      delete propertyData.location;
    }
    logger.info('Creating property with data', { propertyData });
    const property = new Property(propertyData);
    const savedProperty = await property.save();
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
    if (req.body.location?.coordinates) {
      propertyData.address = propertyData.address || {};
      // Ensure coordinates are numbers
      const coords = req.body.location.coordinates.map(coord => Number(coord));
      propertyData.address.coordinates = {
        type: req.body.location.type,
        coordinates: coords
      };
      delete propertyData.location;
    }
    logger.info('Creating property with data (dev mode)', { propertyData });
    const property = new Property(propertyData);
    const savedProperty = await property.save();
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
