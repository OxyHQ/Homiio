const { Property } = require('../../models');
const { AppError, successResponse } = require('../../middlewares/errorHandler');

export async function updateProperty(req, res, next) {
  try {
    const { propertyId } = req.params;
    const updateData = req.body;
    const oxyUserId = req.user?.id || req.user?._id || req.userId;
    if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    const { Profile } = require('../../models');
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));
    const property = await Property.findById(propertyId);
    if (!property) return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
    if (property.profileId.toString() !== activeProfile._id.toString()) return next(new AppError('Access denied - you can only edit your own properties', 403, 'FORBIDDEN'));
    const updatedProperty = await Property.findByIdAndUpdate(propertyId, { ...updateData, updatedAt: new Date() }, { new: true, runValidators: true });
    if (!updatedProperty) return next(new AppError('Failed to update property', 500, 'UPDATE_FAILED'));
    res.json(successResponse(updatedProperty, 'Property updated successfully'));
  } catch (error) { next(error); }
}

export async function deleteProperty(req, res, next) {
  try {
    const { propertyId } = req.params;
    // TODO: implement soft delete & ownership check
    res.json(successResponse(null, 'Property deleted successfully'));
  } catch (error) { next(error); }
}
