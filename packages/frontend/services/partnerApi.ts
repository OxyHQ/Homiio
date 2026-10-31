/**
 * Partner (agent) referral-commission API client.
 *
 * Wraps the authenticated `/api/partners/*` endpoints behind a small typed
 * surface. Every call uses the shared linked client and checks its captured Oxy
 * owner before dispatch and after reading the response.
 *
 * Response envelopes follow the app convention `{ data: <payload> }`; this
 * client unwraps that envelope and lets transport/HTTP errors propagate so the
 * calling React Query hooks own loading/error/empty state.
 */
import { api, ApiError, type ApiResponse, type RequestOwner } from '@/utils/api';
import type { Commission, PartnerMeResponse, Property } from '@homiio/shared-types';

const BASE_URL = '/api/partners';

export const partnerApi = {
  /**
   * Current user's partner state, link, and aggregate stats. `partner`/`link`
   * are null until the user joins; `stats` is always present (zeroed before
   * joining). Requires Oxy auth.
   */
  async getMe(owner: RequestOwner): Promise<PartnerMeResponse> {
    const response = await api.get<ApiResponse<PartnerMeResponse>>(`${BASE_URL}/me`, {
      requireAuth: true,
      owner,
    });
    const data = response.data?.data;
    if (!data) {
      throw new ApiError('Empty partner response', 500, response.data);
    }
    return data;
  },

  /**
   * Idempotently enrol the current user as a partner, minting a referral code
   * if absent. Returns the same shape as {@link getMe} (now with a non-null
   * `partner`/`link`). Requires Oxy auth.
   */
  async join(owner: RequestOwner): Promise<PartnerMeResponse> {
    const response = await api.post<ApiResponse<PartnerMeResponse>>(`${BASE_URL}/join`, undefined, {
      requireAuth: true,
      owner,
    });
    const data = response.data?.data;
    if (!data) {
      throw new ApiError('Empty partner join response', 500, response.data);
    }
    return data;
  },

  /** Properties sourced by the current partner. Requires Oxy auth. */
  async getReferrals(owner: RequestOwner): Promise<Property[]> {
    const response = await api.get<ApiResponse<{ properties: Property[] }>>(
      `${BASE_URL}/me/referrals`,
      { requireAuth: true, owner },
    );
    return response.data?.data?.properties ?? [];
  },

  /** Commissions earned by the current partner. Requires Oxy auth. */
  async getEarnings(owner: RequestOwner): Promise<Commission[]> {
    const response = await api.get<ApiResponse<{ commissions: Commission[] }>>(
      `${BASE_URL}/me/earnings`,
      { requireAuth: true, owner },
    );
    return response.data?.data?.commissions ?? [];
  },
};
