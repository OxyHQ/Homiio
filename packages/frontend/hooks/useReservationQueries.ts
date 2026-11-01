import {
  type UseMutationResult,
  type MutateOptions,
  type UseMutateFunction,
  type UseMutateAsyncFunction,
} from '@tanstack/react-query';
import type {
  CreateReservationData,
  Reservation,
  UpdateReservationData,
} from '@homiio/shared-types';
import {
  reservationOwners,
  useOwnedReservationCore,
  type OwnedVariables,
} from './useOwnedReservationCore';
export {
  reservationKeys,
  useReservationsQuery,
  useReservationQuery,
  usePropertyAvailabilityQuery,
} from './useReservationReads';

type OwnedResult<Input> = Omit<UseMutationResult<Reservation, Error, Input>, 'variables'> & {
  variables: Input | undefined;
  isOwnerReady: boolean;
};

function useOwnedReservationMutation<Input extends object>(id?: string): OwnedResult<Input> {
  const { mutation, capture, owner, ownerKey, isCurrent } = useOwnedReservationCore<Input>(id);
  const callbacks = (options?: MutateOptions<Reservation, Error, Input>) =>
    options && {
      onSuccess: (
        data: Reservation,
        variables: OwnedVariables,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSuccess>>[3],
      ) => {
        const captured = reservationOwners.get(variables);
        if (captured && isCurrent(captured.owner))
          options.onSuccess?.(data, captured.input as Input, result, context);
      },
      onError: (
        error: Error,
        variables: OwnedVariables,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onError>>[3],
      ) => {
        const captured = reservationOwners.get(variables);
        if (captured && isCurrent(captured.owner))
          options.onError?.(error, captured.input as Input, result, context);
      },
      onSettled: (
        data: Reservation | undefined,
        error: Error | null,
        variables: OwnedVariables,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSettled>>[4],
      ) => {
        const captured = reservationOwners.get(variables);
        if (captured && isCurrent(captured.owner))
          options.onSettled?.(data, error, captured.input as Input, result, context);
      },
    };
  const mutate: UseMutateFunction<Reservation, Error, Input> = (...args) => {
    mutation.mutate(capture(args[0] as Input), callbacks(args[1]));
  };
  const mutateAsync: UseMutateAsyncFunction<Reservation, Error, Input> = async (...args) => {
    const variables = capture(args[0] as Input);
    const options = args[1];
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
  const visible = !mutation.variables || Boolean(owner && mutation.variables.ownerKey === ownerKey);
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
    variables:
      visible && mutation.variables
        ? (reservationOwners.get(mutation.variables)?.input as Input | undefined)
        : undefined,
    mutate,
    mutateAsync,
    isOwnerReady: Boolean(owner),
  };
}

export function useCreateReservation(): OwnedResult<CreateReservationData> {
  return useOwnedReservationMutation<CreateReservationData>();
}

export function useUpdateReservation(id: string): OwnedResult<UpdateReservationData> {
  return useOwnedReservationMutation<UpdateReservationData>(id);
}
