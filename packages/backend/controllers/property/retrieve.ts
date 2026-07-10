import { Property, RecentlyViewed } from '../../models';
import { AppError, successResponse, paginationResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import { serializePropertyAddresses, ADDRESS_GEO_POPULATE } from '../../services/propertyAddressSerializer';
import { serializePropertyImages } from '../../services/imageSerializer';
import { getErrorName } from '../../utils/errors';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';
import { getQueryInteger } from '../queryParams';

export async function getPropertyById(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { propertyId } = req.params;
    const property = await Property.findById(propertyId).populate(ADDRESS_GEO_POPULATE).lean();
    if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    // Soft-deleted listings are invisible to everyone except their owner.
    if (property.deletedAt) {
      let isOwner = false;
      const oxyUserId = req.user?.id || req.user?._id;
      if (oxyUserId) {
        isOwner = property.oxyUserId === oxyUserId;
      }
      if (!isOwner) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }
    // Resolve the address's city/region/country NAMES from the deep-populated
    // geo refs (geo is relational), then flatten the refs back to ids.
    serializePropertyAddresses(property);
    serializePropertyImages(property);
    await Property.findByIdAndUpdate(propertyId, { $inc: { views: 1 } });
    if (req.userId && (req.user?.id || req.user?._id)) {
      const oxyUserId = req.user.id || req.user._id;
      try {
        const { Profile } = require('../../models');
        const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
        if (activeProfile) {
          const profileId = activeProfile._id;
          RecentlyViewed.findOneAndUpdate(
            { profileId, propertyId },
            { profileId, propertyId, viewedAt: new Date() },
            { upsert: true, new: true }
          ).catch((error: unknown) => {
            logger.warn('Failed to update recently viewed property', { propertyId, error });
          });
        }
      } catch (error) {
        logger.warn('Failed to resolve profile for recently viewed property', { propertyId, error });
      }
    }
    res.json(successResponse({ ...property }, 'Property retrieved successfully'));
  } catch (error) {
    if (getErrorName(error) === 'CastError') return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
    next(error);
  }
}

export async function getMyProperties(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const page = getQueryInteger(req.query.page, 1);
    const limit = getQueryInteger(req.query.limit, 10);
    const oxyUserId = req.userId;
    if (!oxyUserId) {
      return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    }
    const skip = (page - 1) * limit;
    const [properties, total] = await Promise.all([
      Property.find({ oxyUserId, status: { $ne: 'archived' } })
        .populate(ADDRESS_GEO_POPULATE)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      Property.countDocuments({ oxyUserId, status: { $ne: 'archived' } })
    ]);
    serializePropertyAddresses(properties);
    serializePropertyImages(properties);
    res.json(paginationResponse(properties, page, limit, total, 'Your properties retrieved successfully'));
  } catch (error) { next(error); }
}
