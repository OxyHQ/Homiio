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
  activeSessionId: 'session-A' as string | null,
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
let postBodies: string[];
let holdB: ServerResponse | undefined;
let holdA: ServerResponse | undefined;
let shouldHoldA = false;
let shouldHoldB = false;
let nameA = 'A private watch';
let allowPutA = false;
let unavailableA = false;
let holdPost: ServerResponse | undefined;
let shouldHoldPost = false;
let deletedA = false;
let createdA = false;
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
    if (req.method === 'GET' && owner === 'A' && unavailableA) {
      res.writeHead(503);
      res.end(JSON.stringify({ message: 'Unavailable' }));
      return;
    }
    if (req.method === 'GET' && owner === 'A' && shouldHoldA) {
      holdA = res;
      return;
    }
    if (req.method === 'GET' && owner === 'B' && shouldHoldB) {
      holdB = res;
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (part: string) => {
        body += part;
      });
      req.on('end', () => {
        postBodies.push(body);
        if (shouldHoldPost) {
          holdPost = res;
          return;
        }
        res.end(JSON.stringify({ data: { id: 'new-A', name: 'new A', query: 'apartments' } }));
      });
      return;
    }
    if (req.method === 'DELETE' && owner === 'A') {
      deletedA = true;
      res.end('{}');
      return;
    }
    if (req.method === 'GET' && owner === 'A' && deletedA) {
      res.end(
        JSON.stringify({
          data: createdA ? [{ id: 'new-A', name: 'new A', query: 'apartments' }] : [],
        }),
      );
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
                  name: nameA,
                  query: 'A',
                  location,
                  locationStatus: 'resolved',
                  isPrimaryArea: true,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
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
  postBodies = [];
  shouldHoldB = false;
  shouldHoldA = false;
  holdA = undefined;
  nameA = 'A private watch';
  allowPutA = false;
  unavailableA = false;
  holdPost = undefined;
  shouldHoldPost = false;
  deletedA = false;
  createdA = false;
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
function loadedSavedSearchQuery() {
  return client
    .getQueryCache()
    .findAll({ queryKey: ['savedSearches'] })
    .find(
      (query) =>
        Array.isArray(query.state.data) && query.state.data.some((item) => item?.id === 'watch-A'),
    );
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
  act(() => onlineManager.setOnline(false));
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
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await waitFor(() => expect(view.result.current.isSaving).toBe(false));
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
  expect(view.result.current.primary).toEqual({
    selection: null,
    pending: false,
    unavailable: true,
  });
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
  act(() => onlineManager.setOnline(false));
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
  expect(serialized).not.toContain('new A');
  expect(serialized).not.toContain('apartments');
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
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await waitFor(() => expect(view.result.current.isSaving).toBe(false));
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
  act(() => onlineManager.setOnline(false));
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
  act(() => {
    client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, {
      status: 'resolved',
      source: 'ip',
      granularity: 'city',
      selection: networkArea,
      resolvedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
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
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  stop();
});

it('does not show a verified empty list while bearer B precedes the projected user', async () => {
  const view = renderHook(() => ({ saved: useSavedSearches(), primary: usePrimarySavedArea() }), {
    wrapper,
  });
  await waitFor(() => expect(view.result.current.saved.searches[0]?.id).toBe('watch-A'));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    view.rerender(undefined);
  });
  expect(view.result.current.saved.searches).toEqual([]);
  expect(view.result.current.saved.isLoading).toBe(true);
  expect(view.result.current.saved.error).toBeNull();
  expect(view.result.current.primary).toEqual({ selection: null, pending: true });
  act(() => {
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.saved.isLoading).toBe(false));
  expect(view.result.current.saved.searches).toEqual([]);
});

it('allows a known-subject legacy bearer while its projected session id is absent', async () => {
  mockAuth.activeSessionId = null;
  const view = renderHook(() => ({ saved: useSavedSearches(), primary: usePrimarySavedArea() }), {
    wrapper,
  });
  await waitFor(() => expect(view.result.current.saved.searches[0]?.id).toBe('watch-A'));
  expect(view.result.current.primary.selection).toEqual(location);
  await act(async () => {
    expect(await view.result.current.saved.saveSearch('new A', 'apartments')).toBe(true);
  });
  expect(seen).toContainEqual({
    method: 'POST',
    owner: 'A',
    path: '/api/profiles/me/saved-searches',
  });
  await waitFor(() => expect(view.result.current.saved.isSaving).toBe(false));
  await waitFor(() =>
    expect(view.result.current.saved.searches.map((item) => item.id)).toContain('new-A'),
  );
});

it('uses the newly projected session result in the out-of-render reader', async () => {
  mockAuth.activeSessionId = null;
  const view = renderHook(() => usePrimarySavedArea(), { wrapper });
  await waitFor(() =>
    expect(savedSearchesReading(client, 'A').data?.[0]?.name).toBe('A private watch'),
  );
  nameA = 'Fresh A watch';
  act(() => {
    mockAuth.activeSessionId = 'session-A';
    view.rerender(undefined);
  });
  await waitFor(() =>
    expect(savedSearchesReading(client, 'A').data?.[0]?.name).toBe('Fresh A watch'),
  );
});

it('resumes a paused same-owner save with its in-memory payload', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  act(() => onlineManager.setOnline(false));
  let pending!: Promise<boolean>;
  act(() => {
    pending = view.result.current.saveSearch('private name', 'private query');
  });
  await waitFor(() => expect(view.result.current.isSaving).toBe(true));
  await act(async () => {
    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    expect(await pending).toBe(true);
  });
  expect(seen).toContainEqual({
    method: 'POST',
    owner: 'A',
    path: '/api/profiles/me/saved-searches',
  });
  expect(JSON.parse(postBodies[0])).toMatchObject({ name: 'private name', query: 'private query' });
  await waitFor(() => expect(view.result.current.isSaving).toBe(false));
  await waitFor(() =>
    expect(view.result.current.searches.map((item) => item.id)).toContain('new-A'),
  );
});

