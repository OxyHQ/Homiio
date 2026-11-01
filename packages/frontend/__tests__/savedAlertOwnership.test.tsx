/** @jest-environment ./test/http-environment.cjs */
import type { ReactNode } from 'react';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import {
  dehydrate,
  hydrate,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';

let mockOrigin = '';
const mockAuth = {
  isAuthenticated: true,
  user: { id: 'A' },
  activeSessionId: 'session-A',
  oxyServices: null as unknown as OxyServices,
};
jest.mock('@/config', () => ({ API_URL: mockOrigin }));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => mockAuth,
  useAuthStore: { getState: () => mockAuth, subscribe: () => () => {} },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('@oxy.so/bloom/toast', () => ({ toast: mockToast }));

const token = (id: string) =>
  `h.${Buffer.from(JSON.stringify({ userId: id, sessionId: `session-${id}`, exp: 4102444800 })).toString('base64url')}.s`;
const location = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: 'city-A' },
  placeType: 'city',
  label: { primary: 'A private area', kind: 'place' },
  center: { longitude: 2, latitude: 41 },
  precision: 'centroid',
};
let server: Server;
let oxy: OxyServices;
let client: QueryClient;
let seen: Array<{ method: string; owner: string; path: string }>;
let holdB: ServerResponse | undefined;
let shouldHoldB = false;
let allowPutA = false;
let useSavedSearches: typeof import('../hooks/useSavedSearches').useSavedSearches;
let usePrimarySavedArea: typeof import('../hooks/useSavedSearches').usePrimarySavedArea;
let savedSearchesReading: typeof import('../hooks/useSavedSearches').savedSearchesReading;
let bind: typeof import('../utils/api').bindApiToOxy;

beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer((req, res) => {
    const owner = req.headers.authorization === `Bearer ${token('A')}` ? 'A' : 'B';
    seen.push({ method: req.method ?? '', owner, path: req.url ?? '' });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && owner === 'B' && shouldHoldB) {
      holdB = res;
      return;
    }
    if (req.method === 'POST') {
      res.end(JSON.stringify({ data: { id: 'new-A', name: 'new A', query: 'apartments' } }));
      return;
    }
    if (req.method === 'PUT' && owner === 'A' && allowPutA) {
      res.end(JSON.stringify({ data: { id: 'watch-A', name: 'Updated A', query: 'A' } }));
      return;
    }
    if (req.method === 'PUT') {
      res.writeHead(404);
      res.end(JSON.stringify({ message: 'Not found' }));
      return;
    }
    res.end(
      JSON.stringify({
        data:
          owner === 'A'
            ? [
                {
                  id: 'watch-A',
                  name: 'A private watch',
                  query: 'A',
                  location,
                  locationStatus: 'resolved',
                  isPrimaryArea: true,
                },
              ]
            : [],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ useSavedSearches, usePrimarySavedArea, savedSearchesReading } = jest.requireActual(
    '../hooks/useSavedSearches',
  ));
  ({ bindApiToOxy: bind } = jest.requireActual('../utils/api'));
});
beforeEach(() => {
  seen = [];
  shouldHoldB = false;
  allowPutA = false;
  mockToast.success.mockClear();
  mockToast.error.mockClear();
  holdB = undefined;
  oxy = new OxyServices({ baseURL: mockOrigin });
  oxy.session.setAccessToken(token('A'));
  Object.assign(mockAuth, {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: oxy,
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  bind(oxy);
});
afterEach(() => {
  cleanup();
  client.clear();
  oxy.dispose();
  onlineManager.setOnline(true);
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function switchToB(rerender: () => void) {
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    rerender();
  });
}

it('does not expose A watch or primary area after projection B', async () => {
  const view = renderHook(() => ({ saved: useSavedSearches(), primary: usePrimarySavedArea() }), {
    wrapper,
  });
  await waitFor(() => expect(view.result.current.saved.searches[0]?.id).toBe('watch-A'));
  expect(view.result.current.primary.selection).toEqual(location);
  expect(savedSearchesReading(client, 'A').data?.[0]?.id).toBe('watch-A');
  const retainedLookup = view.result.current.saved.getSearchById;
  act(() => {
    oxy.session.setAccessToken(token('B'));
    expect(savedSearchesReading(client, 'A').data).toBeUndefined();
    expect(retainedLookup('watch-A')).toBeUndefined();
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.saved.searches).toEqual([]));
  expect(view.result.current.primary.selection).toBeNull();
  await waitFor(() =>
    expect(seen).toContainEqual({
      method: 'GET',
      owner: 'B',
      path: '/api/profiles/me/saved-searches',
    }),
  );
});

it('does not send a retained A watch callback after projection changes', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  const update = view.result.current.updateAlertSettings;
  switchToB(() => view.rerender(undefined));
  await act(async () => {
    await update('watch-A', { cadence: 'off' });
  });
  expect(seen.filter((request) => request.method === 'PUT')).toEqual([]);
});

it.each([false, true])(
  'SDK account persistence transition does not expose A, memory-only=%s',
  async (memoryOnly) => {
    const packageRoot = dirname(require.resolve('@oxy.so/services/package.json'));
    const { createAccountQueryPersistence } = jest.requireActual(
      join(packageRoot, 'lib/commonjs/ui/hooks/accountQueryPersistence.js'),
    );
    const persister = createAccountQueryPersistence(
      client,
      memoryOnly ? { memoryOnlyRoots: ['savedSearches'] } : undefined,
    );
    const writes: string[] = [];
    persister.setStorage({
      getItem: async () => null,
      setItem: async (_key: string, value: string) => {
        writes.push(value);
      },
      removeItem: async () => {},
    });
    persister.attach();
    persister.activate('A');
    await persister.whenReady();
    const view = renderHook(() => ({ saved: useSavedSearches(), primary: usePrimarySavedArea() }), {
      wrapper,
    });
    await waitFor(() => expect(view.result.current.saved.searches[0]?.id).toBe('watch-A'));
    shouldHoldB = true;
    let invalidating!: Promise<void>;
    act(() => {
      oxy.session.setAccessToken(token('B'));
      persister.activate('B');
      invalidating = client.invalidateQueries();
      mockAuth.user = { id: 'B' };
      mockAuth.activeSessionId = 'session-B';
      view.rerender(undefined);
    });
    await waitFor(() => expect(holdB).toBeDefined());
    expect(view.result.current.saved.searches).toEqual([]);
    expect(view.result.current.primary.selection).toBeNull();
    await act(async () => {
      holdB?.end(JSON.stringify({ data: [] }));
      await invalidating;
    });
    await waitFor(() => expect(view.result.current.saved.searches).toEqual([]));
    await persister.whenReady();
    if (memoryOnly) {
      expect(writes.length).toBeGreaterThan(0);
      expect(writes.join(' ')).not.toContain('watch-A');
      expect(writes.join(' ')).not.toContain(token('A'));
    }
    view.unmount();
    persister.detach();
  },
);

it('rejects a retained A alert after an A to B to A transition', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  const update = view.result.current.updateAlertSettings;
  switchToB(() => view.rerender(undefined));
  act(() => {
    oxy.session.setAccessToken(token('A'));
    mockAuth.user = { id: 'A' };
    mockAuth.activeSessionId = 'session-A';
    view.rerender(undefined);
  });
  await act(async () => {
    expect(await update('watch-A', { cadence: 'off' })).toBe(false);
  });
  expect(seen.filter((request) => request.method === 'PUT')).toEqual([]);
});

