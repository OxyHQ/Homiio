import { getMyProfile, getPublicProfile, updateMyProfile } from '../../domain/profile';
import { AppError } from '../../middlewares/errorHandler';
import { type HomiioToolHandlers, requiredObject, requiredString } from './context';

export const PROFILE_HANDLERS: HomiioToolHandlers = {
  getMyProfile: async (_input, { accountId }) => ({ data: await getMyProfile(accountId) }),
  updateMyProfile: async (input, { accountId }) => ({
    data: await updateMyProfile(accountId, requiredObject(input, 'profile')),
  }),
  getUserProfile: async (input) => {
    const profile = await getPublicProfile(requiredString(input, 'oxyUserId'));
    if (!profile) throw new AppError('Profile not found', 404, 'PROFILE_NOT_FOUND');
    return { data: profile };
  },
};
