/** @jest-environment ./test/http-environment.cjs */
import type React from 'react';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Text } from 'react-native';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react-native';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';

let mockOrigin = '';
const mockConfirm = jest.fn();
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('@oxy.so/bloom/surfaces', () => ({ confirm: mockConfirm }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: mockToast }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const mockAuth = {
  isAuthenticated: true,
  user: { id: 'A' },
  activeSessionId: 'session-A' as string | null,
  oxyServices: null as unknown as OxyServices,
};
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => mockAuth }));
jest.mock('@/config', () => ({ API_URL: mockOrigin }));
const token = (id: string) =>
  `h.${Buffer.from(JSON.stringify({ userId: id, sessionId: `session-${id}`, exp: 4102444800 })).toString('base64url')}.s`;
let oxy: OxyServices;
let client: QueryClient;
let server: Server;
let bind: typeof import('../utils/api').bindApiToOxy;
let useReservations: typeof import('../hooks/useReservationQueries').useReservationsQuery;
let useUpdate: typeof import('../hooks/useReservationQueries').useUpdateReservation;
let useCreate: typeof import('../hooks/useReservationQueries').useCreateReservation;
let useDetail: typeof import('../hooks/useReservationQueries').useReservationQuery;
let useAvailability: typeof import('../hooks/useReservationQueries').usePropertyAvailabilityQuery;
let useDecision: typeof import('../hooks/useReservationDecision').useReservationDecision;
let requests: Array<{ owner: string; method: string; path: string }> = [];
let session = 'A';
let holdB = false;
let heldB: ServerResponse | undefined;
let allowPatch = false;
let holdPatch = false;
let heldPatch: ServerResponse | undefined;
function QueryScreen() {
  const query = useReservations(
    { asHost: true, limit: 100, status: undefined },
    { enabled: Boolean(session) },
  );
  return (
    <>
      <Text testID="reservation">{query.data?.items[0]?.id ?? 'none'}</Text>
      <Text testID="reservation-status">{`${query.status}:${query.fetchStatus}:${query.error?.message ?? ''}`}</Text>
    </>
  );
}
function view() {
  return (
    <QueryClientProvider client={client}>
      <QueryScreen />
    </QueryClientProvider>
  );
}
beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer((req, res) => {
    const owner =
      req.headers.authorization === `Bearer ${token('A')}`
        ? 'A'
        : req.headers.authorization === `Bearer ${token('B')}`
          ? 'B'
          : 'unknown';
    requests.push({ owner, method: req.method ?? '', path: req.url ?? '' });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'PATCH' && holdPatch) {
      heldPatch = res;
      return;
    }
    if (req.method === 'POST') {
      res.end(JSON.stringify({ data: { id: 'created', propertyId: 'property-1' } }));
      return;
    }
    if (req.method === 'PATCH') {
      if (!allowPatch) {
        res.writeHead(403);
        res.end(JSON.stringify({ message: 'denied' }));
        return;
      }
      res.end(JSON.stringify({ data: { id: 'reservation-B', propertyId: 'property-1' } }));
      return;
    }
    if (req.url?.startsWith('/api/properties/')) {
      res.end(JSON.stringify({ data: { propertyId: 'property-1', windows: [], booked: [] } }));
      return;
    }
    if (req.url?.startsWith('/api/reservations/') && !holdB) {
      res.end(
        JSON.stringify({ data: { id: `${owner}-private-detail`, propertyId: 'property-1' } }),
      );
      return;
    }
    if (owner === 'B' && holdB) {
      heldB = res;
      return;
    }
    res.end(JSON.stringify({ data: [{ id: `${owner}-private-reservation` }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ bindApiToOxy: bind } = jest.requireActual('../utils/api'));
  ({
    useReservationsQuery: useReservations,
    useUpdateReservation: useUpdate,
    useCreateReservation: useCreate,
    useReservationQuery: useDetail,
    usePropertyAvailabilityQuery: useAvailability,
  } = jest.requireActual('../hooks/useReservationQueries'));
  useDecision = jest.requireActual('../hooks/useReservationDecision').useReservationDecision;
});
beforeEach(() => {
  requests = [];
  mockConfirm.mockReset();
  mockToast.success.mockReset();
  mockToast.error.mockReset();
  session = 'A';
  holdB = false;
  heldB = undefined;
  allowPatch = false;
  holdPatch = false;
  heldPatch = undefined;
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 300000, gcTime: 0 },
      mutations: { retry: false, gcTime: 0, networkMode: 'offlineFirst' },
    },
  });
  oxy = new OxyServices({ baseURL: mockOrigin });
  oxy.session.setAccessToken(token('A'));
  Object.assign(mockAuth, {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: oxy,
  });
  bind(oxy);
});
afterEach(() => {
  heldB?.destroy();
  heldPatch?.destroy();
  cleanup();
  client.clear();
  oxy.dispose();
  onlineManager.setOnline(true);
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it('hides the A list while B loads, then presents B data', async () => {
  const screen = render(view());
  try {
    await waitFor(
      () => expect(screen.getByTestId('reservation').props.children).toBe('A-private-reservation'),
      { timeout: 5000 },
    );
  } catch {
    throw new Error(
      JSON.stringify({ requests, status: screen.getByTestId('reservation-status').props.children }),
    );
  }
  holdB = true;
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    session = 'B';
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    screen.rerender(view());
  });
  expect(screen.getByTestId('reservation').props.children).toBe('none');
  await waitFor(() => expect(heldB).toBeDefined());
  await act(async () => {
    heldB?.end(JSON.stringify({ data: [{ id: 'B-private-reservation' }] }));
  });
  await waitFor(() =>
    expect(screen.getByTestId('reservation').props.children).toBe('B-private-reservation'),
  );
  expect(requests.filter((r) => r.method === 'GET').map((r) => r.owner)).toEqual(['A', 'B']);
});
it('rejects a retained A reservation action after switching to B', async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdate('A-private-reservation'), { wrapper });
  const retained = hook.result.current.mutateAsync;
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    session = 'B';
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
  });
  await act(async () => {
    await retained({ status: 'declined' } as never).catch(() => {});
  });
  expect(requests.filter((r) => r.method === 'PATCH')).toEqual([]);
});

