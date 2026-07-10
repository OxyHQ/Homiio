import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { useProfile } from '@/context/ProfileContext';
import { CreateLeaseData, Lease, LeaseDocument, UpdateLeaseData } from '@homiio/shared-types';
import {
  LeaseFilters,
  LeaseListResponse,
  RenewLeaseData,
  TerminateLeaseData,
  UploadLeaseDocumentInput,
  leaseService,
} from '@/services/leaseService';
import { propertyService } from '@/services/propertyService';

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
export function useUserLeases(
  filters?: LeaseFilters,
): UseQueryResult<LeaseListResponse, Error> {
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
  const { primaryProfile } = useProfile();
  const profileId = primaryProfile?._id ?? primaryProfile?.id;
  const isAuthed = Boolean(oxyServices && activeSessionId);

  const query = useQuery({
    queryKey: ['owner-properties-count', profileId ?? ''],
    queryFn: async () => {
      if (!profileId) return 0;
      const result = await propertyService.getOwnerProperties(profileId);
      return result.total;
    },
    enabled: isAuthed && Boolean(profileId),
    staleTime: 1000 * 60 * 5,
  });

  return {
    hasRentalProperties: (query.data ?? 0) > 0,
    isLoading: query.isLoading,
  };
}

export function useCreateLease(): UseMutationResult<Lease, Error, CreateLeaseData> {
  const queryClient = useQueryClient();
  return useMutation<Lease, Error, CreateLeaseData>({
    mutationFn: (payload) => leaseService.createLease(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  });
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

export function useUpdateLease(
  id: string,
): UseMutationResult<Lease, Error, UpdateLeaseData> {
  const queryClient = useQueryClient();
  return useMutation<Lease, Error, UpdateLeaseData>({
    mutationFn: (payload) => leaseService.updateLease(id, payload),
    onSuccess: (lease) => {
      queryClient.setQueryData(leaseKeys.detail(id), lease);
      queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  });
}

export function useSignLease(
  id: string,
): UseMutationResult<Lease, Error, { signature: string; acceptTerms: boolean }> {
  const queryClient = useQueryClient();
  return useMutation<Lease, Error, { signature: string; acceptTerms: boolean }>({
    mutationFn: ({ signature, acceptTerms }) =>
      leaseService.signLease(id, signature, acceptTerms),
    onSuccess: (lease) => {
      queryClient.setQueryData(leaseKeys.detail(id), lease);
      queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  });
}

export function useTerminateLease(
  id: string,
): UseMutationResult<Lease, Error, TerminateLeaseData> {
  const queryClient = useQueryClient();
  return useMutation<Lease, Error, TerminateLeaseData>({
    mutationFn: (payload) => leaseService.terminateLease(id, payload),
    onSuccess: (lease) => {
      queryClient.setQueryData(leaseKeys.detail(id), lease);
      queryClient.invalidateQueries({ queryKey: [LEASE_LIST_KEY] });
    },
  });
}

export function useRenewLease(
  id: string,
): UseMutationResult<Lease, Error, RenewLeaseData> {
  const queryClient = useQueryClient();
  return useMutation<Lease, Error, RenewLeaseData>({
    mutationFn: (payload) => leaseService.renewLease(id, payload),
    onSuccess: () => {
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
