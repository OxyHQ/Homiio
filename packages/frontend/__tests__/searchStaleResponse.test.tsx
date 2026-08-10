/**
 * A slow answer to an old question can never overwrite the new one.
 *
 * #354 invariant 5, and the reason it needs its own file: the failure is a
 * RACE, and a test that hopes to reproduce a race proves nothing when it
 * passes. Every ordering here is forced — each request's promise is held open
 * and resolved by hand, in the order the test names — so "the older response
 * arrived second" is a fact of the test rather than something it waited for.
 *
 * Two mechanisms are checked, and they fail in different directions:
 *
 *  - **Keying.** Barcelona and Madrid are different searches with different
 *    ids, so the late Barcelona page lands in Barcelona's cache entry and is
 *    invisible to a surface showing Madrid. This is the one that holds in the
 *    ordinary case.
 *  - **The echo.** A page whose id is stamped by the SERVER as belonging to
 *    another query is refused outright. Keying cannot catch that one — the
 *    response arrives on the right key carrying the wrong answer, which is what
 *    a proxy, a shared cache or a mis-served request produces — and rendering
 *    it would put one search's rows under another's heading and count.
 */
import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { OfferingType, type LocationSelection } from '@homiio/shared-types';

import { api } from '@/utils/api';
import { searchQueryId, usePropertySearch } from '@/hooks/usePropertySearch';
import type { SearchQuery } from '@/components/search/types';

jest.mock('@/utils/api', () => ({
  api: { get: jest.fn() },
}));

const apiGet = api.get as jest.MockedFunction<typeof api.get>;

function baseQuery(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    offering: OfferingType.LONG_TERM_RENT,
    location: null,
    queryText: null,
    propertyTypes: [],
    amenities: [],
    sortBy: 'relevance',
    sortOrder: 'desc',
    ...overrides,
  };
}

const barcelona: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES' },
  center: { longitude: 2.1734, latitude: 41.3851 },
  precision: 'centroid',
};

const madridViewport: LocationSelection = {
  kind: 'map_bounds',
  bounds: { west: -3.75, south: 40.38, east: -3.65, north: 40.45 },
  center: { longitude: -3.7, latitude: 40.415 },
  label: { primary: 'search.summary.mapArea', kind: 'generated' },
  precision: 'area',
};

const BARCELONA_QUERY = baseQuery({ location: barcelona });
const MADRID_QUERY = baseQuery({ location: madridViewport });

/** A search response body, stamped with whichever identity the test wants. */
function page(id: string, propertyId: string, total: number): { data: unknown } {
  return {
    data: {
      success: true,
      data: [{ id: propertyId }],
      total,
      page: 1,
      limit: 24,
      totalPages: 1,
      hasMore: false,
      queryId: id,
      location: { status: 'resolved', appliedLocationKind: 'city' },
    },
  };
}

/** A promise plus the handle that settles it, so ordering is the test's to decide. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * ONE client per test, created outside the wrapper component.
 *
 * Constructing it inside the wrapper looks tidier and hangs the suite: the
 * wrapper is a component, so every render would build a new client, every
 * consumer would resubscribe to a new context value, and the render loop never
 * settles. There is no error and no failing assertion — jest simply never
 * finishes.
 */
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiGet.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
});

afterEach(() => {
  client.clear();
});

