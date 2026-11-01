import type {
  CreateReservationData,
  Reservation,
  UpdateReservationData,
} from '@homiio/shared-types';
import { useOwnedReservationCore } from './useOwnedReservationCore';

/** Internal commands used by Homiio screens; the full mutation API remains available separately. */
function useReservationCommand<Input extends object>(id?: string) {
  const { mutation, capture, owner, ownerKey, isCurrent } = useOwnedReservationCore<Input>(id);
  const mutateAsync = async (input: Input): Promise<Reservation> => {
    const variables = capture(input);
    if (!isCurrent(owner)) throw new Error('The active account changed');
    try {
      const result = await mutation.mutateAsync(variables);
      if (!isCurrent(owner)) throw new Error('The active account changed');
      return result;
    } catch (error) {
      if (!isCurrent(owner)) throw new Error('The active account changed');
      throw error;
    }
  };
  const visible = !mutation.variables || Boolean(owner && mutation.variables.ownerKey === ownerKey);
  return { mutateAsync, isPending: visible && mutation.isPending, isOwnerReady: Boolean(owner) };
}
export function useCreateReservationCommand() {
  return useReservationCommand<CreateReservationData>();
}
export function useUpdateReservationCommand(id: string) {
  return useReservationCommand<UpdateReservationData>(id);
}