it('permits a current-owner update normally', async () => {
  allowPatch = true;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdate('reservation-B'), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync({ status: 'declined' } as never);
  });
  expect(requests).toContainEqual({
    owner: 'A',
    method: 'PATCH',
    path: '/api/reservations/reservation-B',
  });
});

it('does not reuse private reservation detail for a new owner', async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDetail('private-id'), { wrapper });
  await waitFor(() => expect(hook.result.current.data?.id).toBe('A-private-detail'));
  holdB = true;
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    hook.rerender(undefined);
  });
  expect(hook.result.current.data).toBeUndefined();
  await waitFor(() => expect(heldB).toBeDefined());
  await act(async () => {
    heldB?.end(JSON.stringify({ data: { id: 'B-private-detail', propertyId: 'property-1' } }));
  });
  await waitFor(() => expect(hook.result.current.data?.id).toBe('B-private-detail'));
});
it('does not revive a retained create action after A to B to A', async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCreate(), { wrapper });
  const retained = hook.result.current.mutateAsync;
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    hook.rerender(undefined);
  });
  await act(async () => {
    oxy.session.setAccessToken(token('A'));
    mockAuth.user = { id: 'A' };
    mockAuth.activeSessionId = 'session-A';
    hook.rerender(undefined);
  });
  await act(async () => {
    await retained({
      propertyId: 'synthetic-property',
      checkIn: '2026-12-01',
      checkOut: '2026-12-02',
      guestCount: 1,
    } as never).catch(() => {});
  });
  expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
});
it('does not replay a paused update under the next bearer', async () => {
  client.clear();
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: 0, networkMode: 'online' } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdate('private-A'), { wrapper });
  await act(async () => {
    onlineManager.setOnline(false);
    void hook.result.current.mutateAsync({ status: 'declined' } as never).catch(() => {});
  });
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .some((m) => m.state.isPaused),
    ).toBe(true),
  );
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    hook.rerender(undefined);
  });
  await act(async () => {
    onlineManager.setOnline(true);
    await client.resumePausedMutations();
  });
  expect(requests.filter((r) => r.method === 'PATCH')).toEqual([]);
  expect(hook.result.current.isPending).toBe(false);
});
it('suppresses a late A update after its request was sent', async () => {
  holdPatch = true;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdate('private-A'), { wrapper });
  let outcome = 'pending';
  await act(async () => {
    void hook.result.current.mutateAsync({ status: 'declined' } as never).then(
      () => {
        outcome = 'success';
      },
      () => {
        outcome = 'error';
      },
    );
  });
  await waitFor(() => expect(heldPatch).toBeDefined());
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    hook.rerender(undefined);
  });
  await waitFor(() => expect(outcome).toBe('error'));
  expect(hook.result.current.data).toBeUndefined();
  expect(requests).toContainEqual({
    owner: 'A',
    method: 'PATCH',
    path: '/api/reservations/private-A',
  });
});
it('continues to load public property availability without a session', async () => {
  oxy.session.clear();
  mockAuth.isAuthenticated = false;
  mockAuth.user = { id: '' };
  mockAuth.activeSessionId = null;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useAvailability('property-1'), { wrapper });
  await waitFor(() => expect(hook.result.current.data?.propertyId).toBe('property-1'));
});

