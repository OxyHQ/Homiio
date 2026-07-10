import { PropertyStatus } from '@homiio/shared-types';
import { applyOfferingRulesForUpdate, OfferingValidationError, type OfferingBearingPayload } from './offeringRules';
import { EDITABLE_PROPERTY_FIELDS } from './editableFields';
import { pickFields } from '../../utils/pickFields';
import { onPropertyTransacted } from '../../services/commissionService';
import { Property } from '../../models';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

const TERMINAL_STATUSES: ReadonlyArray<string> = [PropertyStatus.RENTED, PropertyStatus.SOLD];

export async function updateProperty(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { propertyId } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);
    const updateData = pickFields<OfferingBearingPayload>(req.body, EDITABLE_PROPERTY_FIELDS);

    const property = await Property.findOne({ _id: propertyId, oxyUserId });
    if (!property) {
      return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }

    applyOfferingRulesForUpdate(updateData, {
      offerings: property.offerings,
      longTermRent: property.longTermRent,
      shortTermRent: property.shortTermRent,
      sale: property.sale,
      exchange: property.exchange,
    });

    if (req.body.address) {
      const { Address } = require('../../models');
      const addressData = { ...req.body.address };

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

    const previousStatus = property.status;
    Object.assign(property, updateData);
    const updatedProperty = await property.save();
    await updatedProperty.populate('addressId');

    const transitionedToTerminal =
      previousStatus !== updatedProperty.status && TERMINAL_STATUSES.includes(updatedProperty.status);
    if (transitionedToTerminal && updatedProperty.sourcedByPartner) {
      try {
        await onPropertyTransacted(updatedProperty);
      } catch (commissionError) {
        logger.error('Failed to process commission on property close', {
          propertyId: String(propertyId),
          error: commissionError instanceof Error ? commissionError.message : String(commissionError),
        });
      }
    }

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
    const oxyUserId = requireSessionOxyUserId(req);

    const property = await Property.findOne({ _id: propertyId, oxyUserId });
    if (!property) {
      return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }

    property.status = PropertyStatus.ARCHIVED;
    property.deletedAt = new Date();
    await property.save();

    logger.info('Property soft-deleted', { propertyId: String(propertyId), oxyUserId });

    res.json(successResponse(null, 'Property deleted successfully'));
  } catch (error) {
    next(error);
  }
}
