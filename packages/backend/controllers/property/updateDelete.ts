import { PropertyStatus } from '@homiio/shared-types';
import { applyOfferingRulesForUpdate, OfferingValidationError, type OfferingBearingPayload } from './offeringRules';
import { EDITABLE_PROPERTY_FIELDS } from './editableFields';
import { pickFields } from '../../utils/pickFields';
import { onPropertyTransacted } from '../../services/commissionService';
import { schedulePriceEthicsScore } from '../../services/priceEthicsService';
import { Property } from '../../models';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

/** Statuses that close a deal and (for sourced listings) earn a commission. */
const TERMINAL_STATUSES: ReadonlyArray<string> = [PropertyStatus.RENTED, PropertyStatus.SOLD];

export async function updateProperty(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { propertyId } = req.params;

    // Whitelist the editable fields; never spread `req.body`. Ownership
    // (`profileId`), `addressId`, partner attribution, verification, views,
    // timestamps, and `type` are NOT client-assignable — owner reassignment /
    // mass-assignment is impossible through this endpoint.
    const updateData = pickFields<OfferingBearingPayload>(req.body, EDITABLE_PROPERTY_FIELDS);

    const oxyUserId = req.user?.id || req.user?._id || req.userId;
    if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    const { Profile } = require('../../models');
    const activeProfile = await Profile.findOrCreateByOxyUserId(oxyUserId);
    if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));
    const property = await Property.findById(propertyId);
    if (!property) return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
    if (!property.profileId) return next(new AppError('Property owner is missing', 500, 'PROPERTY_OWNER_MISSING'));
    if (property.profileId.toString() !== activeProfile._id.toString()) return next(new AppError('Access denied - you can only edit your own properties', 403, 'FORBIDDEN'));

    // Validate & normalize per-offering fields against the listing's CURRENT
    // stored state: a partial body may touch `offerings` and/or any block
    // independently, so coherence is checked on the effective (stored ⊕ body)
    // document. Also derives `sale.pricePerSqm`.
    applyOfferingRulesForUpdate(updateData, {
      offerings: property.offerings,
      longTermRent: property.longTermRent,
      shortTermRent: property.shortTermRent,
      sale: property.sale,
      exchange: property.exchange,
    });

    // Handle address update if provided. `address`/`location` are read straight
    // from the body (they are not whitelisted property fields); the server
    // resolves them to a canonical Address and sets `addressId` itself.
    if (req.body.address) {
      const { Address } = require('../../models');

      const addressData = { ...req.body.address };

      // Handle coordinates from location field if provided
      if (req.body.location?.coordinates) {
        const coords = req.body.location.coordinates.map((coord: unknown) => Number(coord));
        addressData.coordinates = {
          type: req.body.location.type || 'Point',
          coordinates: coords,
        };
      }

      const address = await Address.findOrCreate(addressData);
      updateData.addressId = address._id;
    }

    const updatedProperty = await Property.findByIdAndUpdate(
      propertyId,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    ).populate('addressId');

    if (!updatedProperty) return next(new AppError('Failed to update property', 500, 'UPDATE_FAILED'));

    // When this edit closes the deal (status → rented/sold) on a listing sourced
    // by a partner, fire the commission trigger. It is idempotent, so editing a
    // property that is already terminal never creates a second commission.
    const transitionedToTerminal =
      property.status !== updatedProperty.status && TERMINAL_STATUSES.includes(updatedProperty.status);
    if (transitionedToTerminal && updatedProperty.sourcedByPartner) {
      try {
        await onPropertyTransacted(updatedProperty);
      } catch (commissionError) {
        // A commission failure must not fail the property update itself.
        logger.error('Failed to process commission on property close', {
          propertyId: String(propertyId),
          error: commissionError instanceof Error ? commissionError.message : String(commissionError),
        });
      }
    }

    schedulePriceEthicsScore(String(propertyId));

    res.json(successResponse(updatedProperty.toJSON(), 'Property updated successfully'));
  } catch (error) {
    if (error instanceof OfferingValidationError) {
      return next(new AppError(error.message, 400, error.code));
    }
    next(error);
  }
}

export async function deleteProperty(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { propertyId } = req.params;

    const oxyUserId = req.user?.id || req.user?._id || req.userId;
    if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    const { Profile } = require('../../models');
    const activeProfile = await Profile.findOrCreateByOxyUserId(oxyUserId);
    if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));
    const property = await Property.findById(propertyId);
    if (!property) return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
    if (!property.profileId) return next(new AppError('Property owner is missing', 500, 'PROPERTY_OWNER_MISSING'));
    if (property.profileId.toString() !== activeProfile._id.toString()) return next(new AppError('Access denied - you can only delete your own properties', 403, 'FORBIDDEN'));

    // Soft delete: archive the listing and stamp deletedAt. The document is
    // kept for audit/history; public list/search/geo queries exclude it via
    // the `deletedAt: null` guard, and getMyProperties excludes `archived`.
    property.status = PropertyStatus.ARCHIVED;
    property.deletedAt = new Date();
    await property.save();

    logger.info('Property soft-deleted', {
      propertyId: String(propertyId),
      profileId: activeProfile._id.toString(),
    });

    res.json(successResponse(null, 'Property deleted successfully'));
  } catch (error) { next(error); }
}