it.each(['save', 'update', 'delete', 'alert', 'primary'] as const)(
  'does not send a retained %s action after switching accounts',
  async (kind) => {
    const view = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
    const actions = view.result.current;
    const run = {
      save: () => actions.saveSearch('private', 'apartments'),
      update: () => actions.updateSearch('watch-A', { name: 'private' }),
      delete: () => actions.deleteSavedSearch('watch-A'),
      alert: () => actions.updateAlertSettings('watch-A', { cadence: 'off' }),
      primary: () => actions.setPrimaryArea('watch-A'),
    }[kind];
    switchToB(() => view.rerender(undefined));
    await act(async () => {
      expect(await run()).toBe(false);
    });
    expect(seen.filter((request) => request.method !== 'GET')).toEqual([]);
  },
);

it('updates alert settings for the unchanged owner', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  allowPutA = true;
  await act(async () => {
    expect(await view.result.current.updateAlertSettings('watch-A', { cadence: 'off' })).toBe(true);
  });
  expect(seen).toContainEqual({
    method: 'PUT',
    owner: 'A',
    path: '/api/profiles/me/saved-searches/watch-A',
  });
  await waitFor(() => expect(view.result.current.searches[0]?.name).toBe('Updated A'));
});

it('deletes a saved search for the unchanged owner', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  await act(async () => {
    expect(await view.result.current.deleteSavedSearch('watch-A', 'A private watch')).toBe(true);
  });
  expect(seen).toContainEqual({
    method: 'DELETE',
    owner: 'A',
    path: '/api/profiles/me/saved-searches/watch-A',
  });
  await waitFor(() => expect(view.result.current.searches).toEqual([]));
});

it('does not expose an externally hydrated fresh query without an in-memory binding', async () => {
  const first = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(first.result.current.searches[0]?.id).toBe('watch-A'));
  const query = loadedSavedSearchQuery();
  expect(query).toBeDefined();
  const key = query!.queryKey;
  first.unmount();
  client.clear();

  const source = new QueryClient();
  source.setQueryData(key, [
    {
      id: 'unattributed',
      name: 'unattributed private data',
      location,
      locationStatus: 'resolved',
      isPrimaryArea: true,
    },
  ]);
  const blob = JSON.parse(JSON.stringify(dehydrate(source)));
  source.clear();
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: 300000, retry: false, gcTime: Infinity } },
  });
  hydrate(client, blob);
  shouldHoldA = true;
  const restored = renderHook(
    () => ({ saved: useSavedSearches(), primary: usePrimarySavedArea() }),
    { wrapper },
  );
  await waitFor(() => expect(holdA).toBeDefined());
  expect(restored.result.current.saved.searches).toEqual([]);
  expect(restored.result.current.primary).toEqual({ selection: null, pending: true });
  expect(savedSearchesReading(client, 'A').data).toBeUndefined();
  await act(async () => {
    holdA?.end(
      JSON.stringify({
        data: [
          {
            id: 'watch-A',
            name: 'A private watch',
            query: 'A',
            location,
            locationStatus: 'resolved',
            isPrimaryArea: true,
          },
        ],
      }),
    );
  });
  await waitFor(() => expect(restored.result.current.saved.searches[0]?.id).toBe('watch-A'));
  expect(restored.result.current.primary.selection).toEqual(location);
});

