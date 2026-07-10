import { applyOfferingRulesForCreate, OfferingValidationError, type OfferingBearingPayload } from './offeringRules';
import { CREATABLE_PROPERTY_FIELDS } from './editableFields';
import { pickFields } from '../../utils/pickFields';
import { Property } from '../../models';
import { logger, businessLogger } from '../../middlewares/logging';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { getErrorName, getValidationMessages } from '../../utils/errors';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

function validateAndFixCoordinateOrder(coords: number[]): number[] {
  if (!Array.isArray(coords) || coords.length !== 2) {
    throw new Error('Coordinates must be an array of exactly 2 numbers');
  }

  const [first, second] = coords;

  if (isNaN(first) || isNaN(second)) {
    throw new Error('Coordinates must be valid numbers');
  }

  if (Math.abs(first) > 180 || Math.abs(second) > 180) {
    throw new Error('Coordinates out of valid range');
  }

  const firstInLatRange = first >= -90 && first <= 90;
  const secondClearlyLongitude = Math.abs(second) > 90;
  const positiveLatNegativeLng = first > 0 && first <= 90 &&
                                second < 0 && Math.abs(second) > 10;
  const smallFirstLargeSecond = first > 0 && first <= 90 &&
                               second > 90 && second <= 180;

  const shouldSwap = (firstInLatRange && secondClearlyLongitude) ||
                    positiveLatNegativeLng ||
                    smallFirstLargeSecond;

  const finalCoords = shouldSwap ? [second, first] : [first, second];
  const [lng, lat] = finalCoords;
  if (lng < -180 || lng > 180) {
    throw new Error('Longitude must be between -180 and 180 degrees');
  }
  if (lat < -90 || lat > 90) {
    throw new Error('Latitude must be between -90 and 90 degrees');
  }

  return finalCoords;
}

export async function createProperty(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);

    const propertyData = pickFields<OfferingBearingPayload>(req.body, CREATABLE_PROPERTY_FIELDS);
    propertyData.oxyUserId = oxyUserId;

    const referralCode = typeof req.body.referralCode === 'string' ? req.body.referralCode.trim() : '';
    if (referralCode) {
      const { Partner } = require('../../models');
      const partner = await Partner.findOne({ referralCode: referralCode.toLowerCase(), status: 'active' });
      if (partner) {
        propertyData.sourcedByPartner = partner._id;
        propertyData.sourcedByReferralCode = partner.referralCode;
      } else {
        logger.info('Property create: referral code did not match an active partner', { referralCode });
      }
    }

    applyOfferingRulesForCreate(propertyData);

    let addressId;
    if (req.body.address) {
      const { Address } = require('../../models');
      let addressData = { ...req.body.address };

      if (req.body.location?.coordinates) {
        const coords = req.body.location.coordinates.map((coord: unknown) => Number(coord));
        const validatedCoords = validateAndFixCoordinateOrder(coords);
        addressData.coordinates = {
          type: req.body.location.type || 'Point',
          coordinates: validatedCoords,
        };
      }

      const address = await Address.findOrCreateCanonical(addressData);
      addressId = address._id;
    } else if (req.body.addressId) {
      addressId = req.body.addressId;
    } else {
      return next(new AppError('Address information is required', 400, 'MISSING_ADDRESS'));
    }

    propertyData.addressId = addressId;

    const property = new Property(propertyData);
    const savedProperty = await property.save();
    await savedProperty.populate('addressId');

    businessLogger.propertyCreated(savedProperty._id.toString(), oxyUserId);

    res.status(201).json(successResponse(savedProperty.toJSON(), 'Property created successfully'));
  } catch (error) {
    if (error instanceof OfferingValidationError) {
      return next(new AppError(error.message, 400, error.code));
    }
    if (getErrorName(error) === 'ValidationError') {
      return next(new AppError(getValidationMessages(error).join('; '), 400, 'VALIDATION_ERROR'));
    }
    next(error);
  }
}
