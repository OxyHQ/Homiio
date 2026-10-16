import {
  endRoommateRelationship,
  getMyRoommatePreferences,
  getMyRoommateStatus,
  listMyRoommateRelationships,
  listMyRoommateRequests,
  listRoommateProfiles,
  respondToRoommateRequest,
  sendRoommateRequest,
  setRoommateMatching,
  updateMyRoommatePreferences,
} from '../../domain/roommates';
import {
  asQuery,
  type HomiioToolHandlers,
  optionalBoolean,
  optionalString,
  requiredObject,
  requiredString,
} from './context';

/** The route bodies, minus the human-readable `message` (a body key the tool drops). */
function withoutMessage<T extends Record<string, unknown>>(body: T): Omit<T, 'message'> {
  const { message: _message, ...rest } = body;
  return rest;
}

export const ROOMMATE_HANDLERS: HomiioToolHandlers = {
  listRoommateProfiles: async (input, { accountId }) =>
    listRoommateProfiles(accountId, asQuery(input)),
  getRoommateStatus: async (_input, { accountId }) => getMyRoommateStatus(accountId),
  getRoommatePreferences: async (_input, { accountId }) => getMyRoommatePreferences(accountId),
  updateRoommatePreferences: async (input, { accountId }) =>
    updateMyRoommatePreferences(accountId, requiredObject(input, 'preferences')),
  toggleRoommateMatching: async (input, { accountId }) =>
    withoutMessage(await setRoommateMatching(accountId, optionalBoolean(input, 'enabled'))),
  listRoommateRequests: async (_input, { accountId }) => listMyRoommateRequests(accountId),
  listRoommateRelationships: async (_input, { accountId }) =>
    listMyRoommateRelationships(accountId),
  sendRoommateRequest: async (input, { accountId }) =>
    withoutMessage(
      await sendRoommateRequest(accountId, {
        targetOxyUserId: requiredString(input, 'oxyUserId'),
        message: optionalString(input, 'message'),
      }),
    ),
  acceptRoommateRequest: async (input, { accountId }) =>
    withoutMessage(
      await respondToRoommateRequest(accountId, requiredString(input, 'requestId'), 'accepted'),
    ),
  declineRoommateRequest: async (input, { accountId }) =>
    withoutMessage(
      await respondToRoommateRequest(accountId, requiredString(input, 'requestId'), 'declined'),
    ),
  endRoommateRelationship: async (input, { accountId }) =>
    withoutMessage(
      await endRoommateRelationship(accountId, requiredString(input, 'relationshipId')),
    ),
};