it('keeps verified same-owner searches on an in-memory offline remount', async () => {
  const first = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(first.result.current.searches[0]?.id).toBe('watch-A'));
  first.unmount();
  act(() => onlineManager.setOnline(false));
  const second = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(second.result.current.searches[0]?.id).toBe('watch-A'));
  expect(seen.filter((request) => request.method === 'GET')).toHaveLength(1);
});

it('reports a paused unbound hydration as unavailable and recovers on reconnect', async () => {
  const first = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(first.result.current.searches[0]?.id).toBe('watch-A'));
  const key = loadedSavedSearchQuery()!.queryKey;
  first.unmount();
  client.clear();
  const source = new QueryClient();
  source.setQueryData(key, [{ id: 'unattributed', name: 'private unknown' }]);
  const blob = JSON.parse(JSON.stringify(dehydrate(source)));
  source.clear();
  client = new QueryClient({
    defaultOptions: {
      queries: { networkMode: 'online', staleTime: 300000, retry: false, gcTime: Infinity },
    },
  });
  hydrate(client, blob);
  act(() => onlineManager.setOnline(false));
  const restored = renderHook(
    () => ({ saved: useSavedSearches(), primary: usePrimarySavedArea() }),
    { wrapper },
  );
  await waitFor(() =>
    expect(restored.result.current.saved.error).toBe('search.widgets.savedSearches.loadFailed'),
  );
  expect(restored.result.current.saved.searches).toEqual([]);
  expect(restored.result.current.saved.isLoading).toBe(false);
  expect(restored.result.current.primary).toEqual({
    selection: null,
    pending: false,
    unavailable: true,
  });
  await act(async () => {
    onlineManager.setOnline(true);
  });
  await waitFor(() => expect(restored.result.current.saved.searches[0]?.id).toBe('watch-A'));
  expect(restored.result.current.saved.error).toBeNull();
});

it('recovers from a cache publication that does not match the verified object', async () => {
  const view = renderHook(() => ({ saved: useSavedSearches(), primary: usePrimarySavedArea() }), {
    wrapper,
  });
  await waitFor(() => expect(view.result.current.saved.searches[0]?.id).toBe('watch-A'));
  const query = loadedSavedSearchQuery();
  expect(query).toBeDefined();
  shouldHoldA = true;
  act(() => {
    client.setQueryData(query!.queryKey, [{ id: 'unattributed', name: 'unknown' }]);
  });
  await waitFor(() => expect(holdA).toBeDefined());
  expect(view.result.current.saved.searches).toEqual([]);
  expect(view.result.current.primary).toEqual({ selection: null, pending: true });
  expect(savedSearchesReading(client, 'A').data).toBeUndefined();
  await act(async () => {
    holdA?.end(
      JSON.stringify({
        data: [
          {
            id: 'watch-A',
            name: 'A private watch',
            query: 'A',
            location,
            locationStatus: 'resolved',
            isPrimaryArea: true,
          },
        ],
      }),
    );
  });
  await waitFor(() => expect(view.result.current.saved.searches[0]?.id).toBe('watch-A'));
  expect(seen.filter((request) => request.method === 'GET')).toHaveLength(2);
});

it('does not read an old instance cache when the linked API is rebound', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  const retainedLookup = view.result.current.getSearchById;
  const replacement = new OxyServices({ baseURL: mockOrigin });
  replacement.session.setAccessToken(token('A'));
  act(() => {
    bind(replacement);
    expect(savedSearchesReading(client, 'A').data).toBeUndefined();
    expect(retainedLookup('watch-A')).toBeUndefined();
    bind(oxy);
  });
  replacement.dispose();
});

