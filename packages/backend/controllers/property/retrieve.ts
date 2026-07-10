import { Property, RecentlyViewed } from '../../models';
import { AppError, successResponse, paginationResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import { serializePropertyAddresses, ADDRESS_GEO_POPULATE } from '../../services/propertyAddressSerializer';
import { serializePropertyImages } from '../../services/imageSerializer';
import { getErrorName } from '../../utils/errors';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';
import { getQueryInteger } from '../queryParams';

export async function getPropertyById(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { propertyId } = req.params;
    const property = await Property.findById(propertyId).populate(ADDRESS_GEO_POPULATE).lean();
    if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

    if (property.deletedAt) {
      const sessionId = req.user?.id || req.user?._id;
      const isOwner = Boolean(sessionId) && String(property.oxyUserId) === String(sessionId);
      if (!isOwner) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }

    serializePropertyAddresses(property);
    serializePropertyImages(property);
    await Property.findByIdAndUpdate(propertyId, { $inc: { views: 1 } });

    const sessionId = req.user?.id || req.user?._id;
    if (sessionId) {
      RecentlyViewed.findOneAndUpdate(
        { oxyUserId: sessionId, propertyId },
        { oxyUserId: sessionId, propertyId, viewedAt: new Date() },
        { upsert: true, new: true },
      ).catch((error: unknown) => {
        logger.warn('Failed to update recently viewed property', { propertyId, error });
      });
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
    const oxyUserId = requireSessionOxyUserId(req);
    const skip = (page - 1) * limit;
    const [properties, total] = await Promise.all([
      Property.find({ oxyUserId, status: { $ne: 'archived' } })
        .populate(ADDRESS_GEO_POPULATE)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      Property.countDocuments({ oxyUserId, status: { $ne: 'archived' } }),
    ]);
    serializePropertyAddresses(properties);
    serializePropertyImages(properties);
    res.json(paginationResponse(properties, page, limit, total, 'Your properties retrieved successfully'));
  } catch (error) {
    next(error);
  }
}