it('keeps reservation query keys and paused action inputs out of Services shared persistence', async () => {
  client.clear();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0, networkMode: 'online' },
    },
  });
  const path = require('node:path');
  const servicesRoot = path.dirname(require.resolve('@oxy.so/services/package.json'));
  const { attachQueryPersistence } = require(
    path.join(servicesRoot, 'lib/commonjs/ui/hooks/queryClient.js'),
  );
  let stored: string | null = null;
  const persistence = attachQueryPersistence(client, {
    getItem: async () => null,
    setItem: async (_key: string, value: string) => {
      stored = value;
    },
    removeItem: async () => {},
  });
  await persistence.restored;
  const subject = 'PRIVATE_RESERVATION_ACCOUNT_SENTINEL';
  await act(async () => {
    oxy.session.setAccessToken(token(subject));
    mockAuth.user = { id: subject };
    mockAuth.activeSessionId = 'PRIVATE_RESERVATION_SESSION_SENTINEL';
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => ({
      list: useReservations({ asHost: true, limit: 100 }),
      update: useUpdate('PRIVATE_RESERVATION_ID_SENTINEL'),
    }),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.list.isSuccess).toBe(true));
  await act(async () => {
    onlineManager.setOnline(false);
    void hook.result.current.update
      .mutateAsync({ status: 'declined', notes: 'PRIVATE_RESERVATION_PAYLOAD_SENTINEL' } as never)
      .catch(() => {});
  });
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .some((m) => m.state.isPaused),
    ).toBe(true),
  );
  try {
    await waitFor(() => expect(stored).not.toBeNull(), { timeout: 4000 });
    const payload = JSON.parse(stored ?? '');
    expect(payload.clientState.queries).toEqual([]);
    expect(payload.clientState.mutations).toHaveLength(1);
    expect(payload.clientState.mutations[0].state.variables.ownerKey).toMatch(/^\[\d+,\d+,\d+\]$/);
    for (const value of [
      subject,
      'PRIVATE_RESERVATION_SESSION_SENTINEL',
      'PRIVATE_RESERVATION_ID_SENTINEL',
      'PRIVATE_RESERVATION_PAYLOAD_SENTINEL',
      token(subject),
    ])
      expect(stored).not.toContain(value);
  } finally {
    persistence.unsubscribe();
    hook.unmount();
    await act(async () => {
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
    });
  }
});