it('settles a same-owner refetch with deeply equal data without a retry loop', async () => {
  const view = renderHook(() => ({ saved: useSavedSearches(), primary: usePrimarySavedArea() }), {
    wrapper,
  });
  await waitFor(() => expect(view.result.current.saved.searches[0]?.id).toBe('watch-A'));
  const query = loadedSavedSearchQuery();
  expect(query).toBeDefined();
  const original = query!.state.data;
  await act(async () => {
    await client.refetchQueries({ queryKey: query!.queryKey, exact: true });
  });
  await waitFor(() => expect(query!.state.fetchStatus).toBe('idle'));
  expect(query!.state.data).toEqual(original);
  expect(query!.state.data).not.toBe(original);
  expect(savedSearchesReading(client, 'A').data).toBe(query!.state.data);
  await waitFor(() => expect(view.result.current.saved.searches).toBe(query!.state.data));
  await waitFor(() =>
    expect(view.result.current.primary.selection).toBe(
      view.result.current.saved.searches[0]?.location,
    ),
  );
  expect(view.result.current.primary.selection).toEqual(location);
  expect(seen.filter((request) => request.method === 'GET')).toHaveLength(2);
});

it('does not infer a network area while an unbound saved area is paused and recovers', async () => {
  const first = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(first.result.current.searches[0]?.id).toBe('watch-A'));
  const key = loadedSavedSearchQuery()!.queryKey;
  first.unmount();
  client.clear();
  const source = new QueryClient();
  source.setQueryData(key, [{ id: 'unattributed', name: 'unknown' }]);
  const blob = JSON.parse(JSON.stringify(dehydrate(source)));
  source.clear();
  client = new QueryClient({
    defaultOptions: {
      queries: { networkMode: 'online', staleTime: 300000, retry: false, gcTime: Infinity },
    },
  });
  hydrate(client, blob);
  const { useLocationScope, observeInferredScope } = jest.requireActual(
    '../hooks/useLocationScope',
  );
  const { useLocationScopeStore } = jest.requireActual('../store/locationScopeStore');
  const { APPROXIMATE_LOCATION_QUERY_KEY } = jest.requireActual('../hooks/useApproximateLocation');
  useLocationScopeStore.setState({
    sessionSelection: null,
    explicitGlobal: false,
    lastChosenArea: null,
    deviceRequested: false,
    autoScope: null,
  });
  const networkArea = { ...location, label: { primary: 'network area', kind: 'place' } };
  client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, {
    status: 'resolved',
    source: 'ip',
    granularity: 'city',
    selection: networkArea,
    resolvedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z',
  });
  await act(async () => {
    onlineManager.setOnline(false);
  });
  const stop = observeInferredScope(client);
  const view = renderHook(() => ({ scope: useLocationScope(), primary: usePrimarySavedArea() }), {
    wrapper,
  });
  await waitFor(() =>
    expect(view.result.current.primary).toEqual({
      selection: null,
      pending: false,
      unavailable: true,
    }),
  );
  expect(view.result.current.scope.source).toBeNull();
  expect(view.result.current.scope.savedAreaUnavailable).toBe(true);
  expect(useLocationScopeStore.getState().autoScope).toBeNull();
  const explicitArea = { ...location, label: { primary: 'explicit choice', kind: 'place' } };
  await act(async () => {
    view.result.current.scope.choose(explicitArea);
  });
  await waitFor(() => expect(view.result.current.scope.selection).toEqual(explicitArea));
  expect(view.result.current.scope.source).toBe('session');
  await act(async () => {
    useLocationScopeStore.setState({ sessionSelection: null });
  });
  await act(async () => {
    onlineManager.setOnline(true);
  });
  await waitFor(() => expect(view.result.current.primary.selection).toEqual(location));
  await waitFor(() => expect(view.result.current.scope.source).toBe('saved_area'));
  expect(useLocationScopeStore.getState().autoScope).toBeNull();
  view.unmount();
  stop();
});

