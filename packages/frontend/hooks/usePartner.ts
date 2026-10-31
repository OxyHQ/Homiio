/**
 * Partner (agent) data hooks.
 *
 * Thin TanStack Query wrappers over `services/partnerApi`. The "me" query is the
 * source of truth the `/agent` screen derives all of its state from (joined vs
 * not-joined, link, stats); join is a mutation that refreshes it. Referrals and
 * earnings power the dashboard and are only enabled once the user is a partner.
 *
 * Auth: every partner endpoint requires an Oxy session. Cache keys include the
 * projected account and session so another account cannot reuse the result.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutateOptions,
  type UseMutateAsyncFunction,
  type UseMutateFunction,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useOxy } from '@oxy.so/services/ui/client';
import type { Commission, PartnerMeResponse, Property, PropertyStatus } from '@homiio/shared-types';

import { partnerApi } from '@/services/partnerApi';
import { propertyService, type MarkTransactedResult } from '@/services/propertyService';
import type { RequestOwner } from '@/utils/api';

type PartnerOwner = RequestOwner & { sessionId: string | null };

/** A session id may arrive after the bearer while the same account is restored. */
function sameProjection(previous: PartnerOwner | null, current: PartnerOwner | null): boolean {
  return Boolean(
    previous &&
      current &&
      previous.oxyServices === current.oxyServices &&
      previous.userId === current.userId &&
      previous.epoch === current.epoch &&
      (previous.sessionId === current.sessionId || previous.sessionId === null),
  );
}

