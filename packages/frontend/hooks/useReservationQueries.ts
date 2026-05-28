import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  CreateReservationData,
  Reservation,
  UpdateReservationData,
} from '@homiio/shared-types';
import {
  ListReservationsParams,
  PropertyAvailabilityResponse,
  ReservationListResponse,
  reservationService,
} from '@/services/reservationService';

const RESERVATION_LIST_KEY = 'reservations';
const RESERVATION_DETAIL_KEY = 'reservation';
const PROPERTY_AVAILABILITY_KEY = 'property-availability';

export const reservationKeys = {
  list: (params: ListReservationsParams) => [RESERVATION_LIST_KEY, params] as const,
  detail: (id: string) => [RESERVATION_DETAIL_KEY, id] as const,
  availability: (propertyId: string) =>
    [PROPERTY_AVAILABILITY_KEY, propertyId] as const,
};

/**
 * Listing query for reservations. Defaults to guest-side listings; pass
 * `asHost: true` for the host inbox.
 */
export function useReservationsQuery(
  params: ListReservationsParams = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<ReservationListResponse, Error> {
  return useQuery<ReservationListResponse, Error>({
    queryKey: reservationKeys.list(params),
    queryFn: () => reservationService.listReservations(params),
    enabled: options.enabled ?? true,
    staleTime: 1000 * 60,
  });
}

/**
 * Single reservation by id. Disabled until `id` is non-empty.
 */
export function useReservationQuery(
  id: string | undefined,
): UseQueryResult<Reservation, Error> {
  return useQuery<Reservation, Error>({
    queryKey: reservationKeys.detail(id ?? ''),
    queryFn: () => {
      if (!id) throw new Error('Reservation id is required');
      return reservationService.getReservationById(id);
    },
    enabled: Boolean(id),
    staleTime: 1000 * 30,
  });
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

export function useCreateReservation(): UseMutationResult<
  Reservation,
  Error,
  CreateReservationData
> {
  const queryClient = useQueryClient();
  return useMutation<Reservation, Error, CreateReservationData>({
    mutationFn: (payload) => reservationService.createReservation(payload),
    onSuccess: (reservation) => {
      queryClient.invalidateQueries({ queryKey: [RESERVATION_LIST_KEY] });
      queryClient.invalidateQueries({
        queryKey: reservationKeys.availability(reservation.propertyId),
      });
    },
  });
}

export function useUpdateReservation(
  id: string,
): UseMutationResult<Reservation, Error, UpdateReservationData> {
  const queryClient = useQueryClient();
  return useMutation<Reservation, Error, UpdateReservationData>({
    mutationFn: (payload) => reservationService.updateReservation(id, payload),
    onSuccess: (reservation) => {
      queryClient.setQueryData(reservationKeys.detail(id), reservation);
      queryClient.invalidateQueries({ queryKey: [RESERVATION_LIST_KEY] });
      queryClient.invalidateQueries({
        queryKey: reservationKeys.availability(reservation.propertyId),
      });
    },
  });
}