it('holds automatic inference when the saved-area request returns 503 and recovers', async () => {
  const { useLocationScope, observeInferredScope } = jest.requireActual(
    '../hooks/useLocationScope',
  );
  const { useLocationScopeStore } = jest.requireActual('../store/locationScopeStore');
  const { APPROXIMATE_LOCATION_QUERY_KEY } = jest.requireActual('../hooks/useApproximateLocation');
  useLocationScopeStore.setState({
    sessionSelection: null,
    explicitGlobal: false,
    lastChosenArea: null,
    deviceRequested: false,
    autoScope: null,
  });
  const networkArea = { ...location, label: { primary: 'network area', kind: 'place' } };
  client.setQueryData(APPROXIMATE_LOCATION_QUERY_KEY, {
    status: 'resolved',
    source: 'ip',
    granularity: 'city',
    selection: networkArea,
    resolvedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z',
  });
  unavailableA = true;
  const stop = observeInferredScope(client);
  const view = renderHook(() => ({ scope: useLocationScope(), primary: usePrimarySavedArea() }), {
    wrapper,
  });
  await waitFor(() => expect(view.result.current.primary.unavailable).toBe(true));
  expect(view.result.current.scope.source).toBeNull();
  expect(view.result.current.scope.savedAreaUnavailable).toBe(true);
  expect(useLocationScopeStore.getState().autoScope).toBeNull();
  unavailableA = false;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['savedSearches'] });
  });
  await waitFor(() => expect(view.result.current.primary.selection).toEqual(location));
  await waitFor(() => expect(view.result.current.scope.source).toBe('saved_area'));
  expect(useLocationScopeStore.getState().autoScope).toBeNull();
  view.unmount();
  stop();
});

it('keeps a confirmed update after an earlier saved-search read finishes', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.name).toBe('A private watch'));
  const { api } = jest.requireActual('../utils/api') as typeof import('../utils/api');
  const originalGet = api.get;
  let finishRead!: () => void;
  const readDelivered = new Promise<void>((resolve) => {
    finishRead = resolve;
  });
  const spy = jest.spyOn(api, 'get').mockImplementation(((...args: Parameters<typeof api.get>) =>
    originalGet(...args).then(
      (response) => {
        finishRead();
        return response;
      },
      (error) => {
        finishRead();
        throw error;
      },
    )) as typeof api.get);
  shouldHoldA = true;
  allowPutA = true;
  let reading: Promise<void> | undefined;
  act(() => {
    reading = client.refetchQueries({ queryKey: loadedSavedSearchQuery()!.queryKey, exact: true });
  });
  await waitFor(() => expect(holdA).toBeDefined());
  await act(async () => {
    expect(await view.result.current.updateSearch('watch-A', { name: 'Updated A' })).toBe(true);
  });
  await waitFor(() => expect(view.result.current.searches[0]?.name).toBe('Updated A'));
  const key = loadedSavedSearchQuery()!.queryKey;
  expect(seen.map(({ method }) => method)).toEqual(['GET', 'GET', 'PUT']);
  await act(async () => {
    holdA!.end(JSON.stringify({ data: [{ id: 'watch-A', name: 'A private watch', query: 'A' }] }));
    await reading;
    await readDelivered;
  });
  spy.mockRestore();
  expect(client.getQueryState(key)?.fetchStatus).toBe('idle');
  expect((client.getQueryData(key) as Array<{ name: string }>)[0]?.name).toBe('Updated A');
  await waitFor(() => expect(view.result.current.searches[0]?.name).toBe('Updated A'));
});

it('keeps successful create and delete of different searches while an earlier read returns', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  const key = loadedSavedSearchQuery()!.queryKey;
  const { api } = jest.requireActual('../utils/api') as typeof import('../utils/api');
  const originalGet = api.get;
  let finishRead!: () => void;
  const readDelivered = new Promise<void>((resolve) => {
    finishRead = resolve;
  });
  const spy = jest.spyOn(api, 'get').mockImplementation(((...args: Parameters<typeof api.get>) =>
    originalGet(...args).then(
      (response) => {
        finishRead();
        return response;
      },
      (error) => {
        finishRead();
        throw error;
      },
    )) as typeof api.get);
  shouldHoldA = true;
  let reading: Promise<void> | undefined;
  act(() => {
    reading = client.refetchQueries({ queryKey: key, exact: true });
  });
  await waitFor(() => expect(holdA).toBeDefined());
  await act(async () => {
    const results = await Promise.all([
      view.result.current.saveSearch('new A', 'apartments'),
      view.result.current.deleteSavedSearch('watch-A', 'A private watch'),
    ]);
    expect(results).toEqual([true, true]);
  });
  expect((client.getQueryData(key) as Array<{ id: string }>).map((item) => item.id)).toEqual([
    'new-A',
  ]);
  await act(async () => {
    const finished = new Promise<void>((resolve) => holdA!.once('finish', resolve));
    holdA!.end(JSON.stringify({ data: [{ id: 'watch-A', name: 'A private watch', query: 'A' }] }));
    await finished;
    await reading;
    await readDelivered;
  });
  spy.mockRestore();
  expect((client.getQueryData(key) as Array<{ id: string }>).map((item) => item.id)).toEqual([
    'new-A',
  ]);
});

