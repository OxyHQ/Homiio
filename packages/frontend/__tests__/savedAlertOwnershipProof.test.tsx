/** @jest-environment ./test/http-environment.cjs */
import type { ReactNode } from 'react';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';

let mockOrigin = '';
const mockAuth = {
  isAuthenticated: true,
  user: { id: 'A' },
  activeSessionId: 'session-A',
  oxyServices: null as unknown as OxyServices,
};
jest.mock('@/config', () => ({ API_URL: mockOrigin }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => mockAuth }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

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
let useSavedSearches: typeof import('../hooks/useSavedSearches').useSavedSearches;
let usePrimarySavedArea: typeof import('../hooks/useSavedSearches').usePrimarySavedArea;
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
  ({ useSavedSearches, usePrimarySavedArea } = jest.requireActual('../hooks/useSavedSearches'));
  ({ bindApiToOxy: bind } = jest.requireActual('../utils/api'));
});
beforeEach(() => {
  seen = [];
  shouldHoldB = false;
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

it('diagnostic: same cache returns A watch and primary area after projection B', async () => {
  const view = renderHook(() => ({ saved: useSavedSearches(), primary: usePrimarySavedArea() }), {
    wrapper,
  });
  await waitFor(() => expect(view.result.current.saved.searches[0]?.id).toBe('watch-A'));
  expect(view.result.current.primary.selection).toEqual(location);
  switchToB(() => view.rerender(undefined));
  expect(view.result.current.saved.searches[0]?.id).toBe('watch-A');
  expect(view.result.current.primary.selection).toEqual(location);
  expect(seen).toEqual([{ method: 'GET', owner: 'A', path: '/api/profiles/me/saved-searches' }]);
});

it('diagnostic: retained A watch callback sends under B after projection changes', async () => {
  const view = renderHook(() => useSavedSearches(), { wrapper });
  await waitFor(() => expect(view.result.current.searches[0]?.id).toBe('watch-A'));
  const update = view.result.current.updateAlertSettings;
  switchToB(() => view.rerender(undefined));
  await act(async () => {
    await update('watch-A', { cadence: 'off' });
  });
  expect(seen).toContainEqual({
    method: 'PUT',
    owner: 'B',
    path: '/api/profiles/me/saved-searches/watch-A',
  });
});

it.each([false, true])(
  'diagnostic: SDK account persistence transition, memory-only=%s',
  async (memoryOnly) => {
    const packageRoot = dirname(require.resolve('@oxy.so/services/package.json'));
    const { createAccountQueryPersistence } = jest.requireActual(
      join(packageRoot, 'lib/commonjs/ui/hooks/accountQueryPersistence.js'),
    );
    const persister = createAccountQueryPersistence(
      client,
      memoryOnly ? { memoryOnlyRoots: ['savedSearches'] } : undefined,
    );
    persister.setStorage({
      getItem: async () => null,
      setItem: async () => {},
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
    if (memoryOnly) {
      expect(view.result.current.saved.searches).toEqual([]);
    } else {
      expect(view.result.current.saved.searches[0]?.id).toBe('watch-A');
      expect(view.result.current.primary.selection).toEqual(location);
    }
    await act(async () => {
      holdB?.end(JSON.stringify({ data: [] }));
      await invalidating;
    });
    await waitFor(() => expect(view.result.current.saved.searches).toEqual([]));
    view.unmount();
    persister.detach();
  },
);