it('does not resume an A save with the B bearer or show it as B pending', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  onlineManager.setOnline(false);
  let pending!: Promise<boolean>;
  act(() => {
    pending = view.result.current.saveSearch('new A', 'apartments');
  });
  await waitFor(() => expect(view.result.current.isSaving).toBe(true));
  switchToB(() => view.rerender(undefined));
  expect(view.result.current.isSaving).toBe(false);
  await act(async () => {
    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    expect(await pending).toBe(false);
  });
  expect(seen.filter((request) => request.method === 'POST')).toEqual([]);
});

it('does not treat an opaque bearer as an empty verified saved-search list', async () => {
  const view = renderHook(() => ({ saved: useSavedSearches(), primary: usePrimarySavedArea() }), {
    wrapper,
  });
  await waitFor(() => expect(view.result.current.saved.searches[0]?.id).toBe('watch-A'));
  act(() => {
    oxy.session.setAccessToken('opaque-bearer');
    view.rerender(undefined);
  });
  expect(view.result.current.saved.searches).toEqual([]);
  expect(view.result.current.saved.error).toBe('search.widgets.savedSearches.loadFailed');
  expect(view.result.current.saved.isLoading).toBe(false);
  expect(view.result.current.primary).toEqual({ selection: null, pending: false });
});

it('does not toast or report success when a cache subscriber switches the owner during publication', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  allowPutA = true;
  let switched = false;
  const off = client.getQueryCache().subscribe((event) => {
    if (
      !switched &&
      event.type === 'updated' &&
      event.action.type === 'success' &&
      Array.isArray(event.query.state.data) &&
      event.query.state.data.some((v) => v?.name === 'Updated A')
    ) {
      switched = true;
      oxy.session.setAccessToken(token('B'));
      mockAuth.user = { id: 'B' };
      mockAuth.activeSessionId = 'session-B';
      view.rerender(undefined);
    }
  });
  await act(async () => {
    expect(await view.result.current.updateSearch('watch-A', { name: 'Updated A' })).toBe(false);
  });
  expect(switched).toBe(true);
  expect(mockToast.success).not.toHaveBeenCalled();
  off();
});

it('saves successfully for the unchanged owner', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  await act(async () => {
    expect(await view.result.current.saveSearch('new A', 'apartments')).toBe(true);
  });
  expect(seen).toContainEqual({
    method: 'POST',
    owner: 'A',
    path: '/api/profiles/me/saved-searches',
  });
  await waitFor(() =>
    expect(view.result.current.searches.map((item) => item.id)).toContain('new-A'),
  );
  expect(mockToast.success).toHaveBeenCalledTimes(1);
});

