import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type MutateOptions,
  type UseMutateFunction,
  type UseMutateAsyncFunction,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import type { Lease, LeaseDocument } from '@homiio/shared-types';
import {
  type LeaseFilters,
  type LeaseListResponse,
  type TerminateLeaseData,
  type UploadLeaseDocumentInput,
  leaseService,
} from '@/services/leaseService';
import { propertyService } from '@/services/propertyService';
import { type AccountOwner, useAccountOwnerGuard, withAccountOwner } from '@/hooks/useAccountOwner';

const LEASE_LIST_KEY = 'leases';
const LEASE_DETAIL_KEY = 'lease';

export const leaseKeys = {
  list: (filters?: LeaseFilters) => [LEASE_LIST_KEY, filters ?? null] as const,
  detail: (id: string) => [LEASE_DETAIL_KEY, id] as const,
};

/**
 * The current user's leases (as landlord, tenant, or co-tenant). Backed by
 * `GET /api/leases`, which resolves the party from the authenticated profile.
 */
export function useUserLeases(filters?: LeaseFilters): UseQueryResult<LeaseListResponse, Error> {
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  return useQuery<LeaseListResponse, Error>({
    queryKey: leaseKeys.list(filters),
    queryFn: () => leaseService.getLeases(filters),
    enabled: isAuthed,
    staleTime: 1000 * 60,
  });
}

/** Single lease by id (populated with property + party profiles). */
export function useLease(id: string | undefined): UseQueryResult<Lease, Error> {
  return useQuery<Lease, Error>({
    queryKey: leaseKeys.detail(id ?? ''),
    queryFn: () => {
      if (!id) throw new Error('Lease id is required');
      return leaseService.getLease(id);
    },
    enabled: Boolean(id),
    staleTime: 1000 * 30,
  });
}

/**
 * Whether the user owns any properties — i.e. is a landlord who could issue
 * leases. This is derived from owned properties, NOT from "has leases" (a tenant
 * has leases but owns nothing), so the contracts surface can offer the right
 * empty state.
 */
export function useHasRentalProperties(): {
  hasRentalProperties: boolean;
  isLoading: boolean;
} {
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);

  const query = useQuery({
    queryKey: ['owner-properties-count'],
    queryFn: async () => {
      const result = await propertyService.getMyProperties(1, 1);
      return result.total;
    },
    enabled: isAuthed,
    staleTime: 1000 * 60 * 5,
  });

  return {
    hasRentalProperties: (query.data ?? 0) > 0,
    isLoading: query.isLoading,
  };
}

export function useCreateLeaseFromApplication(): UseMutationResult<Lease, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<Lease, Error, string>({
    mutationFn: (applicationId) => leaseService.createLeaseFromApplication(applicationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  });
}

/**
 * Sign a lease.
 *
 * `termsSha256` is the version the screen rendered; see `leaseService.signLease`
 * for why it travels and what the server does when it no longer matches.
 */
type SignLeaseInput = { acceptTerms: boolean; termsSha256?: string };
type OwnedSignVariables = { input: SignLeaseInput; leaseId: string };
const signOwners = new WeakMap<OwnedSignVariables, AccountOwner | null>();

export function useSignLease(
  id: string,
): UseMutationResult<Lease, Error, SignLeaseInput> & { isOwnerReady: boolean } {
  const queryClient = useQueryClient();
  const { owner, isCurrent } = useAccountOwnerGuard();
  const mutation = useMutation<Lease, Error, OwnedSignVariables>({
    mutationFn: (variables) => {
      const captured = signOwners.get(variables) ?? null;
      if (!isCurrent(captured)) throw new Error('The active account changed');
      return withAccountOwner(captured, (current) =>
        leaseService.signLease(
          variables.leaseId,
          variables.input.acceptTerms,
          variables.input.termsSha256,
          current,
        ),
      );
    },
    onSuccess: (lease, variables) => {
      if (!isCurrent(signOwners.get(variables) ?? null)) return;
      queryClient.setQueryData(leaseKeys.detail(variables.leaseId), lease);
      if (isCurrent(signOwners.get(variables) ?? null))
        void queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  });
  const capture = (input: SignLeaseInput): OwnedSignVariables => {
    const variables = { input, leaseId: id };
    signOwners.set(variables, owner);
    return variables;
  };
  const callbacks = (options?: MutateOptions<Lease, Error, SignLeaseInput>) =>
    options && {
      onSuccess: (
        data: Lease,
        variables: OwnedSignVariables,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSuccess>>[3],
      ) => {
        if (isCurrent(signOwners.get(variables) ?? null))
          options.onSuccess?.(data, variables.input, result, context);
      },
      onError: (
        error: Error,
        variables: OwnedSignVariables,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onError>>[3],
      ) => {
        if (isCurrent(signOwners.get(variables) ?? null))
          options.onError?.(error, variables.input, result, context);
      },
      onSettled: (
        data: Lease | undefined,
        error: Error | null,
        variables: OwnedSignVariables,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSettled>>[4],
      ) => {
        if (isCurrent(signOwners.get(variables) ?? null))
          options.onSettled?.(data, error, variables.input, result, context);
      },
    };
  const mutate: UseMutateFunction<Lease, Error, SignLeaseInput> = (input, options) => {
    mutation.mutate(capture(input), callbacks(options));
  };
  const mutateAsync: UseMutateAsyncFunction<Lease, Error, SignLeaseInput> = async (
    input,
    options,
  ) => {
    const variables = capture(input);
    if (!isCurrent(owner)) throw new Error('The active account changed');
    try {
      const result = await mutation.mutateAsync(variables, callbacks(options));
      if (!isCurrent(owner)) throw new Error('The active account changed');
      return result;
    } catch (error) {
      if (!isCurrent(owner)) throw new Error('The active account changed');
      throw error;
    }
  };
  const visible = !mutation.variables || isCurrent(signOwners.get(mutation.variables) ?? null);
  return {
    ...mutation,
    ...(!visible
      ? {
          data: undefined,
          error: null,
          failureCount: 0,
          failureReason: null,
          isError: false,
          isIdle: true,
          isPaused: false,
          isPending: false,
          isSuccess: false,
          status: 'idle' as const,
          submittedAt: 0,
        }
      : {}),
    variables: visible ? mutation.variables?.input : undefined,
    mutate,
    mutateAsync,
    isOwnerReady: Boolean(owner),
  };
}

export function useTerminateLease(id: string): UseMutationResult<Lease, Error, TerminateLeaseData> {
  const queryClient = useQueryClient();
  return useMutation<Lease, Error, TerminateLeaseData>({
    mutationFn: (payload) => leaseService.terminateLease(id, payload),
    onSuccess: (lease) => {
      queryClient.setQueryData(leaseKeys.detail(id), lease);
      queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  });
}

export function useUploadLeaseDocument(
  id: string,
): UseMutationResult<LeaseDocument, Error, UploadLeaseDocumentInput> {
  const queryClient = useQueryClient();
  return useMutation<LeaseDocument, Error, UploadLeaseDocumentInput>({
    mutationFn: (input) => leaseService.uploadLeaseDocument(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leaseKeys.detail(id) });
    },
  });
}

export function useDeleteLease(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => leaseService.deleteLease(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: leaseKeys.detail(id), exact: true });
      queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  });
}
