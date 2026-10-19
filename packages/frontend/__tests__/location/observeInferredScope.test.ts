/**
 * The first inferred scope is committed where the answers land (#518 §3.3).
 *
 * `observeInferredScope` replaces an effect in `useLocationScope`: it watches
 * the QueryCache, the location store and the session, runs the same ladder the
 * hook renders from, and records the first device or network answer in force.
 * These cases drive it the way the app does — answers landing in the cache —
 * and read only the store, so they hold whatever the derivation looks like.
 */

import { QueryClient } from '@tanstack/react-query';
import type { ApproximateLocation, LocationSelection } from '@homiio/shared-types';

import { observeInferredScope } from '@/hooks/useLocationScope';
import { APPROXIMATE_LOCATION_QUERY_KEY } from '@/hooks/useApproximateLocation';
import { SAVED_SEARCHES_KEY } from '@/hooks/useSavedSearches';
import { useLocationScopeStore } from '@/store/locationScopeStore';

let mockAuthenticated = false;
const mockAuthListeners = new Set<() => void>();

// The session is the one source outside the cache and the store.
jest.mock('@oxy.so/services/ui/client', () => ({
  useAuthStore: {
    getState: () => ({ isAuthenticated: mockAuthenticated }),
    subscribe: (listener: () => void) => {
      mockAuthListeners.add(listener);
      return () => mockAuthListeners.delete(listener);
    },
  },
}));

/** The key the device-fix query uses when the user has not pressed the button. */
const FIX_KEY = ['locationScope', 'deviceFix', false] as const;

const BUCHAREST: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: 'city-bucharest' },
  placeType: 'city',
  label: { primary: 'Bucharest', kind: 'place' },
  admin: { countryCode: 'RO', cityName: 'Bucharest' },
  precision: 'centroid',
  center: { longitude: 26.1025, latitude: 44.4268 },
};

const MADRID: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: 'city-madrid' },
  placeType: 'city',
  label: { primary: 'Madrid', kind: 'place' },
  admin: { countryCode: 'ES', cityName: 'Madrid' },
  precision: 'centroid',
  center: { longitude: -3.7038, latitude: 40.4168 },
};

const NETWORK_ANSWER: ApproximateLocation = {
  status: 'resolved',
  source: 'ip',
  granularity: 'city',
  selection: BUCHAREST,
  admin: { countryCode: 'RO', cityName: 'Bucharest' },
  resolvedAt: '2026-09-19T10:00:00.000Z',
  expiresAt: '2026-09-19T10:30:00.000Z',
};

const NETWORK_UNAVAILABLE: ApproximateLocation = {
  status: 'unavailable',
  source: 'ip',
  reason: 'no_match',
  resolvedAt: '2026-09-19T10:00:00.000Z',
};

const FIX = { status: 'granted', longitude: 26.1, latitude: 44.43 } as const;

let client: QueryClient;
let unsubscribe: () => void;

beforeEach(() => {
  mockAuthenticated = false;
  useLocationScopeStore.setState({
    sessionSelection: null,
    explicitGlobal: false,
    lastChosenArea: null,
    deviceRequested: false,
    autoScope: null,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  unsubscribe = observeInferredScope(client);
});

afterEach(() => {
  unsubscribe();
  client.clear();
});

const autoScope = () => useLocationScopeStore.getState().autoScope;

describe('the first inference in force is recorded', () => {
  it('records the network answer when nothing outranks it', () => {
    client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, NETWORK_ANSWER);

    expect(autoScope()).toEqual({ source: 'ip', selection: BUCHAREST });
  });

  it('records a device fix as a device scope', () => {
    client.setQueryData(FIX_KEY, FIX);

    expect(autoScope()).toEqual({
      source: 'device',
      selection: {
        kind: 'current_location',
        center: { longitude: FIX.longitude, latitude: FIX.latitude },
        radiusMeters: 25_000,
        precision: 'exact',
      },
    });
  });

  it('keeps the first answer when a second one lands', () => {
    client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, NETWORK_ANSWER);
    client.setQueryData(FIX_KEY, FIX);

    expect(autoScope()).toEqual({ source: 'ip', selection: BUCHAREST });
  });

  it('records nothing when neither rung has an area', () => {
    client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, NETWORK_UNAVAILABLE);
    client.setQueryData(FIX_KEY, { status: 'denied' });

    expect(autoScope()).toBeNull();
  });
});

describe('nothing is recorded under a choice', () => {
  it.each([
    ['a session choice', { sessionSelection: MADRID }],
    ['the last chosen area', { lastChosenArea: MADRID }],
    ['"Explore everywhere"', { explicitGlobal: true }],
  ])('%s outranks the inference', (_name, choice) => {
    useLocationScopeStore.setState(choice);
    client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, NETWORK_ANSWER);

    expect(autoScope()).toBeNull();
  });

  it('a position the user ASKED for is not recorded', () => {
    useLocationScopeStore.setState({ deviceRequested: true });
    client.setQueryData(['locationScope', 'deviceFix', true], FIX);
    client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, NETWORK_ANSWER);

    expect(autoScope()).toBeNull();
  });
});

describe('the saved area is waited for', () => {
  /** Start the saved-searches request, answering only when told to. */
  function savedSearchesInFlight() {
    let settle: (searches: never[]) => void = () => {};
    const request = client.prefetchQuery({
      queryKey: SAVED_SEARCHES_KEY,
      queryFn: () => new Promise<never[]>((resolve) => (settle = resolve)),
    });
    return {
      answerEmpty: async () => {
        settle([]);
        await request;
      },
    };
  }

  it('records nothing while it loads, and the cached answer once it settles empty', async () => {
    mockAuthenticated = true;
    const saved = savedSearchesInFlight();

    client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, NETWORK_ANSWER);
    expect(autoScope()).toBeNull();

    await saved.answerEmpty();
    expect(autoScope()).toEqual({ source: 'ip', selection: BUCHAREST });
  });

  it('a sign-out ends the wait', async () => {
    mockAuthenticated = true;
    const saved = savedSearchesInFlight();
    client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, NETWORK_ANSWER);
    expect(autoScope()).toBeNull();

    mockAuthenticated = false;
    for (const listener of mockAuthListeners) listener();
    expect(autoScope()).toEqual({ source: 'ip', selection: BUCHAREST });

    await saved.answerEmpty();
  });
});

it('stops recording once unsubscribed', () => {
  unsubscribe();
  client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, NETWORK_ANSWER);

  expect(autoScope()).toBeNull();
});
