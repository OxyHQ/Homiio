/**
 * The three booking lists a surface needs, fetched once and classified by
 * `utils/upcomingBookings.ts` (#518 §7.5, #519 §7.5).
 *
 * ## Why the result distinguishes four things and not two
 *
 * "Loading", "failed", "failed in part" and "genuinely nothing" look identical
 * to a component that only gets a list, and the default of collapsing them is
 * the silent-empty failure this codebase keeps having to fix: a person whose
 * fetch 500s is told they have no trips, which is a lie about their own diary
 * rather than a missing spinner. Three independent endpoints answer here, so
 * PARTIAL is a real state and not a nicety — a stay list that arrived beside a
 * viewing list that did not must show the stays AND say the rest is missing.
 *
 * Nothing subscribes to anything: there is no realtime socket in this app, and
 * these are ordinary react-query reads on the same keys the dedicated screens
 * use, so opening `/stays` or `/viewings` from here lands on a warm cache.
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useMyExchangeRequests } from '@/hooks/useExchangeQueries';
import { useReservationsQuery } from '@/hooks/useReservationQueries';
import { viewingService, type ViewingRequest } from '@/services/viewingService';
import {
  upcomingBookings,
  type OpenBookingStatus,
  type UpcomingBooking,
} from '@/utils/upcomingBookings';

/** One window of each list — enough for every surface that draws a few. */
const PAGE = 50;

/** The key `/viewings` reads, so both share one cache entry. */
export const MY_VIEWINGS_KEY = ['viewings', 'me'] as const;

export interface UseUpcomingBookingsOptions {
  /** Signed in and on screen. */
  readonly enabled: boolean;
  /** Which statuses count; see `utils/upcomingBookings.ts`. */
  readonly statuses?: readonly OpenBookingStatus[];
  /** Default `false` — only the tenancy surface asks for viewings. */
  readonly includeViewings?: boolean;
}

export interface UpcomingBookingsResult {
  readonly items: UpcomingBooking[];
  /** Nothing has settled yet. */
  readonly isPending: boolean;
  /** At least one list failed. NEVER render this as "no bookings". */
  readonly isError: boolean;
  /** Something failed and something answered: show the rows AND say so. */
  readonly isPartial: boolean;
  readonly error?: Error;
  readonly refetch: () => void;
}

export function useUpcomingBookings(
  options: UseUpcomingBookingsOptions,
): UpcomingBookingsResult {
  const { enabled, statuses, includeViewings = false } = options;

  const reservations = useReservationsQuery({ limit: PAGE }, { enabled });
  const exchanges = useMyExchangeRequests({ limit: PAGE }, { enabled });
  const viewings = useQuery<ViewingRequest[], Error>({
    queryKey: MY_VIEWINGS_KEY,
    queryFn: async () => {
      const response = await viewingService.listMyViewingRequests({ page: 1, limit: PAGE });
      return Array.isArray(response?.data) ? response.data : [];
    },
    enabled: enabled && includeViewings,
    staleTime: 1000 * 60,
  });

  const reservationItems = reservations.data?.items;
  const exchangeItems = exchanges.data?.items;
  const viewingItems = includeViewings ? viewings.data : undefined;

  // The freshest fetch is "now". Keeping the clock out of the render makes the
  // classification pure and the list stable until something actually refetches.
  const fetchedAt = Math.max(
    reservations.dataUpdatedAt,
    exchanges.dataUpdatedAt,
    includeViewings ? viewings.dataUpdatedAt : 0,
  );

  const items = useMemo(
    () =>
      upcomingBookings(
        { reservations: reservationItems, exchanges: exchangeItems, viewings: viewingItems },
        fetchedAt > 0 ? fetchedAt : Date.now(),
        { statuses },
      ),
    [reservationItems, exchangeItems, viewingItems, fetchedAt, statuses],
  );

  const refetch = useCallback(() => {
    void reservations.refetch();
    void exchanges.refetch();
    if (includeViewings) void viewings.refetch();
  }, [reservations, exchanges, viewings, includeViewings]);

  if (!enabled) {
    return { items: [], isPending: false, isError: false, isPartial: false, refetch };
  }

  // A disabled query reports `pending` forever, so an unwanted source is left
  // out of the roll-call rather than pinning the surface on a spinner.
  const active = includeViewings
    ? [reservations, exchanges, viewings]
    : [reservations, exchanges];

  const isError = active.some((query) => query.isError);
  return {
    items,
    isPending: !isError && active.some((query) => query.isPending),
    isError,
    isPartial: isError && active.some((query) => query.isSuccess),
    error: active.find((query) => query.isError)?.error ?? undefined,
    refetch,
  };
}
