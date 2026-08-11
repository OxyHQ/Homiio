/**
 * The featured-homes rail cannot issue an unscoped query (#353).
 *
 * ## Why it asserts on the REQUEST and not on the render
 *
 * The defect this file exists to keep out was invisible on screen: the widget
 * rendered four perfectly good property cards, correctly formatted, with a
 * working link on each — from anywhere on earth. Nothing about the output said
 * so, and no assertion about what it renders could have told the fixed version
 * from the broken one. The one place the two differ is the HTTP call, so that is
 * what is pinned here: `api.get` is mocked, and the tests read what reached it.
 *
 * ## Two halves, two different mutations
 *
 * Scoping this widget takes two things, and removing either reintroduces the
 * bug in a different shape, so both need their own assertion:
 *
 *  1. the scope must be IN the query (`location: scope.selection`) — remove it
 *     and a request goes out with no geographic parameter while the widget still
 *     looks scoped, heading and all;
 *  2. the query must be GATED on `scope.canQuery` — remove it and a request goes
 *     out before any area has been chosen, which is a global feed reached from
 *     a cold start.
 *
 * The mutation evidence for both is in the PR body.
 *
 * ## The positive control
 *
 * `it('sends the request when there IS a scope')` is not decoration. Every
 * "no request was made" assertion below is satisfied by a widget that never
 * fetches anything at all, so without a case proving a request DOES happen when
 * it should, this whole file passes against a component rendering an empty div.
 */
import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BloomThemeProvider } from '@oxyhq/bloom/theme';
import { act, render, waitFor } from '@testing-library/react-native';
import { OfferingType, type LocationSelection } from '@homiio/shared-types';

import { api } from '@/utils/api';
import { useLocationScope, type LocationScope } from '@/hooks/useLocationScope';
import {
  FeaturedPropertiesWidget,
  featuredSearchQuery,
  rankFeatured,
  scopeNotice,
  type FeaturedProperty,
} from '@/components/widgets/FeaturedPropertiesWidget';

jest.mock('@/utils/api', () => ({
  api: { get: jest.fn() },
}));

jest.mock('@/hooks/useLocationScope', () => ({
  useLocationScope: jest.fn(),
}));

// `expo-router` reaches `standard-navigation`, which ships ESM this suite's
// `transformIgnorePatterns` does not transform. Only `useRouter` is needed here,
// and navigation is not what this file measures.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// The offering axis is not what this file is about, and mounting the real
// provider drags AsyncStorage hydration into every case.
jest.mock('@/context/RentalModeContext', () => ({
  useRentalMode: () => ({ offering: 'long_term_rent', mode: 'long_term', isLoading: false }),
}));

// A card renders images, save mutations and a router link — none of which
// decides whether a request carried an area. Stubbed so a failure here is about
// the scope rather than about the card.
jest.mock('@/components/PropertyCard', () => ({
  PropertyCard: () => null,
}));

const apiGet = api.get as jest.MockedFunction<typeof api.get>;
const mockScope = useLocationScope as jest.MockedFunction<typeof useLocationScope>;

const BARCELONA: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: 'city-barcelona' },
  placeType: 'city',
  label: { primary: 'Barcelona', kind: 'place' },
  admin: { countryCode: 'ES', cityName: 'Barcelona' },
  precision: 'centroid',
  center: { longitude: 2.1686, latitude: 41.3874 },
};

const DEVICE: LocationSelection = {
  kind: 'current_location',
  center: { longitude: 2.1734035, latitude: 41.3850639 },
  radiusMeters: 25_000,
  precision: 'exact',
};

/** A scope in whichever state the case needs. Every field the widget reads. */
function scope(overrides: Partial<LocationScope>): LocationScope {
  return {
    selection: null,
    resolution: { status: 'idle' },
    source: null,
    deviceIssue: null,
    needsPlace: true,
    isGlobal: false,
    canQuery: false,
    nearbyPlace: null,
    choose: jest.fn(),
    exploreGlobal: jest.fn(),
    useCurrentLocation: jest.fn(),
    permissionPromptShown: false,
    ...overrides,
  };
}

/** One page of results, in the shape `usePropertySearch` reads. */
function page(): { data: unknown } {
  return {
    data: {
      success: true,
      data: [{ id: 'listing-1' }],
      total: 1,
      page: 1,
      limit: 24,
      totalPages: 1,
      hasMore: false,
    },
  };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  // Bloom typography throws outside its provider, so the widget cannot render
  // at all without it — the same ordering rule the app's own root obeys.
  return (
    <BloomThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </BloomThemeProvider>
  );
}

