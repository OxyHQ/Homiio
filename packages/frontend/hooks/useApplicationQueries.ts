/**
 * Tenant application React Query hooks. Drives both the applicant flow
 * (submit, view own applications) and the landlord inbox.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  TenantApplication,
  TenantApplicationStatus,
  type DocumentVerificationStatus,
} from '@homiio/shared-types';

import {
  CreateApplicationInput,
  UpdateApplicationInput,
  applicationService,
} from '@/services/applicationService';
import { useOxy } from '@oxy.so/services';

const STALE_TIME = 1000 * 30;
const GC_TIME = 1000 * 60 * 10;

type ListVariant = 'applicant' | 'landlord';

export const applicationQueryKeys = {
  all: ['applications'] as const,
  list: (variant: ListVariant, status?: TenantApplicationStatus) =>
    [...applicationQueryKeys.all, variant, status ?? 'any'] as const,
  detail: (id: string) => [...applicationQueryKeys.all, 'detail', id] as const,
  propertyActive: (propertyId: string) =>
    [...applicationQueryKeys.all, 'property-active', propertyId] as const,
};

export function useMyApplications(status?: TenantApplicationStatus) {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: applicationQueryKeys.list('applicant', status),
    queryFn: async () =>
      applicationService.list({ asLandlord: false, status, limit: 50 }),
    enabled: isAuthenticated,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

export function useLandlordApplications(status?: TenantApplicationStatus) {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: applicationQueryKeys.list('landlord', status),
    queryFn: async () =>
      applicationService.list({ asLandlord: true, status, limit: 50 }),
    enabled: isAuthenticated,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

export function useApplicationById(id: string | undefined) {
  return useQuery({
    queryKey: applicationQueryKeys.detail(id ?? ''),
    queryFn: async () => applicationService.getById(id ?? ''),
    enabled: Boolean(id),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

/**
 * Looks up whether the current user already has an active (`submitted` or
 * `reviewing`) application for the given property. Drives the "Application
 * submitted" state on the property detail screen so the apply CTA is only
 * shown when actionable.
 */
export function useActiveApplicationForProperty(propertyId: string | undefined) {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: applicationQueryKeys.propertyActive(propertyId ?? ''),
    queryFn: async (): Promise<TenantApplication | null> => {
      if (!propertyId) return null;
      const response = await applicationService.list({
        asLandlord: false,
        limit: 50,
      });
      const active = response.data.find(
        (application) =>
          String(application.propertyId) === String(propertyId) &&
          (application.status === TenantApplicationStatus.SUBMITTED ||
            application.status === TenantApplicationStatus.REVIEWING),
      );
      return active ?? null;
    },
    enabled: Boolean(propertyId) && isAuthenticated,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

export function useCreateApplicationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateApplicationInput) =>
      applicationService.create(input),
    onSuccess: (application) => {
      queryClient.invalidateQueries({ queryKey: applicationQueryKeys.all });
      queryClient.setQueryData(
        applicationQueryKeys.detail(String(application.id)),
        application,
      );
    },
  });
}

export function useUpdateApplicationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: UpdateApplicationInput;
    }) => applicationService.update(id, input),
    onSuccess: (application) => {
      queryClient.invalidateQueries({ queryKey: applicationQueryKeys.all });
      queryClient.setQueryData(
        applicationQueryKeys.detail(String(application.id)),
        application,
      );
    },
  });
}

export interface VerifyDocumentVariables {
  readonly documentId: string;
  readonly status: DocumentVerificationStatus;
  readonly reason?: string;
}

/**
 * The landlord's judgement of one document (#518 §7.4).
 *
 * No optimistic update, deliberately. §7.4's rule is that pressing a button
 * does not verify a document — so the tick must arrive from the server or not
 * at all, and an optimistic one would be exactly the local state the rule
 * forbids, right up until the request failed.
 */
export function useVerifyApplicationDocument(
  applicationId: string,
): UseMutationResult<TenantApplication, Error, VerifyDocumentVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: VerifyDocumentVariables) =>
      applicationService.verifyDocument(applicationId, variables),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['application', applicationId] });
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });
}
