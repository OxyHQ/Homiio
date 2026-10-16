/**
 * A case's team: its creator and the collaborators who may edit it and read its
 * exact address. Management is the creator's alone, enforced by
 * `collaboratorRepository`; anybody else gets the case's 404.
 */

import { changeCollaborator, getCaseTeam } from '../../db/evictions/collaboratorRepository';
import { AppError } from '../../middlewares/errorHandler';
import { oxyService } from '../../services/oxy';

const CASE_NOT_FOUND = () => new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND');

/** The case team, to a member of it. */
export async function getEvictionTeam(oxyUserId: string, id: string) {
  const team = await getCaseTeam(id, oxyUserId);
  if (!team) throw CASE_NOT_FOUND();
  return team;
}

function collaboratorId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new AppError('An Oxy account is required', 400, 'INVALID_COLLABORATOR');
  }
  return value.trim();
}

async function applyChange(
  actorOxyUserId: string,
  caseId: string,
  oxyUserId: string,
  add: boolean,
) {
  const outcome = await changeCollaborator({ caseId, actorOxyUserId, oxyUserId, add });
  if (outcome === 'not_found') throw CASE_NOT_FOUND();
  if (outcome === 'creator') {
    throw new AppError(
      'The creator cannot be added or removed as a collaborator',
      400,
      'CASE_CREATOR_IMMUTABLE',
    );
  }
  return { changed: true };
}

/**
 * Add a collaborator. The creator must acknowledge that a collaborator may edit
 * the case and read its exact address, and the person must be a real Oxy
 * account — checked only after management authority, so a stranger cannot use
 * this to probe Oxy for accounts.
 */
export async function addEvictionCollaborator(
  actorOxyUserId: string,
  id: string,
  input: { readonly oxyUserId: unknown; readonly acknowledgeExactLocationAccess: unknown },
) {
  const oxyUserId = collaboratorId(input.oxyUserId);
  if (input.acknowledgeExactLocationAccess !== true) {
    throw new AppError(
      'Confirm that this collaborator may edit the case and read its exact address',
      400,
      'COLLABORATOR_ACCESS_ACKNOWLEDGEMENT_REQUIRED',
    );
  }
  const team = await getCaseTeam(id, actorOxyUserId);
  if (!team?.isOwner) throw CASE_NOT_FOUND();
  const target = await oxyService.users.get(oxyUserId, { cache: false });
  if (!target || target.id !== oxyUserId) {
    throw new AppError('Oxy account not found', 404, 'COLLABORATOR_NOT_FOUND');
  }
  return applyChange(actorOxyUserId, id, oxyUserId, true);
}

/** Remove a collaborator. */
export async function removeEvictionCollaborator(
  actorOxyUserId: string,
  id: string,
  target: unknown,
) {
  return applyChange(actorOxyUserId, id, collaboratorId(target), false);
}
