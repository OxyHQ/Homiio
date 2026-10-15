import { oxyService } from '../../services/oxy';
import { changeCollaborator, getCaseTeam } from '../../db/evictions/collaboratorRepository';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

export async function getTeam(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const team = await getCaseTeam(req.params.id, requireSessionOxyUserId(req));
    if (!team) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    res.setHeader('Cache-Control', 'no-store');
    res.json(successResponse(team));
  } catch (error) {
    next(error);
  }
}

async function change(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
  add: boolean,
) {
  try {
    const actorOxyUserId = requireSessionOxyUserId(req);
    const oxyUserId = add ? req.body?.oxyUserId : req.params.oxyUserId;
    if (typeof oxyUserId !== 'string' || !oxyUserId.trim() || oxyUserId.length > 200) {
      return next(new AppError('An Oxy account is required', 400, 'INVALID_COLLABORATOR'));
    }
    if (add && req.body?.acknowledgeExactLocationAccess !== true) {
      return next(
        new AppError(
          'Confirm that this collaborator may edit the case and read its exact address',
          400,
          'COLLABORATOR_ACCESS_ACKNOWLEDGEMENT_REQUIRED',
        ),
      );
    }
    if (add) {
      // Check management authority before calling the external identity service.
      const team = await getCaseTeam(req.params.id, actorOxyUserId);
      if (!team?.isOwner)
        return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
      const target = await oxyService.users.get(oxyUserId.trim(), { cache: false });
      if (!target || target.id !== oxyUserId.trim())
        return next(new AppError('Oxy account not found', 404, 'COLLABORATOR_NOT_FOUND'));
    }
    const outcome = await changeCollaborator({
      caseId: req.params.id,
      actorOxyUserId,
      oxyUserId: oxyUserId.trim(),
      add,
    });
    if (outcome === 'not_found')
      return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    if (outcome === 'creator')
      return next(
        new AppError(
          'The creator cannot be added or removed as a collaborator',
          400,
          'CASE_CREATOR_IMMUTABLE',
        ),
      );
    res.json(successResponse({ changed: true }));
  } catch (error) {
    next(error);
  }
}

export const addCollaborator = (
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) => change(req, res, next, true);
export const removeCollaborator = (
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) => change(req, res, next, false);
