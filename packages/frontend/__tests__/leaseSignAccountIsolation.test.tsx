/** @jest-environment ./test/http-environment.cjs */
import type { ReactNode } from 'react';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';

let mockOrigin = '';
const mockAuth = {
  isAuthenticated: true,
  user: { id: 'A' } as { id: string } | null,
  activeSessionId: 'session-A' as string | null,
  oxyServices: null as unknown as OxyServices,
};
jest.mock('@/config', () => ({ API_URL: mockOrigin }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => mockAuth }));
jest.mock('@/services/propertyService', () => ({ propertyService: {} }));

const token = (userId: string, nonce = 'first') =>
  `h.${Buffer.from(JSON.stringify({ userId, sessionId: `session-${userId}`, exp: 4102444800, nonce })).toString('base64url')}.s`;
let server: Server;
let oxy: OxyServices;
let client: QueryClient;
let useSignLease: typeof import('../hooks/useLeaseQueries').useSignLease;
let leaseKeys: typeof import('../hooks/useLeaseQueries').leaseKeys;
let bindApiToOxy: typeof import('../utils/api').bindApiToOxy;
let seen: { method?: string; url?: string; bearer?: string; body: string }[] = [];
let hold: ((res: ServerResponse) => void) | null = null;
const response = { success: true, data: { id: 'lease-1', note: 'fixture lease' } };
const input = { acceptTerms: true, termsSha256: 'fixture-terms' };

beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, bearer: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    if (hold) hold(res);
    else res.end(JSON.stringify(response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ bindApiToOxy } = jest.requireActual('../utils/api'));
  ({ useSignLease, leaseKeys } = jest.requireActual('../hooks/useLeaseQueries'));
});
beforeEach(() => {
  seen = [];
  hold = null;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  oxy = new OxyServices({ baseURL: mockOrigin });
  oxy.session.setAccessToken(token('A'));
  mockAuth.isAuthenticated = true;
  mockAuth.user = { id: 'A' };
  mockAuth.activeSessionId = 'session-A';
  mockAuth.oxyServices = oxy;
  bindApiToOxy(oxy);
});
afterEach(() => {
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

it('does not send a retained signing action after the account changes', async () => {
  const view = renderHook(() => useSignLease('lease-1'), { wrapper });
  await waitFor(() => expect(view.result.current.isOwnerReady).toBe(true));
  const oldSign = view.result.current.mutateAsync;
  switchToB(() => view.rerender(undefined));
  await act(async () => {
    await expect(oldSign(input)).rejects.toThrow('The active account changed');
  });
  expect(seen).toEqual([]);
});

it('rejects an A request in flight after B and suppresses callbacks and cache writes', async () => {
  let started!: (res: ServerResponse) => void;
  const request = new Promise<ServerResponse>((resolve) => {
    started = resolve;
  });
  hold = started;
  const view = renderHook(() => useSignLease('lease-1'), { wrapper });
  await waitFor(() => expect(view.result.current.isOwnerReady).toBe(true));
  const onSuccess = jest.fn();
  const onError = jest.fn();
  let pending!: Promise<unknown>;
  act(() => {
    pending = view.result.current
      .mutateAsync(input, { onSuccess, onError })
      .catch((error) => error);
  });
  const res = await request;
  switchToB(() => view.rerender(undefined));
  client.setQueryData(leaseKeys.detail('lease-1'), { id: 'lease-1', note: 'B fixture' });
  await act(async () => {
    res.end(JSON.stringify(response));
    expect(await pending).toEqual(
      expect.objectContaining({ message: 'The active account changed' }),
    );
  });
  expect(seen).toHaveLength(1);
  expect(seen[0].bearer).toBe(`Bearer ${token('A')}`);
  expect(client.getQueryData(leaseKeys.detail('lease-1'))).toEqual({
    id: 'lease-1',
    note: 'B fixture',
  });
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it.each(['opaque', 'absent', 'different subject'] as const)(
  'does not offer signing for %s bearer',
  async (kind) => {
    if (kind === 'absent') oxy.session.clear();
    else oxy.session.setAccessToken(kind === 'opaque' ? 'opaque' : token('B'));
    const view = renderHook(() => useSignLease('lease-1'), { wrapper });
    await waitFor(() => expect(view.result.current.isOwnerReady).toBe(false));
    await act(async () => {
      await expect(view.result.current.mutateAsync(input)).rejects.toThrow();
    });
    expect(seen).toEqual([]);
  },
);

it('signs normally for the current account and updates the lease cache', async () => {
  const view = renderHook(() => useSignLease('lease-1'), { wrapper });
  await waitFor(() => expect(view.result.current.isOwnerReady).toBe(true));
  await act(async () => {
    await expect(view.result.current.mutateAsync(input)).resolves.toEqual(response.data);
  });
  expect(seen).toEqual([
    {
      method: 'POST',
      url: '/api/leases/lease-1/sign',
      bearer: `Bearer ${token('A')}`,
      body: JSON.stringify(input),
    },
  ]);
  expect(client.getQueryData(leaseKeys.detail('lease-1'))).toEqual(response.data);
});

it('keeps the original lease target when the hook changes lease while signing', async () => {
  let started!: (res: ServerResponse) => void;
  const request = new Promise<ServerResponse>((resolve) => {
    started = resolve;
  });
  hold = started;
  const view = renderHook(({ id }: { id: string }) => useSignLease(id), {
    wrapper,
    initialProps: { id: 'lease-1' },
  });
  await waitFor(() => expect(view.result.current.isOwnerReady).toBe(true));
  let pending!: Promise<unknown>;
  act(() => {
    pending = view.result.current.mutateAsync(input);
  });
  const res = await request;
  act(() => view.rerender({ id: 'lease-2' }));
  await act(async () => {
    res.end(JSON.stringify(response));
    await pending;
  });
  expect(seen[0].url).toBe('/api/leases/lease-1/sign');
  expect(client.getQueryData(leaseKeys.detail('lease-1'))).toEqual(response.data);
  expect(client.getQueryData(leaseKeys.detail('lease-2'))).toBeUndefined();
});

it.each(['terminate', 'delete'] as const)(
  'does not send a retained %s action after the account changes',
  async (kind) => {
    const { useTerminateLease, useDeleteLease } = jest.requireActual<
      typeof import('../hooks/useLeaseQueries')
    >('../hooks/useLeaseQueries');
    const view = renderHook(
      () => ({ terminate: useTerminateLease('lease-1'), remove: useDeleteLease() }),
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.terminate.isOwnerReady).toBe(true));
    const terminate = view.result.current.terminate.mutateAsync;
    const remove = view.result.current.remove.mutateAsync;
    switchToB(() => view.rerender(undefined));
    await act(async () => {
      const attempt = kind === 'terminate' ? terminate({}) : remove('lease-1');
      await expect(attempt).rejects.toThrow('The active account changed');
    });
    expect(seen).toEqual([]);
  },
);

it.each(['terminate', 'delete'] as const)(
  'suppresses late %s results after switching from A to B',
  async (kind) => {
    const { useTerminateLease, useDeleteLease } = jest.requireActual<
      typeof import('../hooks/useLeaseQueries')
    >('../hooks/useLeaseQueries');
    let started!: (res: ServerResponse) => void;
    const request = new Promise<ServerResponse>((resolve) => {
      started = resolve;
    });
    hold = started;
    const view = renderHook(
      () => ({ terminate: useTerminateLease('lease-1'), remove: useDeleteLease() }),
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.terminate.isOwnerReady).toBe(true));
    const onSuccess = jest.fn();
    const onError = jest.fn();
    let pending!: Promise<unknown>;
    act(() => {
      pending = (
        kind === 'terminate'
          ? view.result.current.terminate.mutateAsync({}, { onSuccess, onError })
          : view.result.current.remove.mutateAsync('lease-1', { onSuccess, onError })
      ).catch((error) => error);
    });
    const res = await request;
    switchToB(() => view.rerender(undefined));
    client.setQueryData(leaseKeys.detail('lease-1'), { id: 'lease-1', note: 'B fixture' });
    await act(async () => {
      res.end(JSON.stringify(response));
      expect(await pending).toEqual(
        expect.objectContaining({ message: 'The active account changed' }),
      );
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].bearer).toBe(`Bearer ${token('A')}`);
    expect(client.getQueryData(leaseKeys.detail('lease-1'))).toEqual({
      id: 'lease-1',
      note: 'B fixture',
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  },
);

it.each(['terminate', 'delete'] as const)(
  'performs %s normally for the same account',
  async (kind) => {
    const { useTerminateLease, useDeleteLease } = jest.requireActual<
      typeof import('../hooks/useLeaseQueries')
    >('../hooks/useLeaseQueries');
    const view = renderHook(
      () => ({ terminate: useTerminateLease('lease-1'), remove: useDeleteLease() }),
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.terminate.isOwnerReady).toBe(true));
    client.setQueryData(leaseKeys.detail('lease-1'), { id: 'lease-1', note: 'before' });
    await act(async () => {
      if (kind === 'terminate')
        await expect(view.result.current.terminate.mutateAsync({})).resolves.toEqual(response.data);
      else await expect(view.result.current.remove.mutateAsync('lease-1')).resolves.toBeUndefined();
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe(kind === 'terminate' ? 'POST' : 'DELETE');
    expect(seen[0].url).toBe(
      kind === 'terminate' ? '/api/leases/lease-1/terminate' : '/api/leases/lease-1',
    );
    expect(seen[0].bearer).toBe(`Bearer ${token('A')}`);
    expect(client.getQueryData(leaseKeys.detail('lease-1'))).toEqual(
      kind === 'terminate' ? response.data : undefined,
    );
  },
);
