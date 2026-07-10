/**
 * Partner (agent) data hooks.
 *
 * Thin TanStack Query wrappers over `services/partnerApi`. The "me" query is the
 * source of truth the `/agent` screen derives all of its state from (joined vs
 * not-joined, link, stats); join is a mutation that refreshes it. Referrals and
 * earnings power the dashboard and are only enabled once the user is a partner.
 *
 * Auth: every partner endpoint requires an Oxy session, so each query is gated
 * on `isAuthenticated` (no point hitting a 401 for a logged-out visitor — the
 * screen shows a sign-in CTA instead). The keys are namespaced under `partner`.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import type {
  Commission,
  PartnerMeResponse,
  Property,
  PropertyStatus,
} from '@homiio/shared-types';

import { partnerApi } from '@/services/partnerApi';
import { propertyService, type MarkTransactedResult } from '@/services/propertyService';

/** Stable query-key factory so invalidation never drifts from the queries. */
export const partnerKeys = {
  all: ['partner'] as const,
  me: () => [...partnerKeys.all, 'me'] as const,
  referrals: () => [...partnerKeys.all, 'referrals'] as const,
  earnings: () => [...partnerKeys.all, 'earnings'] as const,
};

/** Five minutes — partner state changes rarely (join, a closed deal). */
const PARTNER_STALE_TIME = 1000 * 60 * 5;

/**
 * Current user's partner state, link and stats. Disabled (and therefore never
 * fetched) for signed-out visitors so the `/agent` screen can branch on
 * `isAuthenticated` and show a sign-in CTA without a wasted 401.
 */
export function usePartnerMe(): UseQueryResult<PartnerMeResponse> {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: partnerKeys.me(),
    queryFn: () => partnerApi.getMe(),
    enabled: isAuthenticated,
    staleTime: PARTNER_STALE_TIME,
  });
}

/**
 * Enrol the current user as a partner (idempotent). The join endpoint returns
 * the full, authoritative `PartnerMeResponse`, so it is written straight into the
 * "me" cache — the screen reveals the referral link with no refetch round-trip,
 * and no invalidation is needed (an immediate invalidate would discard this
 * optimistic write for a redundant network fetch of the same payload).
 */
export function useJoinPartner(): UseMutationResult<PartnerMeResponse, unknown, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => partnerApi.join(),
    onSuccess: (data) => {
      queryClient.setQueryData(partnerKeys.me(), data);
    },
  });
}

/**
 * Properties the current partner has sourced. Only enabled once the user is a
 * partner (passed in by the screen, which already knows from `usePartnerMe`).
 */
export function useReferrals(isPartner: boolean): UseQueryResult<Property[]> {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: partnerKeys.referrals(),
    queryFn: () => partnerApi.getReferrals(),
    enabled: isAuthenticated && isPartner,
    staleTime: PARTNER_STALE_TIME,
  });
}

/**
 * Commissions the current partner has earned. Only enabled once the user is a
 * partner.
 */
export function useEarnings(isPartner: boolean): UseQueryResult<Commission[]> {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: partnerKeys.earnings(),
    queryFn: () => partnerApi.getEarnings(),
    enabled: isAuthenticated && isPartner,
    staleTime: PARTNER_STALE_TIME,
  });
}

/** Variables for {@link useMarkPropertyTransacted}. */
export interface MarkTransactedVars {
  propertyId: string;
  /** Terminal status; inferred from the listing's offerings server-side when omitted. */
  status?: PropertyStatus;
}

/**
 * Close a deal on an owned listing (mark rented/sold). On success this can flip
 * the caller's partner earnings — a sourced listing closing creates a
 * commission and awards points server-side — so the whole `partner` cache tree
 * (`me`/`referrals`/`earnings`) is invalidated, alongside the property caches
 * that show the listing's status. The owner screen owns the confirm dialog and
 * the success/error toast.
 */
export function useMarkPropertyTransacted(): UseMutationResult<
  MarkTransactedResult,
  unknown,
  MarkTransactedVars
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, status }: MarkTransactedVars) =>
      propertyService.markPropertyTransacted(propertyId, status),
    onSuccess: () => {
      // Prefix invalidation of `['partner']` refreshes me/referrals/earnings.
      queryClient.invalidateQueries({ queryKey: partnerKeys.all });
      queryClient.invalidateQueries({ queryKey: ['property'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
  });
}
