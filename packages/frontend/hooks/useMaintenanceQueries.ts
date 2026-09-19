/**
 * Repair requests, as queries and mutations (#518 §7.1, #519 §7.1).
 *
 * ## Every write invalidates BOTH the list and the detail
 *
 * A transition changes the row AND the events under it, and the two are read by
 * different screens. Invalidating only the detail leaves the My home list
 * showing "Open" next to a repair somebody just confirmed fixed — the kind of
 * staleness that reads as the app having ignored a press.
 *
 * ## A conflict is not an error state
 *
 * `isTransitionConflict` separates "the request moved on since you looked" from
 * "something is broken". The first is answered by refetching and showing the
 * new state; the second is an error. A screen that rendered both the same way
 * would tell somebody to try again at a moment when trying again cannot work.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';
import type {
  MaintenanceAttachment,
  MaintenanceRequest,
  MaintenanceStatus,
} from '@homiio/shared-types';

import {
  maintenanceService,
  type CreateMaintenanceInput,
  type MaintenanceListFilters,
  type MaintenanceListResponse,
  type MaintenancePhotoUpload,
} from '@/services/maintenanceService';

const LIST_KEY = 'maintenanceRequests';
const DETAIL_KEY = 'maintenanceRequest';

export const maintenanceKeys = {
  list: (filters?: MaintenanceListFilters) => [LIST_KEY, filters ?? null] as const,
  detail: (id: string) => [DETAIL_KEY, id] as const,
};

/** The caller's repair requests. Filter by lease for one tenancy's list. */
export function useMaintenanceRequests(
  filters?: MaintenanceListFilters,
): UseQueryResult<MaintenanceListResponse, Error> {
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  return useQuery<MaintenanceListResponse, Error>({
    queryKey: maintenanceKeys.list(filters),
    queryFn: () => maintenanceService.list(filters),
    enabled: isAuthed,
    staleTime: 1000 * 30,
  });
}

/** One request, with its thread and history. */
export function useMaintenanceRequest(
  id: string | undefined,
): UseQueryResult<MaintenanceRequest, Error> {
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  return useQuery<MaintenanceRequest, Error>({
    queryKey: maintenanceKeys.detail(id ?? ''),
    queryFn: () => maintenanceService.get(id as string),
    enabled: isAuthed && Boolean(id),
    staleTime: 1000 * 15,
  });
}

/** Invalidate every maintenance read. One helper so no writer forgets half. */
function useInvalidateMaintenance(): (id?: string) => void {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
    if (id) void queryClient.invalidateQueries({ queryKey: maintenanceKeys.detail(id) });
  };
}

export function useReportRepair(): UseMutationResult<
  MaintenanceRequest,
  Error,
  CreateMaintenanceInput
> {
  const invalidate = useInvalidateMaintenance();
  return useMutation({
    mutationFn: (input: CreateMaintenanceInput) => maintenanceService.create(input),
    onSuccess: (request) => invalidate(request.id),
  });
}

export interface TransitionVariables {
  readonly id: string;
  readonly status: MaintenanceStatus;
  readonly scheduledFor?: string;
}

export function useTransitionRepair(): UseMutationResult<
  MaintenanceRequest,
  Error,
  TransitionVariables
> {
  const invalidate = useInvalidateMaintenance();
  return useMutation({
    mutationFn: (variables: TransitionVariables) =>
      maintenanceService.transition(variables.id, variables.status, variables.scheduledFor),
    onSuccess: (request) => invalidate(request.id),
    // A CONFLICT still refreshes: the whole point of a 409 here is that the
    // server knows something this screen does not, and refetching is how the
    // person finds out what.
    onError: (_error, variables) => invalidate(variables.id),
  });
}

export interface CommentVariables {
  readonly id: string;
  readonly body: string;
}

export function useCommentOnRepair(): UseMutationResult<void, Error, CommentVariables> {
  const invalidate = useInvalidateMaintenance();
  return useMutation({
    mutationFn: (variables: CommentVariables) =>
      maintenanceService.comment(variables.id, variables.body),
    onSuccess: (_result, variables) => invalidate(variables.id),
  });
}

export interface AttachVariables {
  readonly id: string;
  readonly photo: MaintenancePhotoUpload;
}

/**
 * Attach one photo and refetch the request.
 *
 * No optimistic entry. The server re-encodes the image, so the row it writes
 * carries a content type and a byte count this side cannot predict — an
 * optimistic attachment would show a size that changes when the real one
 * arrives, which reads as the upload having gone wrong.
 */
export function useAttachRepairPhoto(): UseMutationResult<
  MaintenanceAttachment,
  Error,
  AttachVariables
> {
  const invalidate = useInvalidateMaintenance();
  return useMutation({
    mutationFn: (variables: AttachVariables) =>
      maintenanceService.attach(variables.id, variables.photo),
    onSuccess: (_attachment, variables) => invalidate(variables.id),
  });
}