describe('two requests resolved in reverse order', () => {
  it('shows the newer search, and the late answer to the older one changes nothing', async () => {
    const barcelonaId = searchQueryId(BARCELONA_QUERY);
    const madridId = searchQueryId(MADRID_QUERY);
    // The premise of the whole test. If these ever collided, both responses
    // would land on one cache entry and the ordering below would decide the
    // result — which is the bug, not the test.
    expect(barcelonaId).not.toBe(madridId);

    const first = deferred<{ data: unknown }>();
    const second = deferred<{ data: unknown }>();
    apiGet.mockImplementationOnce(() => first.promise as never);
    apiGet.mockImplementationOnce(() => second.promise as never);

    const view = renderHook((query: SearchQuery) => usePropertySearch(query), {
      wrapper,
      initialProps: BARCELONA_QUERY,
    });

    // The user moves the map and confirms before Barcelona has answered.
    view.rerender(MADRID_QUERY);

    // Madrid answers first…
    second.resolve(page(madridId, 'madrid-listing', 7));
    await waitFor(() => expect(view.result.current.properties).toHaveLength(1));
    expect(view.result.current.properties[0].id).toBe('madrid-listing');
    expect(view.result.current.total).toBe(7);
    expect(view.result.current.queryId).toBe(madridId);

    // …and Barcelona answers afterwards. This is the moment the defect
    // produced: a list of Barcelona homes appearing under a map of Madrid,
    // with no error anywhere.
    first.resolve(page(barcelonaId, 'barcelona-listing', 812));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));

    expect(view.result.current.properties.map((p) => p.id)).toEqual(['madrid-listing']);
    expect(view.result.current.total).toBe(7);
    expect(view.result.current.queryId).toBe(madridId);
  });
});

describe('a response stamped with another query', () => {
  it('is refused rather than rendered', async () => {
    apiGet.mockResolvedValueOnce(
      page(searchQueryId(BARCELONA_QUERY), 'barcelona-listing', 812) as never,
    );

    const view = renderHook(() => usePropertySearch(MADRID_QUERY), { wrapper });

    await waitFor(() => expect(view.result.current.isError).toBe(true));
    // The rows are NOT shown. An implementation that logged the mismatch and
    // rendered anyway would satisfy "it noticed" and still put Barcelona's
    // listings under Madrid's heading.
    expect(view.result.current.properties).toEqual([]);
    expect(view.result.current.total).toBe(0);
    expect(view.result.current.error?.name).toBe('StaleSearchResponseError');
  });

  it('accepts a response that carries the matching identity', async () => {
    // The positive control for the case above. Without it, a hook that refused
    // EVERY response would pass that test and show nothing, ever.
    apiGet.mockResolvedValueOnce(
      page(searchQueryId(MADRID_QUERY), 'madrid-listing', 7) as never,
    );

    const view = renderHook(() => usePropertySearch(MADRID_QUERY), { wrapper });

    await waitFor(() => expect(view.result.current.properties).toHaveLength(1));
    expect(view.result.current.isError).toBe(false);
    expect(view.result.current.appliedLocation).toEqual({
      status: 'resolved',
      appliedLocationKind: 'city',
    });
  });

  it('accepts a server that stamps nothing at all', async () => {
    // An older deployment echoes no id. Treating silence as a mismatch would
    // black out the results surface for a shape that is merely older.
    apiGet.mockResolvedValueOnce({
      data: {
        success: true,
        data: [{ id: 'madrid-listing' }],
        total: 7,
        page: 1,
        limit: 24,
        totalPages: 1,
        hasMore: false,
      },
    } as never);

    const view = renderHook(() => usePropertySearch(MADRID_QUERY), { wrapper });

    await waitFor(() => expect(view.result.current.properties).toHaveLength(1));
    expect(view.result.current.isError).toBe(false);
    expect(view.result.current.appliedLocation).toBeNull();
  });
});

describe('the identity the request carries', () => {
  it('is sent to the server, so the answer can be stamped with it', async () => {
    apiGet.mockResolvedValueOnce(page(searchQueryId(MADRID_QUERY), 'madrid-listing', 7) as never);

    const view = renderHook(() => usePropertySearch(MADRID_QUERY), { wrapper });
    await waitFor(() => expect(view.result.current.properties).toHaveLength(1));

    expect(apiGet).toHaveBeenCalledWith(
      '/api/properties/search',
      expect.objectContaining({
        params: expect.objectContaining({ queryId: searchQueryId(MADRID_QUERY) }),
      }),
    );
  });
});
