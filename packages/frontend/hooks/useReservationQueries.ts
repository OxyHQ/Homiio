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
import {
  accountOwnerKey,
  useAccountOwner,
  useAccountOwnerGuard,
  withAccountOwner,
  type AccountOwner,
} from '@/hooks/useAccountOwner';
import type {
  CreateReservationData,
  Reservation,
  UpdateReservationData,
} from '@homiio/shared-types';
import {
  type ListReservationsParams,
  type PropertyAvailabilityResponse,
  type ReservationListResponse,
  reservationService,
} from '@/services/reservationService';

const RESERVATION_LIST_KEY = 'reservations';
const RESERVATION_DETAIL_KEY = 'reservation';
const PROPERTY_AVAILABILITY_KEY = 'property-availability';

export const reservationKeys = {
  list: (params: ListReservationsParams, owner: AccountOwner | null) =>
    [RESERVATION_LIST_KEY, ...accountOwnerKey(owner), params] as const,
  detail: (id: string, owner: AccountOwner | null) =>
    [RESERVATION_DETAIL_KEY, ...accountOwnerKey(owner), id] as const,
  availability: (propertyId: string) => [PROPERTY_AVAILABILITY_KEY, propertyId] as const,
};

/**
 * Listing query for reservations. Defaults to guest-side listings; pass
 * `asHost: true` for the host inbox.
 */
export function useReservationsQuery(
  params: ListReservationsParams = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<ReservationListResponse, Error> & { isOwnerReady: boolean } {
  const owner = useAccountOwner();
  const query = useQuery<ReservationListResponse, Error>({
    queryKey: reservationKeys.list(params, owner),
    queryFn: () =>
      withAccountOwner(owner, (current) => reservationService.listReservations(params, current)),
    enabled: Boolean(owner && (options.enabled ?? true)),
    staleTime: 1000 * 60,
  });
  return { ...query, isOwnerReady: Boolean(owner) };
}

/**
 * Single reservation by id. Disabled until `id` is non-empty.
 */
export function useReservationQuery(
  id: string | undefined,
): UseQueryResult<Reservation, Error> & { isOwnerReady: boolean } {
  const owner = useAccountOwner();
  const query = useQuery<Reservation, Error>({
    queryKey: reservationKeys.detail(id ?? '', owner),
    queryFn: () => {
      if (!id) throw new Error('Reservation id is required');
      return withAccountOwner(owner, (current) =>
        reservationService.getReservationById(id, current),
      );
    },
    enabled: Boolean(id && owner),
    staleTime: 1000 * 30,
  });
  return { ...query, isOwnerReady: Boolean(owner) };
}

/**
 * Calendar availability for a property (host-defined blocks + booked dates).
 * Disabled when no `propertyId` is supplied.
 */
export function usePropertyAvailabilityQuery(
  propertyId: string | undefined,
  options: { enabled?: boolean } = {},
): UseQueryResult<PropertyAvailabilityResponse, Error> {
  return useQuery<PropertyAvailabilityResponse, Error>({
    queryKey: reservationKeys.availability(propertyId ?? ''),
    queryFn: () => {
      if (!propertyId) throw new Error('Property id is required');
      return reservationService.getPropertyAvailability(propertyId);
    },
    enabled: Boolean(propertyId) && (options.enabled ?? true),
    staleTime: 1000 * 60,
  });
}

type OwnedVariables = { ownerKey: string };
type CapturedReservation = { owner: AccountOwner | null; id?: string; input: object };
const reservationOwners = new WeakMap<object, CapturedReservation>();

type OwnedResult<Input> = Omit<UseMutationResult<Reservation, Error, Input>, 'variables'> & {
  variables: Input | undefined;
  isOwnerReady: boolean;
};

function useOwnedReservationMutation<Input extends object>(id?: string): OwnedResult<Input> {
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
