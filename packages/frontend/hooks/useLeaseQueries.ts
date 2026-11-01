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
type OwnedLeaseVariables<Input> = { input: Input; leaseId: string };
const leaseMutationOwners = new WeakMap<object, AccountOwner | null>();

type OwnedLeaseResult<Data, Input> = Omit<UseMutationResult<Data, Error, Input>, 'variables'> & {
  variables: Input | undefined;
  isOwnerReady: boolean;
};

function useOwnedLeaseMutation<Data, Input>(
  id: string,
  operation: (owner: AccountOwner, input: Input, leaseId: string) => Promise<Data>,
  onCommitted: (data: Data, input: Input, leaseId: string, stillCurrent: () => boolean) => void,
): OwnedLeaseResult<Data, Input> {
  const { owner, isCurrent } = useAccountOwnerGuard();
  const mutation = useMutation<Data, Error, OwnedLeaseVariables<Input>>({
    mutationFn: (variables) => {
      const captured = leaseMutationOwners.get(variables) ?? null;
      if (!isCurrent(captured)) throw new Error('The active account changed');
      return withAccountOwner(captured, (current) =>
        operation(current, variables.input, variables.leaseId),
      );
    },
    onSuccess: (data, variables) => {
      const stillCurrent = () => isCurrent(leaseMutationOwners.get(variables) ?? null);
      if (stillCurrent()) onCommitted(data, variables.input, variables.leaseId, stillCurrent);
    },
  });
  const capture = (input: Input): OwnedLeaseVariables<Input> => {
    const variables = { input, leaseId: id };
    leaseMutationOwners.set(variables, owner);
    return variables;
  };
  const callbacks = (options?: MutateOptions<Data, Error, Input>) =>
    options && {
      onSuccess: (
        data: Data,
        variables: OwnedLeaseVariables<Input>,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSuccess>>[3],
      ) => {
        if (isCurrent(leaseMutationOwners.get(variables) ?? null))
          options.onSuccess?.(data, variables.input, result, context);
      },
      onError: (
        error: Error,
        variables: OwnedLeaseVariables<Input>,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onError>>[3],
      ) => {
        if (isCurrent(leaseMutationOwners.get(variables) ?? null))
          options.onError?.(error, variables.input, result, context);
      },
      onSettled: (
        data: Data | undefined,
        error: Error | null,
        variables: OwnedLeaseVariables<Input>,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSettled>>[4],
      ) => {
        if (isCurrent(leaseMutationOwners.get(variables) ?? null))
          options.onSettled?.(data, error, variables.input, result, context);
      },
    };
  const mutate: UseMutateFunction<Data, Error, Input> = (input, options) => {
    mutation.mutate(capture(input), callbacks(options));
  };
  const mutateAsync: UseMutateAsyncFunction<Data, Error, Input> = async (input, options) => {
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
  const visible =
    !mutation.variables || isCurrent(leaseMutationOwners.get(mutation.variables) ?? null);
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

export function useSignLease(id: string): OwnedLeaseResult<Lease, SignLeaseInput> {
  const queryClient = useQueryClient();
  return useOwnedLeaseMutation(
    id,
    (owner, input: SignLeaseInput, leaseId) =>
      leaseService.signLease(leaseId, input.acceptTerms, input.termsSha256, owner),
    (lease, _input, leaseId, stillCurrent) => {
      queryClient.setQueryData(leaseKeys.detail(leaseId), lease);
      if (stillCurrent()) void queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  );
}

export function useTerminateLease(id: string): OwnedLeaseResult<Lease, TerminateLeaseData> {
  const queryClient = useQueryClient();
  return useOwnedLeaseMutation(
    id,
    (owner, input: TerminateLeaseData, leaseId) =>
      leaseService.terminateLease(leaseId, input, owner),
    (lease, _input, leaseId, stillCurrent) => {
      queryClient.setQueryData(leaseKeys.detail(leaseId), lease);
      if (stillCurrent()) void queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  );
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

export function useDeleteLease(): OwnedLeaseResult<void, string> {
  const queryClient = useQueryClient();
  return useOwnedLeaseMutation(
    '',
    (owner, leaseId: string) => leaseService.deleteLease(leaseId, owner),
    (_data, leaseId, _target, stillCurrent) => {
      queryClient.removeQueries({ queryKey: leaseKeys.detail(leaseId), exact: true });
      if (stillCurrent()) void queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  );
}