/** Every call this widget could have made to the search endpoint. */
function searchCalls(): Record<string, unknown>[] {
  return apiGet.mock.calls
    .filter(([url]) => url === '/api/properties/search')
    .map(([, config]) => {
      const params = (config as { params?: Record<string, unknown> } | undefined)?.params;
      return params ?? {};
    });
}

/**
 * Let every queued effect, promise and React Query notification run.
 *
 * "No request was made" is a claim about a moment, and a bare assertion straight
 * after `render` makes it about the earliest possible one — before an effect
 * that fires a request has had a turn. This gives the request every chance to
 * happen, so a passing assertion means it did not rather than not yet.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The geographic parameters the search endpoint understands. */
const GEO_PARAMS = ['city', 'state', 'neighborhood', 'lat', 'lng', 'radius', 'swLat', 'swLng', 'neLat', 'neLng'];

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue(page() as never);
  mockScope.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

afterEach(() => {
  client.clear();
});

describe('with no area chosen', () => {
  it('issues NO request at all', async () => {
    mockScope.mockReturnValue(scope({ resolution: { status: 'idle' }, needsPlace: true }));

    render(<FeaturedPropertiesWidget />, { wrapper });
    await flush();

    expect(searchCalls()).toEqual([]);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('says the area is missing rather than rendering an empty list', async () => {
    // "There are no featured homes" and "you have not told us where" are
    // different facts, and only one of them is true here.
    mockScope.mockReturnValue(scope({ resolution: { status: 'idle' }, needsPlace: true }));

    const view = render(<FeaturedPropertiesWidget />, { wrapper });
    await flush();

    expect(view.getByText('home.featured.chooseArea')).toBeTruthy();
    expect(view.queryByText('home.featured.empty')).toBeNull();
  });
});

describe('while the scope is still resolving', () => {
  it('issues NO request, and does not claim the area is unset', async () => {
    mockScope.mockReturnValue(scope({ resolution: { status: 'resolving' }, needsPlace: false }));

    const view = render(<FeaturedPropertiesWidget />, { wrapper });
    await flush();

    expect(searchCalls()).toEqual([]);
    expect(view.getByText('location.scope.resolving')).toBeTruthy();
  });
});

describe('when the device rung failed', () => {
  it('issues NO request, and names the reason', async () => {
    // The rung the old code fell through: a denied permission used to end at a
    // worldwide list. It ends at a sentence.
    mockScope.mockReturnValue(
      scope({
        resolution: { status: 'failed', reason: 'permission_denied' },
        deviceIssue: 'permission_denied',
        needsPlace: true,
      }),
    );

    const view = render(<FeaturedPropertiesWidget />, { wrapper });
    await flush();

    expect(searchCalls()).toEqual([]);
    expect(view.getByText('location.scope.failure.permission_denied')).toBeTruthy();
  });
});

describe('with a committed city', () => {
  it('sends the request, scoped to that city', async () => {
    // THE POSITIVE CONTROL for every "no request" case above, and the assertion
    // that fails if the selection stops reaching the query.
    mockScope.mockReturnValue(
      scope({
        selection: BARCELONA,
        resolution: { status: 'resolved', selection: BARCELONA },
        source: 'session',
        needsPlace: false,
        canQuery: true,
      }),
    );

    render(<FeaturedPropertiesWidget />, { wrapper });

    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(searchCalls()[0]).toMatchObject({ city: 'city-barcelona' });
    await flush();
  });

  it('names the area in its own heading', async () => {
    mockScope.mockReturnValue(
      scope({
        selection: BARCELONA,
        resolution: { status: 'resolved', selection: BARCELONA },
        needsPlace: false,
        canQuery: true,
      }),
    );

    const view = render(<FeaturedPropertiesWidget />, { wrapper });

    // A rail of listings that states no area is the defect wearing a fix.
    await waitFor(() => expect(view.getByText('home.featured.titleIn')).toBeTruthy());
    expect(view.queryByText('home.featured.title')).toBeNull();
    await flush();
  });
});

describe('with the device position', () => {
  it('sends the centre and radius, and no city', async () => {
    mockScope.mockReturnValue(
      scope({
        selection: DEVICE,
        resolution: { status: 'resolved', selection: DEVICE },
        source: 'device',
        needsPlace: false,
        canQuery: true,
      }),
    );

    render(<FeaturedPropertiesWidget />, { wrapper });

    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(searchCalls()[0]).toMatchObject({
      lat: 41.3850639,
      lng: 2.1734035,
      radius: 25_000,
    });
    await flush();
  });
});

describe('with an explicit "explore everywhere"', () => {
  it('is the ONLY state that sends a request carrying no area', async () => {
    // Distinguishing this from "no area chosen" is the point. Both have
    // `selection === null`; only this one is a decision somebody made, and only
    // `canQuery` tells them apart.
    mockScope.mockReturnValue(
      scope({
        selection: null,
        resolution: { status: 'idle' },
        source: 'global',
        needsPlace: false,
        isGlobal: true,
        canQuery: true,
      }),
    );

    render(<FeaturedPropertiesWidget />, { wrapper });

    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    for (const param of GEO_PARAMS) {
      expect(searchCalls()[0]).not.toHaveProperty(param);
    }
    await flush();
  });
});

describe('featuredSearchQuery', () => {
  it('carries the committed selection as the query location', () => {
    expect(featuredSearchQuery(BARCELONA, OfferingType.LONG_TERM_RENT).location).toBe(BARCELONA);
  });

  it('carries a null selection through unchanged, for the global case', () => {
    // The floor for the case above: a builder that always returned the selection
    // it was given would pass that one, and so would one that always returned
    // `BARCELONA`. This one only passes for a builder that passes it through.
    expect(featuredSearchQuery(null, OfferingType.LONG_TERM_RENT).location).toBeNull();
  });

  it('adds no free text of its own', () => {
    // `q` and a geographic scope are independent dimensions (ADR 0002). A widget
    // that sent the area's NAME as free text alongside the area would ask "homes
    // matching the word Barcelona, inside Barcelona", whose honest answer is
    // usually zero — and zero looks exactly like a quiet area.
    expect(featuredSearchQuery(BARCELONA, OfferingType.LONG_TERM_RENT).queryText).toBeNull();
  });

  it('carries the offering it was given', () => {
    expect(featuredSearchQuery(BARCELONA, OfferingType.SALE).offering).toBe(OfferingType.SALE);
  });
});

describe('rankFeatured', () => {
  /**
   * A listing carrying only the three fields the ranking reads.
   *
   * ONE cast, here, rather than one per fixture: a `Property` has dozens of
   * required fields and none of them reaches this function, so spelling them out
   * would bury the two that decide the order.
   */
  function listing(id: string, savesCount: number, fair = false): FeaturedProperty {
    return {
      id,
      savesCount,
      ...(fair ? { priceEthics: { isFairPrice: true } } : {}),
    } as unknown as FeaturedProperty;
  }

  it('puts a fairly-priced home ahead of a more-saved one', () => {
    const ranked = rankFeatured([listing('popular', 900), listing('fair', 1, true)]);
    expect(ranked.map((p) => p.id)).toEqual(['fair', 'popular']);
  });

  it('breaks a tie on saves', () => {
    const ranked = rankFeatured([listing('quiet', 2), listing('loved', 40)]);
    expect(ranked.map((p) => p.id)).toEqual(['loved', 'quiet']);
  });

  it('does not mutate its input', () => {
    const input = [listing('a', 1), listing('b', 9)];
    rankFeatured(input);
    expect(input.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('scopeNotice', () => {
  const t = ((key: string) => key) as never;

  it('names the failure reason rather than a generic sentence', () => {
    // "Location is off" and "we could not reach Homiio" call for different
    // actions; one message for both sends half of its readers to the wrong place.
    expect(scopeNotice({ status: 'failed', reason: 'network' }, t)).toBe(
      'location.scope.failure.network',
    );
    expect(scopeNotice({ status: 'failed', reason: 'permission_denied' }, t)).toBe(
      'location.scope.failure.permission_denied',
    );
  });

  it('asks for an area when nothing has been tried', () => {
    expect(scopeNotice({ status: 'idle' }, t)).toBe('home.featured.chooseArea');
  });

  it('says it is still resolving rather than asking for an area', () => {
    expect(scopeNotice({ status: 'resolving' }, t)).toBe('location.scope.resolving');
  });
});
