/** @jest-environment ./test/http-environment.cjs */
import { StrictMode, type ReactNode } from 'react';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

const token = (id: string) =>
  `h.${Buffer.from(JSON.stringify({ userId: id, sessionId: `session-${id}`, exp: 4102444800 })).toString('base64url')}.s`;
const subjectOnly = (id: string, nonce = 'first') =>
  `h.${Buffer.from(JSON.stringify({ sub: id, sessionId: `session-${id}`, exp: 4102444800, nonce })).toString('base64url')}.s`;
let server: Server;
let oxy: OxyServices;
let client: QueryClient;
let useProfile: typeof import('../context/ProfileContext').useProfile;
let ProfileProvider: typeof import('../context/ProfileContext').ProfileProvider;
let useProfileStore: typeof import('../store/profileStore').useProfileStore;
let bindApiToOxy: typeof import('../utils/api').bindApiToOxy;
let requests: string[] = [];
let holdA: ((response: ServerResponse) => void) | null = null;
let holdB: ((response: ServerResponse) => void) | null = null;
let statusA = 200;

beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer((req, res) => {
    const bearer = req.headers.authorization ?? '';
    const who =
      bearer === `Bearer ${token('A')}` ||
      bearer === `Bearer ${subjectOnly('A')}` ||
      bearer === `Bearer ${subjectOnly('A', 'refreshed')}`
        ? 'A'
        : bearer === `Bearer ${token('B')}` || bearer === `Bearer ${subjectOnly('B')}`
          ? 'B'
          : 'unknown';
    requests.push(who);
    const ordinal = requests.filter((value) => value === who).length;
    res.writeHead(who === 'A' && holdA ? statusA : 200, { 'Content-Type': 'application/json' });
    if (who === 'A' && holdA) {
      res.write('{"success":true,"data":');
      holdA(res);
      holdA = null;
    } else if (who === 'B' && holdB) {
      res.write('{"success":true,"data":');
      holdB(res);
      holdB = null;
    } else {
      res.end(
        JSON.stringify({ success: true, data: { oxyUserId: who, note: `${who}-${ordinal}` } }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ bindApiToOxy } = jest.requireActual('../utils/api'));
  ({ ProfileProvider, useProfile } = jest.requireActual('../context/ProfileContext'));
  ({ useProfileStore } = jest.requireActual('../store/profileStore'));
});

beforeEach(() => {
  requests = [];
  holdA = null;
  holdB = null;
  statusA = 200;
  client = new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst',
        retry: false,
        staleTime: 300000,
        gcTime: 1800000,
        refetchOnWindowFocus: false,
      },
      mutations: { networkMode: 'offlineFirst' },
    },
  });
  oxy = new OxyServices({ baseURL: mockOrigin });
  oxy.session.setAccessToken(token('A'));
  mockAuth.user = { id: 'A' };
  mockAuth.activeSessionId = 'session-A';
  mockAuth.isAuthenticated = true;
  mockAuth.oxyServices = oxy;
  bindApiToOxy(oxy);
  useProfileStore.setState({
    profile: null,
    profileBinding: null,
    profileUpdatedAt: 0,
    profileRequest: null,
    isLoading: false,
    error: null,
  });
});
afterEach(async () => {
  cleanup();
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.state.fetchStatus === 'idle'),
    ).toBe(true),
  );
  client.clear();
  oxy.dispose();
  jest.restoreAllMocks();
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ProfileProvider>{children}</ProfileProvider>
    </QueryClientProvider>
  );
}
function switchTo(id: 'A' | 'B', rerender: () => void) {
  act(() => {
    oxy.session.setAccessToken(token(id));
    mockAuth.user = { id };
    mockAuth.activeSessionId = `session-${id}`;
    rerender();
  });
}
function heldRequest() {
  return new Promise<ServerResponse>((resolve) => {
    holdA = resolve;
  });
}

it.each([200, 500])(
  'does not overwrite B with a late A body or error (HTTP %s)',
  async (status) => {
    statusA = status;
    const held = heldRequest();
    const fetchProfile = jest.spyOn(useProfileStore.getState(), 'fetchProfile');
    const view = renderHook(() => useProfile(), { wrapper });
    const response = await held;
    const pendingA = fetchProfile.mock.results[0].value.catch(() => undefined);
    switchTo('B', () => view.rerender(undefined));
    await waitFor(() => expect(view.result.current.profile?.oxyUserId).toBe('B'));
    await act(async () => {
      response.end(`${JSON.stringify({ oxyUserId: 'A', note: 'late-A' })}}`);
      await pendingA;
    });
    await waitFor(() => expect(requests).toEqual(['A', 'B']));
    expect(view.result.current.profile?.oxyUserId).toBe('B');
    expect(useProfileStore.getState().profile?.oxyUserId).toBe('B');
    expect(useProfileStore.getState().error).toBeNull();
  },
);

