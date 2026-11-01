import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  accountOwnerKey,
  useAccountOwnerGuard,
  withAccountOwner,
  type AccountOwner,
} from '@/hooks/useAccountOwner';
import type {
  CreateReservationData,
  Reservation,
  UpdateReservationData,
} from '@homiio/shared-types';
import { reservationService } from '@/services/reservationService';
import { RESERVATION_LIST_KEY, reservationKeys } from './useReservationReads';

export type OwnedVariables = { ownerKey: string };
type CapturedReservation = { owner: AccountOwner | null; id?: string; input: object };
export const reservationOwners = new WeakMap<object, CapturedReservation>();

export function useOwnedReservationCore<Input extends object>(id?: string) {
  const queryClient = useQueryClient();
  const { owner, isCurrent } = useAccountOwnerGuard();
  const [, , epoch, instance, generation] = accountOwnerKey(owner);
  const ownerKey = JSON.stringify([epoch, instance, generation]);
  const mutation = useMutation<Reservation, Error, OwnedVariables>({
    mutationFn: (variables) => {
      const captured = reservationOwners.get(variables);
      if (!captured || !isCurrent(captured.owner)) throw new Error('The active account changed');
      return withAccountOwner(captured.owner, (current) =>
        captured.id === undefined
          ? reservationService.createReservation(captured.input as CreateReservationData, current)
          : reservationService.updateReservation(
              captured.id,
              captured.input as UpdateReservationData,
              current,
            ),
      );
    },
    onSuccess: (reservation, variables) => {
      const captured = reservationOwners.get(variables);
      if (!captured || !isCurrent(captured.owner)) return;
      if (captured.id !== undefined)
        queryClient.setQueryData(reservationKeys.detail(captured.id, captured.owner), reservation);
      if (!isCurrent(captured.owner)) return;
      void queryClient.invalidateQueries({ queryKey: [RESERVATION_LIST_KEY] });
      void queryClient.invalidateQueries({
        queryKey: reservationKeys.availability(reservation.propertyId),
      });
    },
  });
  const capture = (input: Input) => {
    const variables = { ownerKey };
    reservationOwners.set(variables, { owner, id, input });
    return variables;
  };
  return { mutation, capture, owner, ownerKey, isCurrent };
}