it('keeps both concurrent writes when starting from an unverified cache', async () => {
  const first = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(first.result.current.searches[0]?.id).toBe('watch-A'));
  const key = loadedSavedSearchQuery()!.queryKey;
  first.unmount();
  client.clear();
  const source = new QueryClient();
  source.setQueryData(key, [{ id: 'unverified', name: 'unverified' }]);
  const blob = JSON.parse(JSON.stringify(dehydrate(source)));
  source.clear();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  hydrate(client, blob);
  const { api } = jest.requireActual('../utils/api') as typeof import('../utils/api');
  const originalGet = api.get;
  let readIndex = 0;
  const resolveReads: Array<() => void> = [];
  const delivered = [0, 1].map(
    (i) =>
      new Promise<void>((resolve) => {
        resolveReads[i] = resolve;
      }),
  );
  const spy = jest.spyOn(api, 'get').mockImplementation(((...args: Parameters<typeof api.get>) => {
    const index = readIndex++;
    return originalGet(...args).then(
      (value) => {
        resolveReads[index]?.();
        return value;
      },
      (error) => {
        resolveReads[index]?.();
        throw error;
      },
    );
  }) as typeof api.get);
  shouldHoldA = true;
  shouldHoldPost = true;
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(holdA).toBeDefined());
  const stale = holdA!;
  let creating: Promise<boolean> | undefined;
  act(() => {
    creating = view.result.current.saveSearch('new A', 'apartments');
  });
  await waitFor(() => expect(holdPost).toBeDefined());
  await act(async () => {
    expect(await view.result.current.deleteSavedSearch('watch-A')).toBe(true);
  });
  await waitFor(() => expect(deletedA).toBe(true));
  await waitFor(() => expect(holdA).not.toBe(stale));
  const staleAfterDelete = holdA!;
  shouldHoldA = false;
  createdA = true;
  await act(async () => {
    holdPost!.end(JSON.stringify({ data: { id: 'new-A', name: 'new A', query: 'apartments' } }));
    expect(await creating).toBe(true);
  });
  await waitFor(() => expect(view.result.current.searches.map((x) => x.id)).toEqual(['new-A']));
  await act(async () => {
    stale.end(JSON.stringify({ data: [{ id: 'watch-A', name: 'A private watch', query: 'A' }] }));
    staleAfterDelete.end(JSON.stringify({ data: [] }));
    await Promise.all(delivered);
  });
  spy.mockRestore();
  expect((client.getQueryData(key) as Array<{ id: string }>).map((x) => x.id)).toEqual(['new-A']);
});

it('does not publish or toast when cancellation reenters an account switch', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  const key = loadedSavedSearchQuery()!.queryKey;
  shouldHoldA = true;
  allowPutA = true;
  act(() => {
    void client.refetchQueries({ queryKey: key, exact: true });
  });
  await waitFor(() => expect(holdA).toBeDefined());
  let switched = false;
  const stop = client.getQueryCache().subscribe((event) => {
    if (!switched && event.query.queryKey === key && event.query.state.fetchStatus === 'idle') {
      switched = true;
      oxy.session.setAccessToken(token('B'));
      mockAuth.user = { id: 'B' };
      mockAuth.activeSessionId = 'session-B';
      view.rerender(undefined);
    }
  });
  let success = true;
  await act(async () => {
    success = await view.result.current.updateSearch('watch-A', { name: 'Updated A' });
  });
  expect(switched).toBe(true);
  expect(success).toBe(false);
  expect(mockToast.success).not.toHaveBeenCalled();
  expect((client.getQueryData(key) as Array<{ name: string }>)[0]?.name).toBe('A private watch');
  stop();
  await act(async () => {
    holdA!.end(JSON.stringify({ data: [] }));
  });
});