it('rejects the first A result after A-to-B-to-A commits', async () => {
  const held = heldRequest();
  const fetchProfile = jest.spyOn(useProfileStore.getState(), 'fetchProfile');
  const view = renderHook(() => useProfile(), { wrapper });
  const response = await held;
  const pendingA = fetchProfile.mock.results[0].value.catch(() => undefined);
  switchTo('B', () => view.rerender(undefined));
  await waitFor(() => expect(view.result.current.profile?.oxyUserId).toBe('B'));
  switchTo('A', () => view.rerender(undefined));
  await waitFor(() =>
    expect(view.result.current.profile).toEqual(
      expect.objectContaining({ oxyUserId: 'A', note: 'A-2' }),
    ),
  );
  await act(async () => {
    response.end(`${JSON.stringify({ oxyUserId: 'A', note: 'old-A' })}}`);
    await pendingA;
  });
  expect(view.result.current.profile).toEqual(
    expect.objectContaining({ oxyUserId: 'A', note: 'A-2' }),
  );
  expect(useProfileStore.getState().profile).toEqual(
    expect.objectContaining({ oxyUserId: 'A', note: 'A-2' }),
  );
});

it('does not clear B loading while B is still waiting after A fails late', async () => {
  statusA = 500;
  const heldA = heldRequest();
  const heldB = new Promise<ServerResponse>((resolve) => {
    holdB = resolve;
  });
  const fetchProfile = jest.spyOn(useProfileStore.getState(), 'fetchProfile');
  const view = renderHook(() => useProfile(), { wrapper });
  const responseA = await heldA;
  const pendingA = fetchProfile.mock.results[0].value.catch(() => undefined);
  switchTo('B', () => view.rerender(undefined));
  const responseB = await heldB;
  const pendingB = fetchProfile.mock.results[1].value;
  await act(async () => {
    responseA.end(`${JSON.stringify({ oxyUserId: 'A' })}}`);
    await pendingA;
  });
  expect(useProfileStore.getState().isLoading).toBe(true);
  expect(useProfileStore.getState().profileRequest?.owner.userId).toBe('B');
  await act(async () => {
    responseB.end(`${JSON.stringify({ oxyUserId: 'B' })}}`);
    await pendingB;
  });
  await waitFor(() => expect(view.result.current.profile?.oxyUserId).toBe('B'));
  expect(useProfileStore.getState().isLoading).toBe(false);
});

it('preserves sub-only bearer compatibility when the returned profile matches', async () => {
  oxy.session.setAccessToken(subjectOnly('A'));
  expect(oxy.session.userId).toBeNull();
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() => expect(view.result.current.profile?.oxyUserId).toBe('A'));
  expect(requests).toEqual(['A']);
});

it('does not attest a bearer subject when only a sub-only token changes', async () => {
  oxy.session.setAccessToken(subjectOnly('A'));
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() => expect(view.result.current.profile?.oxyUserId).toBe('A'));
  act(() => oxy.session.setAccessToken(subjectOnly('B')));
  expect(oxy.session.userId).toBeNull();
  expect(view.result.current.isProfileProjectionCurrent()).toBe(true);
  expect(view.result.current.profile?.oxyUserId).toBe('A');
  expect(requests).toEqual(['A']);
});

it('keeps an already loaded profile through same-session sub-only refresh while offline', async () => {
  oxy.session.setAccessToken(subjectOnly('A'));
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() => expect(view.result.current.profile?.oxyUserId).toBe('A'));
  try {
    onlineManager.setOnline(false);
    act(() => {
      oxy.session.setAccessToken(subjectOnly('A', 'refreshed'));
    });
    expect(view.result.current.profile?.oxyUserId).toBe('A');
    expect(requests).toEqual(['A']);
  } finally {
    onlineManager.setOnline(true);
  }
});

