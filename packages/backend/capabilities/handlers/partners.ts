import { getMyGuestPoints } from '../../domain/guestPoints';
import {
  getMyPartnerEarnings,
  getMyPartnerStatus,
  joinPartnerProgram,
  listMyReferrals,
} from '../../domain/partners';
import type { HomiioToolHandlers } from './context';

export const PARTNER_HANDLERS: HomiioToolHandlers = {
  // No display name on this lane: the referral code's slug is minted without one.
  joinPartnerProgram: async (_input, { accountId }) => ({
    data: (await joinPartnerProgram(accountId)).payload,
  }),
  getMyPartnerStatus: async (_input, { accountId }) => ({
    data: await getMyPartnerStatus(accountId),
  }),
  listMyReferrals: async (_input, { accountId }) => ({
    data: { properties: (await listMyReferrals(accountId)).properties },
  }),
  getMyPartnerEarnings: async (_input, { accountId }) => ({
    data: { commissions: (await getMyPartnerEarnings(accountId)).commissions },
  }),
  getMyGuestPoints: async (_input, { accountId }) => ({ data: await getMyGuestPoints(accountId) }),
};
