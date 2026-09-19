/**
 * The rent ledger, as queries and mutations (#518 §7.2, #519 §7.2).
 *
 * Every write invalidates the ledger AND the lease, because the lease's own DTO
 * carries the obligations a balance is computed against — leaving one stale
 * would show a confirmed payment beside an unchanged "outstanding".
 *
 * There is deliberately no optimistic update. A declaration does not change the
 * balance, and a confirmation does — so an optimistic version would have to
 * reimplement `leaseObligationSettlement` at the call site, which is exactly
 * the second definition of "paid" this whole design exists to avoid. A refetch
 * is one round trip and it is always right.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';
import type { LeasePaymentMovement } from '@homiio/shared-types';

import { leaseKeys } from '@/hooks/useLeaseQueries';
import { leaseLedgerService, type LeaseLedger } from '@/services/leaseLedgerService';

const LEDGER_KEY = 'leaseLedger';

export const leaseLedgerKeys = {
  detail: (leaseId: string) => [LEDGER_KEY, leaseId] as const,
};

export function useLeaseLedger(leaseId: string | undefined): UseQueryResult<LeaseLedger, Error> {
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  return useQuery<LeaseLedger, Error>({
    queryKey: leaseLedgerKeys.detail(leaseId ?? ''),
    queryFn: () => leaseLedgerService.get(leaseId as string),
    enabled: isAuthed && Boolean(leaseId),
    staleTime: 1000 * 15,
  });
}

function useInvalidateLedger(leaseId: string): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: leaseLedgerKeys.detail(leaseId) });
    void queryClient.invalidateQueries({ queryKey: leaseKeys.detail(leaseId) });
    // The LIST too: My home reads the lease from it, and a balance that changed
    // on one screen and not the other is the staleness that reads as the app
    // having ignored a press.
    void queryClient.invalidateQueries({ queryKey: ['leases'] });
  };
}

export interface DeclareVariables {
  readonly obligationId: string;
  readonly amount?: number;
  readonly note?: string;
}

export function useDeclarePayment(
  leaseId: string,
): UseMutationResult<LeasePaymentMovement, Error, DeclareVariables> {
  const invalidate = useInvalidateLedger(leaseId);
  return useMutation({
    mutationFn: (variables: DeclareVariables) =>
      leaseLedgerService.declare({ leaseId, ...variables }),
    onSuccess: invalidate,
  });
}

export function useConfirmPayment(
  leaseId: string,
): UseMutationResult<LeasePaymentMovement, Error, { movementId: string }> {
  const invalidate = useInvalidateLedger(leaseId);
  return useMutation({
    mutationFn: ({ movementId }: { movementId: string }) =>
      leaseLedgerService.confirm(leaseId, movementId),
    onSuccess: invalidate,
    // A 409 means the movement moved on. Refetching is how the person finds
    // out what it moved to.
    onError: invalidate,
  });
}

export function useRejectPayment(
  leaseId: string,
): UseMutationResult<LeasePaymentMovement, Error, { movementId: string; reason: string }> {
  const invalidate = useInvalidateLedger(leaseId);
  return useMutation({
    mutationFn: ({ movementId, reason }: { movementId: string; reason: string }) =>
      leaseLedgerService.reject(leaseId, movementId, reason),
    onSuccess: invalidate,
    onError: invalidate,
  });
}