it('does not restore an unknown owner binding from serialized paused variables', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  onlineManager.setOnline(false);
  let pending!: Promise<boolean>;
  act(() => {
    pending = view.result.current.saveSearch('new A', 'apartments');
  });
  await waitFor(() => expect(view.result.current.isSaving).toBe(true));
  const paused = client
    .getMutationCache()
    .getAll()
    .find((mutation) => mutation.state.isPaused);
  expect(paused?.options.mutationFn).toBeDefined();
  const vars = paused!.state.variables as { ownerKey: string };
  expect(JSON.parse(vars.ownerKey).every((part: unknown) => typeof part === 'number')).toBe(true);
  const serialized = JSON.stringify(
    dehydrate(client, {
      shouldDehydrateQuery: () => false,
      shouldDehydrateMutation: (mutation) => mutation === paused,
    }),
  );
  expect(serialized).not.toContain(token('A'));
  expect(serialized).not.toContain('session-A');
  const restored = new QueryClient();
  restored.setMutationDefaults(['saveSearch'], { mutationFn: paused!.options.mutationFn });
  hydrate(restored, JSON.parse(serialized));
  switchToB(() => view.rerender(undefined));
  await act(async () => {
    onlineManager.setOnline(true);
    await Promise.all([client.resumePausedMutations(), restored.resumePausedMutations()]);
    expect(await pending).toBe(false);
  });
  expect(restored.getMutationCache().getAll()[0]?.state.status).toBe('error');
  expect(seen.filter((request) => request.method === 'POST')).toEqual([]);
  restored.clear();
});

it('keeps private searches and paused mutation variables out of SDK account snapshots', async () => {
  const packageRoot = dirname(require.resolve('@oxy.so/services/package.json'));
  const { createAccountQueryPersistence } = jest.requireActual(
    join(packageRoot, 'lib/commonjs/ui/hooks/accountQueryPersistence.js'),
  );
  const writes: string[] = [];
  const persister = createAccountQueryPersistence(client, {
    roots: [],
    memoryOnlyRoots: ['savedSearches'],
  });
  persister.setStorage({
    getItem: async () => null,
    setItem: async (_key: string, value: string) => {
      writes.push(value);
    },
    removeItem: async () => {},
  });
  persister.attach();
  persister.activate('A');
  await persister.whenReady();
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  onlineManager.setOnline(false);
  let pending!: Promise<boolean>;
  act(() => {
    pending = view.result.current.saveSearch('private paused search', 'apartments');
  });
  await waitFor(() => expect(view.result.current.isSaving).toBe(true));
  const paused = client
    .getMutationCache()
    .getAll()
    .find((mutation) => mutation.state.isPaused);
  expect(paused).toBeDefined();
  act(() => {
    oxy.session.setAccessToken(token('B'));
    persister.activate('B');
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await persister.whenReady();
  expect(client.getMutationCache().getAll()).toContain(paused);
  expect(writes.length).toBeGreaterThan(0);
  const serialized = writes.join(' ');
  expect(serialized).not.toContain('watch-A');
  expect(serialized).not.toContain('private paused search');
  expect(serialized).not.toContain('session-A');
  expect(serialized).not.toContain(token('A'));
  await act(async () => {
    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    expect(await pending).toBe(false);
  });
  expect(seen.filter((request) => request.method === 'POST')).toEqual([]);
  view.unmount();
  persister.detach();
});

it('keeps the out-of-render location observer waiting through an account switch', async () => {
  const { observeInferredScope } = jest.requireActual('../hooks/useLocationScope');
  const { useLocationScopeStore } = jest.requireActual('../store/locationScopeStore');
  const { APPROXIMATE_LOCATION_QUERY_KEY } = jest.requireActual('../hooks/useApproximateLocation');
  useLocationScopeStore.setState({
    sessionSelection: null,
    explicitGlobal: false,
    lastChosenArea: null,
    deviceRequested: false,
    autoScope: null,
  });
  const stop = observeInferredScope(client);
  const view = renderHook(() => usePrimarySavedArea(), { wrapper });
  await waitFor(() => expect(view.result.current.selection).toEqual(location));
  const networkArea = { ...location, label: { primary: 'network area', kind: 'place' } };
  client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, {
    status: 'resolved',
    source: 'ip',
    granularity: 'city',
    selection: networkArea,
    resolvedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z',
  });
  expect(useLocationScopeStore.getState().autoScope).toBeNull();
  shouldHoldB = true;
  switchToB(() => view.rerender(undefined));
  await waitFor(() => expect(holdB).toBeDefined());
  expect(useLocationScopeStore.getState().autoScope).toBeNull();
  await act(async () => {
    holdB?.end(JSON.stringify({ data: [] }));
  });
  await waitFor(() =>
    expect(useLocationScopeStore.getState().autoScope).toEqual({
      source: 'ip',
      selection: networkArea,
    }),
  );
  stop();
});
