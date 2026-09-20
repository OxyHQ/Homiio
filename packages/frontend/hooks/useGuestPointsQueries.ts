/**
 * The guest-points ledger, as a query (#518 §7.5, #519 §7.5).
 *
 * One query and no mutation, because there is no write endpoint — points move
 * through the exchange lifecycle and nowhere else. What this module owns
 * instead is the INVALIDATION: {@link useInvalidateGuestPoints} is what the
 * exchange mutations call, so a balance can never be left showing points that
 * a request the person just made has already reserved.
 *
 * There is deliberately no optimistic update. A reservation's effect on the
 * available balance depends on the whole ledger, so an optimistic version would
 * have to reimplement `guestPointStanding` at the call site — the second
 * definition of "available" the derived balance exists to avoid. A refetch is
 * one round trip and it is always right.
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';

import { guestPointsService, type GuestPointsLedger } from '@/services/guestPointsService';

const GUEST_POINTS_KEY = 'guest-points';

export const guestPointsKeys = {
  mine: () => [GUEST_POINTS_KEY, 'mine'] as const,
};

/** My balance and the movements behind it. Disabled until there is a session. */
export function useGuestPoints(): UseQueryResult<GuestPointsLedger, Error> {
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  return useQuery<GuestPointsLedger, Error>({
    queryKey: guestPointsKeys.mine(),
    queryFn: () => guestPointsService.get(),
    enabled: isAuthed,
    staleTime: 1000 * 15,
  });
}

/**
 * Refetch the ledger.
 *
 * Called by every exchange mutation that can move a point — which is all of
 * them, because whether a given request is a points stay is the server's answer
 * and not something a caller should have to check before deciding to
 * invalidate. Invalidating a query nobody is rendering costs nothing; leaving a
 * stale balance on screen reads as the app having ignored a press.
 */
export function useInvalidateGuestPoints(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: guestPointsKeys.mine() });
  }, [queryClient]);
}