it('does not make a stale same-session profile fresh when the owner generation changes', async () => {
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() => expect(view.result.current.profile?.oxyUserId).toBe('A'));
  act(() => {
    useProfileStore.setState({ profileUpdatedAt: Date.now() - 6 * 60 * 1000 });
  });
  act(() => {
    oxy.session.clear();
    oxy.session.setAccessToken(token('A'));
  });
  await waitFor(() => expect(requests).toEqual(['A', 'A']));
  await waitFor(() =>
    expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-2' })),
  );
});

it('rejects a retained refresh after the account changes', async () => {
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() => expect(view.result.current.profile?.oxyUserId).toBe('A'));
  const refreshA = view.result.current.refreshProfile;
  switchTo('B', () => view.rerender(undefined));
  await waitFor(() => expect(view.result.current.profile?.oxyUserId).toBe('B'));
  await act(async () => {
    await expect(refreshA()).rejects.toThrow('The active account changed');
  });
  expect(requests).toEqual(['A', 'B']);
});

it('loads normally when the provider effects are replayed in StrictMode', async () => {
  const strictWrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <ProfileProvider>{children}</ProfileProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  const view = renderHook(() => useProfile(), { wrapper: strictWrapper });
  await waitFor(() => expect(view.result.current.profile?.oxyUserId).toBe('A'));
});

it('does not store a mismatched profile when the bearer subject is unavailable', async () => {
  oxy.session.setAccessToken(subjectOnly('B'));
  expect(oxy.session.userId).toBeNull();
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() => expect(requests).toEqual(['B']));
  await waitFor(() => expect(useProfileStore.getState().isLoading).toBe(false));
  expect(view.result.current.profile).toBeNull();
  expect(useProfileStore.getState().profile).toBeNull();
});

it('does not start a profile load when the known bearer subject disagrees with the projection', async () => {
  oxy.session.setAccessToken(token('B'));
  const view = renderHook(() => useProfile(), { wrapper });
  await act(async () => {});
  expect(requests).toEqual([]);
  expect(view.result.current.profile).toBeNull();
});

it('does not write after the provider unmounts or retain a loading owner', async () => {
  const held = heldRequest();
  const fetchProfile = jest.spyOn(useProfileStore.getState(), 'fetchProfile');
  const view = renderHook(() => useProfile(), { wrapper });
  const response = await held;
  const pendingA = fetchProfile.mock.results[0].value.catch(() => undefined);
  expect(useProfileStore.getState().isLoading).toBe(true);
  view.unmount();
  expect(useProfileStore.getState().profileRequest).toBeNull();
  expect(useProfileStore.getState().isLoading).toBe(false);
  await act(async () => {
    response.end(`${JSON.stringify({ oxyUserId: 'A' })}}`);
    await pendingA;
  });
  expect(useProfileStore.getState().profile).toBeNull();
});

it('DIAGNOSTIC reproduces an older same-owner GET overwriting a completed profile update', async () => {
  const held = heldRequest();
  const spy = jest.spyOn(useProfileStore.getState(), 'fetchProfile');
  const view = renderHook(() => useProfile(), { wrapper });
  const oldResponse = await held;
  const first = spy.mock.results.at(-1)!.value;
  first.catch(() => undefined);
  const owner = useProfileStore.getState().profileRequest?.owner;
  expect(owner).toBeDefined();
  console.log('DIAGNOSTIC owner before update', owner?.isCurrent(), oxy.http.getSessionEpoch());
  await act(async () => {
    await useProfileStore.getState().updateProfile({}, owner!);
  });
  console.log('DIAGNOSTIC owner after update', owner?.isCurrent(), oxy.http.getSessionEpoch());
  expect(useProfileStore.getState().profile).toEqual(expect.objectContaining({ note: 'A-2' }));
  await act(async () => {
    console.log('DIAGNOSTIC owner before old GET completes', owner?.isCurrent(), oxy.http.getSessionEpoch());
    oldResponse.end(`${JSON.stringify({ oxyUserId: 'A', note: 'old-before-update' })}}`);
    await first;
  });
  expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'old-before-update' }));
});

it('DIAGNOSTIC reproduces reverse completion of two same-owner refreshes', async () => {
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() => expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-1' })));
  const held = heldRequest();
  let older!: Promise<unknown>;
  act(() => { older = view.result.current.refreshProfile(); });
  const oldResponse = await held;
  await act(async () => { await view.result.current.refreshProfile(); });
  expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-3' }));
  await act(async () => {
    oldResponse.end(`${JSON.stringify({ oxyUserId: 'A', note: 'old-before-refresh' })}}`);
    await older;
  });
  expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'old-before-refresh' }));
});
