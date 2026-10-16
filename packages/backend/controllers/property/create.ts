/**
 * `POST /api/properties` — create a listing owned by the session.
 *
 * A thin adapter: the rules (field whitelist, offering rules, photo intake,
 * address resolution, partner attribution, side effects) live in
 * `domain/properties.ts`, which the `createProperty` capability tool calls too.
 */

import { createProperty as createPropertyForOwner } from '../../domain/properties';
import { successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

export async function createProperty(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const savedProperty = await createPropertyForOwner(oxyUserId, req.body ?? {});
    res.status(201).json(successResponse(savedProperty, 'Property created successfully'));
  } catch (error) {
    next(error);
  }
}
