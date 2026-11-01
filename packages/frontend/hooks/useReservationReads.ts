import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  accountOwnerKey,
  useAccountOwner,
  withAccountOwner,
  type AccountOwner,
} from '@/hooks/useAccountOwner';
import type { Reservation } from '@homiio/shared-types';
import {
  type ListReservationsParams,
  type PropertyAvailabilityResponse,
  type ReservationListResponse,
  reservationService,
} from '@/services/reservationService';

export const RESERVATION_LIST_KEY = 'reservations';
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