it('does not execute a host decline confirmation opened by A after B signs in', async () => {
  let resolveConfirm: (answer: boolean) => void = () => {};
  mockConfirm.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        resolveConfirm = resolve;
      }),
  );
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDecision({ id: 'private-A', status: 'pending' } as never), {
    wrapper,
  });
  await act(async () => {
    void hook.result.current.decide('declined' as never);
  });
  expect(mockConfirm).toHaveBeenCalled();
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    hook.rerender(undefined);
  });
  await act(async () => {
    resolveConfirm(true);
  });
  expect(requests.filter((r) => r.method === 'PATCH')).toEqual([]);
  expect(mockToast.success).not.toHaveBeenCalled();
  expect(mockToast.error).not.toHaveBeenCalled();
});
it('permits a confirmed host decline for the same owner', async () => {
  allowPatch = true;
  mockConfirm.mockResolvedValue(true);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDecision({ id: 'private-A', status: 'pending' } as never), {
    wrapper,
  });
  await act(async () => {
    await hook.result.current.decide('declined' as never);
  });
  expect(requests).toContainEqual({
    owner: 'A',
    method: 'PATCH',
    path: '/api/reservations/private-A',
  });
  expect(mockToast.success).toHaveBeenCalled();
});

it('creates a reservation for the unchanged owner', async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCreate(), { wrapper });
  let result: unknown;
  await act(async () => {
    result = await hook.result.current.mutateAsync({
      propertyId: 'property-1',
      checkIn: '2026-12-01',
      checkOut: '2026-12-02',
      guestCount: 2,
    } as never);
  });
  expect(result).toMatchObject({ id: 'created' });
  expect(requests).toContainEqual({ owner: 'A', method: 'POST', path: '/api/reservations' });
});
it('does not replay a paused creation after a switch to B', async () => {
  client.clear();
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: 0, networkMode: 'online' } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCreate(), { wrapper });
  await act(async () => {
    onlineManager.setOnline(false);
    void hook.result.current
      .mutateAsync({
        propertyId: 'property-A',
        checkIn: '2026-12-01',
        checkOut: '2026-12-02',
        guestCount: 2,
      } as never)
      .catch(() => {});
  });
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .some((m) => m.state.isPaused),
    ).toBe(true),
  );
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    hook.rerender(undefined);
  });
  await act(async () => {
    onlineManager.setOnline(true);
    await client.resumePausedMutations();
  });
  expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
  expect(hook.result.current.isPending).toBe(false);
});

it('preserves the full reservation mutation per-call callback contract', async () => {
  allowPatch = true;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdate('reservation-B'), { wrapper });
  const onSuccess = jest.fn();
  const onSettled = jest.fn();
  const input = { status: 'declined' } as never;
  await act(async () => {
    await hook.result.current.mutateAsync(input, { onSuccess, onSettled });
  });
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(onSuccess.mock.calls[0][1]).toBe(input);
  expect(onSettled).toHaveBeenCalledTimes(1);
  expect(onSettled.mock.calls[0][2]).toBe(input);
});

it('does not invoke full mutation callbacks for a retained action after account change', async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdate('reservation-A'), { wrapper });
  const retained = hook.result.current.mutateAsync;
  const onSuccess = jest.fn();
  const onError = jest.fn();
  const onSettled = jest.fn();
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    session = 'B';
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
  });
  await act(async () => {
    await retained({ status: 'declined' } as never, { onSuccess, onError, onSettled }).catch(
      () => {},
    );
  });
  expect(requests.filter((request) => request.method === 'PATCH')).toEqual([]);
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(onSettled).not.toHaveBeenCalled();
});
