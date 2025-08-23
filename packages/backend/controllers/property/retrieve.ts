const { Property, RecentlyViewed } = require('../../models');
const { AppError, successResponse, paginationResponse } = require('../../middlewares/errorHandler');

export async function getPropertyById(req, res, next) {
  try {
    const { propertyId } = req.params;
    const property = await Property.findById(propertyId).populate('addressId').lean();
    if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
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
          ).catch(()=>{});
        }
      } catch {}
    }
    res.json(successResponse({ ...property }, 'Property retrieved successfully'));
  } catch (error) {
    if (error.name === 'CastError') return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
    next(error);
  }
}

export async function getMyProperties(req, res, next) {
  try {
    const { page = 1, limit = 10 } = req.query;
    const oxyUserId = req.userId;
    const { Profile } = require('../../models');
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    if (!activeProfile) {
      return res.json(paginationResponse([], parseInt(page), parseInt(limit), 0, 'No profile found for user'));
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [properties, total] = await Promise.all([
      Property.find({ profileId: activeProfile._id, status: { $ne: 'archived' } })
        .populate('addressId')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 })
        .lean(),
      Property.countDocuments({ profileId: activeProfile._id, status: { $ne: 'archived' } })
    ]);
    res.json(paginationResponse(properties, parseInt(page), parseInt(limit), total, 'Your properties retrieved successfully'));
  } catch (error) { next(error); }
}
