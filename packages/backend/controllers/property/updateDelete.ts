import { PropertyStatus } from '@homiio/shared-types';
import { applyOfferingRulesForUpdate, OfferingValidationError, type OfferingBearingPayload } from './offeringRules';
import { EDITABLE_PROPERTY_FIELDS } from './editableFields';
import { pickFields } from '../../utils/pickFields';
import { onPropertyTransacted } from '../../services/commissionService';
import { schedulePriceEthicsScore } from '../../services/priceEthicsService';
import { findOrCreateCanonicalAddress } from '../../services/addressService';
import { findPropertyById } from '../../db/properties/propertyReads';
import { serializeProperty } from '../../db/properties/propertySerializer';
import { softDeleteProperty, updateProperty as updatePropertyRow } from '../../db/properties/propertyWrites';
import { getDb } from '../../db/postgres';
import {
  readPropertySnapshot,
  recordPropertyChangeEvents,
  recordPropertyRemovedEvent,
} from '../../services/watches/propertyEventProducer';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

/** Statuses that close a deal and (for sourced listings) earn a commission. */
const TERMINAL_STATUSES: ReadonlyArray<string> = [PropertyStatus.RENTED, PropertyStatus.SOLD];

export async function updateProperty(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { propertyId } = req.params;
    const updateData = pickFields<OfferingBearingPayload>(req.body, EDITABLE_PROPERTY_FIELDS);

    const oxyUserId = requireSessionOxyUserId(req);
    // Read the CURRENT listing first: the offering rules are evaluated against
    // the merge of stored and incoming state, so a partial update that mentions
    // only `sale` is still judged against the offerings the listing already
    // declares. The ownership predicate is repeated on the UPDATE itself, so
    // this read is not the authorization — it is the rules' input.
    const existing = await findPropertyById(propertyId);
    if (!existing || existing.property.oxyUserId !== oxyUserId) {
      return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
    }
    const current = serializeProperty(existing);

    applyOfferingRulesForUpdate(updateData, {
      offerings: current.offerings,
      longTermRent: current.longTermRent as { monthlyAmount?: unknown } | undefined,
      shortTermRent: current.shortTermRent as { nightlyRate?: unknown } | undefined,
      sale: current.sale as { price?: unknown } | undefined,
      exchange: current.exchange as { mode?: unknown } | undefined,
    });

    if (req.body.address) {
      // Address writes go through the canonical resolver, which whitelists the
      // address fields into an explicit `docFields` set (never a raw spread) and
      // server-resolves the geo id chain — so client `req.body.address` keys
      // outside that allowlist never reach the Address document.
      const addressData = { ...req.body.address };
      if (req.body.location?.coordinates) {
        const coords = req.body.location.coordinates.map((coord: unknown) => Number(coord));
        addressData.coordinates = {
          type: req.body.location.type || 'Point',
          coordinates: coords,
        };
      }
      const address = await findOrCreateCanonicalAddress(addressData);
      updateData.addressId = address.id;
    }

    // The BEFORE half of any change event (#356), read while it is still true.
    const beforeSnapshot = await readPropertySnapshot(getDb(), String(propertyId));

    // The ownership predicate rides on the UPDATE, so the check and the write
    // are one statement and a change of owner cannot interleave between them.
    const updated = await updatePropertyRow(propertyId, updateData, { ownedBy: oxyUserId });
    if (!updated) return next(new AppError('Failed to update property', 500, 'UPDATE_FAILED'));
    const updatedProperty = serializeProperty(updated);

    if (beforeSnapshot) {
      const afterSnapshot = await readPropertySnapshot(getDb(), String(propertyId));
      if (afterSnapshot) await recordPropertyChangeEvents(beforeSnapshot, afterSnapshot);
    }

    const transitionedToTerminal =
      existing.property.status !== updated.property.status &&
      TERMINAL_STATUSES.includes(updated.property.status);
    if (transitionedToTerminal && updated.property.sourcedByPartnerId) {
      try {
        await onPropertyTransacted({
          ...updatedProperty,
          _id: updated.property.id,
          sourcedByPartner: updated.property.sourcedByPartnerId,
        });
      } catch (commissionError) {
        logger.error('Failed to process commission on property close', {
          propertyId: String(propertyId),
          error: commissionError instanceof Error ? commissionError.message : String(commissionError),
        });
      }
    }

    schedulePriceEthicsScore(String(propertyId));

    res.json(successResponse(updatedProperty, 'Property updated successfully'));
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
    // Read BEFORE the write: the title and the coordinates a `listing_removed`
    // event needs are only readable while the listing is still visible. It is
    // read unconditionally rather than after a successful delete, because after
    // the delete there is nothing left to read — and it is discarded when the
    // delete turns out not to have been this caller's to make.
    const snapshot = await readPropertySnapshot(getDb(), String(propertyId));
    // One statement: no row matched means either no such listing or not this
    // caller's, deliberately indistinguishable so a 404 does not confirm a
    // listing exists.
    const deleted = await softDeleteProperty(propertyId, { ownedBy: oxyUserId });
    if (!deleted) return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
    if (snapshot) await recordPropertyRemovedEvent(snapshot);

    logger.info('Property soft-deleted', { propertyId: String(propertyId), oxyUserId });
    res.json(successResponse(null, 'Property deleted successfully'));
  } catch (error) {
    next(error);
  }
}
