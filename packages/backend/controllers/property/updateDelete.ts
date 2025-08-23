const { Property } = require('../../models');
const { AppError, successResponse } = require('../../middlewares/errorHandler');

export async function updateProperty(req, res, next) {
  try {
    const { propertyId } = req.params;
    const updateData = { ...req.body };
    const oxyUserId = req.user?.id || req.user?._id || req.userId;
    if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    const { Profile } = require('../../models');
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));
    const property = await Property.findById(propertyId);
    if (!property) return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
    if (property.profileId.toString() !== activeProfile._id.toString()) return next(new AppError('Access denied - you can only edit your own properties', 403, 'FORBIDDEN'));
    
    // Handle address update if provided
    if (updateData.address) {
      const { Address } = require('../../models');
      
      // Extract address data from request
      let addressData = { ...updateData.address };
      
      // Handle coordinates from location field if provided
      if (updateData.location?.coordinates) {
        // Ensure coordinates are numbers
        const coords = updateData.location.coordinates.map(coord => Number(coord));
        addressData.coordinates = {
          type: updateData.location.type || 'Point',
          coordinates: coords
        };
      }
      
      // Find or create address
      const address = await Address.findOrCreate(addressData);
      updateData.addressId = address._id;
      
      // Remove address data from updateData
      delete updateData.address;
      delete updateData.location;
    }
    
    const updatedProperty = await Property.findByIdAndUpdate(
      propertyId, 
      { ...updateData, updatedAt: new Date() }, 
      { new: true, runValidators: true }
    ).populate('addressId');
    
    if (!updatedProperty) return next(new AppError('Failed to update property', 500, 'UPDATE_FAILED'));
    res.json(successResponse(updatedProperty.toJSON(), 'Property updated successfully'));
  } catch (error) { next(error); }
}

export async function deleteProperty(req, res, next) {
  try {
    const { propertyId } = req.params;
    // TODO: implement soft delete & ownership check
    res.json(successResponse(null, 'Property deleted successfully'));
  } catch (error) { next(error); }
}
