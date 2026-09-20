/**
 * A failed fetch is not an empty diary.
 *
 * `useUpcomingBookings` reads THREE independent endpoints, and the way that
 * goes wrong is well known here: a list that failed comes back as `[]`, the
 * surface renders "nothing upcoming", and a person is told something false
 * about their own bookings on the strength of a 500. Every surface branches on
 * this hook's four flags, so the flags are what this pins — the rendering is
 * Bloom's and Jest cannot mount it in this repo anyway.
 *
 * `isPartial` is the one that only exists because there are three sources: the
 * stays arrived and the viewings did not, so the right answer is BOTH the rows
 * and the admission, never one or the other.
 */
import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { ReservationStatus } from '@homiio/shared-types';

import { api } from '@/utils/api';
import { useUpcomingBookings } from '@/hooks/useUpcomingBookings';

jest.mock('@/utils/api', () => ({
  api: { get: jest.fn() },
}));

const apiGet = api.get as jest.MockedFunction<typeof api.get>;

const DAY = 24 * 60 * 60 * 1000;
const soon = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const RESERVATIONS = '/api/reservations';
const EXCHANGES = '/api/exchanges';
const VIEWINGS = '/api/viewings/me';

const stay = {
  id: 'r1',
  propertyId: 'p1',
  checkIn: soon(3),
  checkOut: soon(6),
  status: ReservationStatus.CONFIRMED,
};

/** Route each endpoint to an answer, or to a rejection. */
function route(answers: Record<string, unknown | Error>) {
  apiGet.mockImplementation((url: string) => {
    const answer = answers[url];
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ data: answer } as never);
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const render = () =>
  renderHook(() => useUpcomingBookings({ enabled: true, includeViewings: true }), { wrapper });

beforeEach(() => {
  apiGet.mockReset();
});

describe('useUpcomingBookings — the four states are four different answers', () => {
  it('is pending before anything settles, and not empty', () => {
    // Nothing ever resolves: the hook must say "loading", not "nothing".
    apiGet.mockImplementation(() => new Promise(() => {}) as never);
    const { result } = render();
    expect(result.current.isPending).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('is empty only when every list answered and every list was empty', async () => {
    route({ [RESERVATIONS]: { data: [] }, [EXCHANGES]: { data: [] }, [VIEWINGS]: { data: [] } });
    const { result } = render();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.isPartial).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('reports a total failure as an ERROR, never as no bookings', async () => {
    const boom = new Error('reservations exploded');
    route({ [RESERVATIONS]: boom, [EXCHANGES]: boom, [VIEWINGS]: boom });
    const { result } = render();
    await waitFor(() => expect(result.current.isError).toBe(true));
    // The trap: `items` is legitimately empty here. A surface reading only the
    // list would draw the same thing as the test above.
    expect(result.current.items).toEqual([]);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isPartial).toBe(false);
    expect(result.current.error?.message).toBe('reservations exploded');
  });

  it('reports a PARTIAL failure as both the rows and the admission', async () => {
    route({
      [RESERVATIONS]: { data: [stay] },
      [EXCHANGES]: { data: [] },
      [VIEWINGS]: new Error('viewings exploded'),
    });
    const { result } = render();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPartial).toBe(true);
    // The stay that DID arrive is still shown: hiding it would be a second lie
    // told to avoid the first.
    expect(result.current.items.map((booking) => booking.id)).toEqual(['r1']);
  });

  it('asks for no viewings when the surface did not want them', async () => {
    route({ [RESERVATIONS]: { data: [stay] }, [EXCHANGES]: { data: [] } });
    const { result } = renderHook(() => useUpcomingBookings({ enabled: true }), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(apiGet.mock.calls.map(([url]) => url)).not.toContain(VIEWINGS);
    // And a disabled source does not pin the surface on a spinner forever.
    expect(result.current.isPending).toBe(false);
    expect(result.current.items).toHaveLength(1);
  });

  it('fetches nothing at all while signed out', () => {
    route({});
    const { result } = renderHook(
      () => useUpcomingBookings({ enabled: false, includeViewings: true }),
      { wrapper },
    );
    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      items: [],
      isPending: false,
      isError: false,
      isPartial: false,
    });
  });
});