it('does not publish a reentrant read started while cancelling an earlier read', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.name).toBe('A private watch'));
  const key = loadedSavedSearchQuery()!.queryKey;
  shouldHoldA = true;
  allowPutA = true;
  act(() => {
    void client.refetchQueries({ queryKey: key, exact: true });
  });
  await waitFor(() => expect(holdA).toBeDefined());
  const firstRead = holdA!;
  let reentrant: Promise<void> | undefined;
  let started = false;
  const stop = client.getQueryCache().subscribe((event) => {
    if (!started && event.query.queryKey === key && event.query.state.fetchStatus === 'idle') {
      started = true;
      reentrant = client.refetchQueries({ queryKey: key, exact: true });
    }
  });
  await act(async () => {
    expect(await view.result.current.updateSearch('watch-A', { name: 'Updated A' })).toBe(true);
  });
  await waitFor(() => expect(holdA).not.toBe(firstRead));
  expect((client.getQueryData(key) as Array<{ name: string }>)[0]?.name).toBe('Updated A');
  stop();
  const mutationTimestamp = client.getQueryState(key)!.dataUpdatedAt;
  const clock = jest.spyOn(Date, 'now').mockReturnValue(mutationTimestamp + 60000);
  await act(async () => {
    holdA!.end(JSON.stringify({ data: [{ id: 'watch-A', name: 'A private watch', query: 'A' }] }));
    await reentrant;
    firstRead.end(
      JSON.stringify({ data: [{ id: 'watch-A', name: 'A private watch', query: 'A' }] }),
    );
  });
  clock.mockRestore();
  expect((client.getQueryData(key) as Array<{ name: string }>)[0]?.name).toBe('Updated A');
  expect(client.getQueryState(key)!.dataUpdatedAt).toBe(mutationTimestamp);
  expect(client.getQueryState(key)!.status).toBe('error');
  await waitFor(() => expect(view.result.current.error).toBeNull());
  shouldHoldA = false;
  nameA = 'Updated A';
  await act(async () => {
    await client.refetchQueries({ queryKey: key, exact: true });
  });
  await waitFor(() => expect(client.getQueryState(key)!.status).toBe('success'));
  expect(view.result.current.error).toBeNull();
});

it('keeps an unavailable state if a superseded read has no prior cache data', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.name).toBe('A private watch'));
  const query = loadedSavedSearchQuery()!;
  const key = query.queryKey;
  shouldHoldA = true;
  allowPutA = true;
  act(() => {
    void client.refetchQueries({ queryKey: key, exact: true });
  });
  await waitFor(() => expect(holdA).toBeDefined());
  const firstRead = holdA!;
  let started = false;
  let reentrant: Promise<void> | undefined;
  const stop = client.getQueryCache().subscribe((event) => {
    if (!started && event.query === query && query.state.fetchStatus === 'idle') {
      started = true;
      reentrant = client.refetchQueries({ queryKey: key, exact: true });
    }
  });
  await act(async () => {
    expect(await view.result.current.updateSearch('watch-A', { name: 'Updated A' })).toBe(true);
  });
  await waitFor(() => expect(holdA).not.toBe(firstRead));
  stop();
  act(() => {
    query.setState({ data: undefined });
  });
  await act(async () => {
    holdA!.end(JSON.stringify({ data: [{ id: 'watch-A', name: 'A private watch', query: 'A' }] }));
    await reentrant;
    firstRead.end(JSON.stringify({ data: [] }));
  });
  expect(client.getQueryData(key)).toBeUndefined();
  await waitFor(() =>
    expect(view.result.current.error).toBe('search.widgets.savedSearches.loadFailed'),
  );
  shouldHoldA = false;
  nameA = 'Updated A';
  await act(async () => {
    await client.refetchQueries({ queryKey: key, exact: true });
  });
  await waitFor(() => expect(view.result.current.searches[0]?.name).toBe('Updated A'));
  expect(view.result.current.error).toBeNull();
});
