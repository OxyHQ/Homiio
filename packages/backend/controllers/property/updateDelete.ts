/**
 * `PUT` / `DELETE /api/properties/:propertyId` — the owner edits or removes a
 * listing. Thin adapters over `domain/properties.ts`, which the capability
 * tools call too; ownership is enforced in the repository query there.
 */

import {
  deleteProperty as deletePropertyForOwner,
  updateProperty as updatePropertyForOwner,
} from '../../domain/properties';
import { successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

export async function updateProperty(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { propertyId } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);
    const updatedProperty = await updatePropertyForOwner(oxyUserId, propertyId, req.body ?? {});
    res.json(successResponse(updatedProperty, 'Property updated successfully'));
  } catch (error) {
    next(error);
  }
}

export async function deleteProperty(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { propertyId } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);
    await deletePropertyForOwner(oxyUserId, propertyId);
    res.json(successResponse(null, 'Property deleted successfully'));
  } catch (error) {
    next(error);
  }
}