/** Bind the projected account to the locally observed bearer and session epoch. */
function usePartnerOwner(): PartnerOwner | null {
  const { isAuthenticated, user, activeSessionId, oxyServices } = useOxy();
  const subscribe = useCallback(
    (listener: () => void) => oxyServices.session.onChange(listener),
    [oxyServices],
  );
  const getSnapshot = useCallback(
    () =>
      JSON.stringify([
        oxyServices.http.getSessionEpoch(),
        oxyServices.session.userId,
        Boolean(oxyServices.session.accessToken),
      ]),
    [oxyServices],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const userId = isAuthenticated ? (user?.id ?? null) : null;
  return useMemo(() => {
    const [epoch, bearerUser, hasToken] = JSON.parse(snapshot) as [number, string | null, boolean];
    if (!userId || !hasToken || bearerUser !== userId) return null;
    return {
      oxyServices,
      userId,
      sessionId: activeSessionId ?? null,
      epoch,
    };
  }, [oxyServices, userId, activeSessionId, snapshot]);
}

function assertPartnerOwner(owner: PartnerOwner | null): asserts owner is PartnerOwner {
  if (
    !owner ||
    owner.oxyServices.session.userId !== owner.userId ||
    owner.oxyServices.http.getSessionEpoch() !== owner.epoch
  ) {
    throw new Error('The active account changed');
  }
}

async function withPartnerOwner<T>(
  owner: PartnerOwner | null,
  operation: (owner: PartnerOwner) => Promise<T>,
): Promise<T> {
  assertPartnerOwner(owner);
  const value = await operation(owner);
  assertPartnerOwner(owner);
  return value;
}

/** Stable query-key factory so invalidation never drifts from the queries. */
const partnerKeys = {
  all: ['partner'] as const,
  me: (owner: PartnerOwner | null) =>
    [
      ...partnerKeys.all,
      owner?.userId ?? null,
      owner?.sessionId ?? null,
      owner?.epoch ?? null,
      'me',
    ] as const,
  referrals: (owner: PartnerOwner | null) =>
    [
      ...partnerKeys.all,
      owner?.userId ?? null,
      owner?.sessionId ?? null,
      owner?.epoch ?? null,
      'referrals',
    ] as const,
  earnings: (owner: PartnerOwner | null) =>
    [
      ...partnerKeys.all,
      owner?.userId ?? null,
      owner?.sessionId ?? null,
      owner?.epoch ?? null,
      'earnings',
    ] as const,
};

/** Five minutes — partner state changes rarely (join, a closed deal). */
const PARTNER_STALE_TIME = 1000 * 60 * 5;

/**
 * Current user's partner state, link and stats. Disabled (and therefore never
 * fetched) for signed-out visitors so the `/agent` screen can branch on
 * `isAuthenticated` and show a sign-in CTA without a wasted 401.
 */
export function usePartnerMe(): UseQueryResult<PartnerMeResponse> {
  const owner = usePartnerOwner();
  return useQuery({
    queryKey: partnerKeys.me(owner),
    queryFn: () => withPartnerOwner(owner, partnerApi.getMe),
    enabled: Boolean(owner),
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
export function useJoinPartner(): UseMutationResult<PartnerMeResponse, unknown, void> & {
  isOwnerReady: boolean;
} {
  const queryClient = useQueryClient();
  const owner = usePartnerOwner();
  const committed = useRef<PartnerOwner | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    committed.current = owner;
    return () => {
      if (committed.current === owner) committed.current = null;
    };
  }, [owner]);

  const owns = (candidate: PartnerOwner | null) => {
    if (!candidate || !sameProjection(candidate, committed.current)) return false;
    try {
      assertPartnerOwner(candidate);
      return true;
    } catch {
      return false;
    }
  };
  type Variables = { owner: PartnerOwner | null; accepted: boolean };
  const mutation = useMutation<PartnerMeResponse, unknown, Variables>({
    mutationFn: ({ owner: requested, accepted }) => {
      if (!accepted || (mounted.current && !sameProjection(requested, committed.current))) {
        throw new Error('The active account changed');
      }
      return withPartnerOwner(requested, partnerApi.join);
    },
    onSuccess: (data, { owner: requested, accepted }) => {
      if (
        accepted &&
        requested &&
        (!mounted.current || sameProjection(requested, committed.current))
      ) {
        try {
          assertPartnerOwner(requested);
          queryClient.setQueryData(
            partnerKeys.me(mounted.current ? committed.current : requested),
            data,
          );
        } catch {
          // The completed request is no longer owned by the current session.
        }
      }
    },
  });
  const callbacks = (options?: MutateOptions<PartnerMeResponse, unknown, void>) =>
    options && {
      onSuccess: (
        data: PartnerMeResponse,
        _vars: Variables,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSuccess>>[3],
      ) => {
        if (owns(owner)) options.onSuccess?.(data, undefined, result, context);
      },
      onError: (
        error: unknown,
        _vars: Variables,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onError>>[3],
      ) => {
        if (owns(owner)) options.onError?.(error, undefined, result, context);
      },
      onSettled: (
        data: PartnerMeResponse | undefined,
        error: unknown,
        _vars: Variables,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSettled>>[4],
      ) => {
        if (owns(owner)) options.onSettled?.(data, error, undefined, result, context);
      },
    };
  const mutate: UseMutateFunction<PartnerMeResponse, unknown, void> = (_value, options) => {
    mutation.mutate({ owner, accepted: owns(owner) }, callbacks(options));
  };
  const mutateAsync: UseMutateAsyncFunction<PartnerMeResponse, unknown, void> = async (
    _value,
    options,
  ) => {
    const accepted = owns(owner);
    const data = await mutation.mutateAsync({ owner, accepted }, callbacks(options));
    if (!accepted || (mounted.current && !sameProjection(owner, committed.current))) {
      throw new Error('The active account changed');
    }
    assertPartnerOwner(owner);
    return data;
  };
  return { ...mutation, variables: undefined, mutate, mutateAsync, isOwnerReady: Boolean(owner) };
}

/**
 * Properties the current partner has sourced. Only enabled once the user is a
 * partner (passed in by the screen, which already knows from `usePartnerMe`).
 */
export function useReferrals(isPartner: boolean): UseQueryResult<Property[]> {
  const owner = usePartnerOwner();
  return useQuery({
    queryKey: partnerKeys.referrals(owner),
    queryFn: () => withPartnerOwner(owner, partnerApi.getReferrals),
    enabled: Boolean(owner && isPartner),
    staleTime: PARTNER_STALE_TIME,
  });
}

/**
 * Commissions the current partner has earned. Only enabled once the user is a
 * partner.
 */
export function useEarnings(isPartner: boolean): UseQueryResult<Commission[]> {
  const owner = usePartnerOwner();
  return useQuery({
    queryKey: partnerKeys.earnings(owner),
    queryFn: () => withPartnerOwner(owner, partnerApi.getEarnings),
    enabled: Boolean(owner && isPartner),
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
