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
let requestMethods: string[] = [];
let realFetchProfile: ReturnType<typeof useProfileStore.getState>['fetchProfile'];
let holdA: ((response: ServerResponse) => void) | null = null;
let holdB: ((response: ServerResponse) => void) | null = null;
let statusA = 200;
let immediateAStatus = 200;

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
    requestMethods.push(`${req.method} ${who}`);
    const ordinal = requests.filter((value) => value === who).length;
    res.writeHead(who === 'A' ? (holdA ? statusA : immediateAStatus) : 200, {
      'Content-Type': 'application/json',
    });
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
  realFetchProfile = useProfileStore.getState().fetchProfile;
});

beforeEach(() => {
  requests = [];
  requestMethods = [];
  holdA = null;
  holdB = null;
  statusA = 200;
  immediateAStatus = 200;
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
    fetchProfile: realFetchProfile,
    profile: null,
    profileBinding: null,
    profileUpdatedAt: 0,
    profileRequest: null,
    latestProfileRequest: null,
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

it('does not publish an older same-owner GET after a completed store update', async () => {
  const held = heldRequest();
  const invocations: Promise<unknown>[] = [];
  useProfileStore.setState({
    fetchProfile: (owner) => {
      const promise = realFetchProfile(owner);
      invocations.push(promise);
      return promise;
    },
  });
  renderHook(() => useProfile(), { wrapper });
  const oldResponse = await held;
  expect(requestMethods).toEqual(['GET A']);
  expect(invocations).toHaveLength(1);
  const first = invocations[0];
  first.catch(() => undefined);
  const owner = useProfileStore.getState().profileRequest?.owner;
  if (!owner) throw new Error('Expected the pending owner');
  await act(async () => {
    await useProfileStore.getState().updateProfile({}, owner);
  });
  expect(requestMethods).toEqual(['GET A', 'PUT A']);
  expect(useProfileStore.getState().profile).toEqual(expect.objectContaining({ note: 'A-2' }));
  await act(async () => {
    oldResponse.end(`${JSON.stringify({ oxyUserId: 'A', note: 'old-before-update' })}}`);
    await expect(first).rejects.toThrow('A newer profile request superseded this one');
    await waitFor(() => {
      const query = client
        .getQueryCache()
        .find({ queryKey: ['profile', 'me', 'provider-v2', 'session-A'], exact: false });
      expect(query?.state.fetchStatus).toBe('idle');
    });
  });
  expect(useProfileStore.getState().profile).toEqual(expect.objectContaining({ note: 'A-2' }));
});

it('does not publish the older of two same-owner refreshes', async () => {
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() =>
    expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-1' })),
  );
  const held = heldRequest();
  expect(requestMethods).toEqual(['GET A']);
  let older!: Promise<unknown>;
  act(() => {
    older = view.result.current.refreshProfile();
    older.catch(() => undefined);
  });
  const oldResponse = await held;
  expect(requestMethods).toEqual(['GET A', 'GET A']);
  await act(async () => {
    await view.result.current.refreshProfile();
  });
  expect(requestMethods).toEqual(['GET A', 'GET A', 'GET A']);
  expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-3' }));
  await act(async () => {
    oldResponse.end(`${JSON.stringify({ oxyUserId: 'A', note: 'old-before-refresh' })}}`);
    await expect(older).rejects.toThrow('A newer profile request superseded this one');
  });
  expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-3' }));
  const cached = client
    .getQueryCache()
    .findAll({ queryKey: ['profile', 'me', 'provider-v2', 'session-A'] });
  expect(cached).toHaveLength(1);
  expect(cached[0].state.data).toBe(true);
});

it('does not publish an older success when the newer refresh failed', async () => {
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() =>
    expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-1' })),
  );
  const held = heldRequest();
  let older!: Promise<unknown>;
  act(() => {
    older = view.result.current.refreshProfile();
    older.catch(() => undefined);
  });
  const oldResponse = await held;
  immediateAStatus = 503;
  await act(async () => {
    await expect(view.result.current.refreshProfile()).rejects.toThrow();
  });
  await act(async () => {
    oldResponse.end(`${JSON.stringify({ oxyUserId: 'A', note: 'old-after-error' })}}`);
    await expect(older).rejects.toThrow('A newer profile request superseded this one');
  });
  expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-1' }));
  const cached = client
    .getQueryCache()
    .findAll({ queryKey: ['profile', 'me', 'provider-v2', 'session-A'] });
  expect(cached).toHaveLength(1);
  expect(cached[0].state.data).toBe(true);
  expect(useProfileStore.getState().error).not.toBeNull();
});

it('keeps an accepted write when a later-started read completed before the write response', async () => {
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() =>
    expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-1' })),
  );
  const owner = useProfileStore.getState().latestProfileRequest?.owner;
  if (!owner) throw new Error('Expected a current owner');
  const heldWrite = heldRequest();
  let write!: Promise<unknown>;
  act(() => {
    write = useProfileStore.getState().updateProfile({}, owner);
  });
  const writeResponse = await heldWrite;
  expect(requestMethods).toEqual(['GET A', 'PUT A']);
  await act(async () => {
    await view.result.current.refreshProfile();
  });
  expect(requestMethods).toEqual(['GET A', 'PUT A', 'GET A']);
  expect(useProfileStore.getState().profile).toEqual(expect.objectContaining({ note: 'A-3' }));
  await act(async () => {
    writeResponse.end(`${JSON.stringify({ oxyUserId: 'A', note: 'accepted-write' })}}`);
    await write;
  });
  expect(useProfileStore.getState().profile).toEqual(
    expect.objectContaining({ note: 'accepted-write' }),
  );
  expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'accepted-write' }));
});

it('discards a later-started read that completes after an accepted write', async () => {
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() =>
    expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-1' })),
  );
  const owner = useProfileStore.getState().latestProfileRequest?.owner;
  if (!owner) throw new Error('Expected a current owner');
  const heldWrite = heldRequest();
  let write!: Promise<unknown>;
  act(() => {
    write = useProfileStore.getState().updateProfile({}, owner);
  });
  const writeResponse = await heldWrite;
  const heldRead = heldRequest();
  let read!: Promise<unknown>;
  act(() => {
    read = view.result.current.refreshProfile();
    read.catch(() => undefined);
  });
  const readResponse = await heldRead;
  expect(requestMethods).toEqual(['GET A', 'PUT A', 'GET A']);
  await act(async () => {
    writeResponse.end(`${JSON.stringify({ oxyUserId: 'A', note: 'accepted-write' })}}`);
    await write;
  });
  await act(async () => {
    readResponse.end(`${JSON.stringify({ oxyUserId: 'A', note: 'old-before-write' })}}`);
    await expect(read).rejects.toThrow('A newer profile request superseded this one');
  });
  expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'accepted-write' }));
});

it('keeps the actual write error when a later read completes first', async () => {
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() =>
    expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-1' })),
  );
  const owner = useProfileStore.getState().latestProfileRequest?.owner;
  if (!owner) throw new Error('Expected a current owner');
  statusA = 503;
  const heldWrite = heldRequest();
  let write!: Promise<unknown>;
  act(() => {
    write = useProfileStore.getState().updateProfile({}, owner);
    write.catch(() => undefined);
  });
  const writeResponse = await heldWrite;
  await act(async () => {
    await view.result.current.refreshProfile();
  });
  expect(requestMethods).toEqual(['GET A', 'PUT A', 'GET A']);
  await act(async () => {
    writeResponse.end(`${JSON.stringify({ oxyUserId: 'A' })}}`);
    const error = await write.catch((reason) => reason);
    if (!(error instanceof Error)) throw new Error('Expected the write to reject with an error');
    expect(error.message).not.toContain('superseded');
  });
  expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-3' }));
});

it('retains the underlying failure on a superseded read without replacing the newer data', async () => {
  const view = renderHook(() => useProfile(), { wrapper });
  await waitFor(() =>
    expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-1' })),
  );
  statusA = 503;
  const held = heldRequest();
  let old!: Promise<unknown>;
  act(() => {
    old = view.result.current.refreshProfile();
    old.catch(() => undefined);
  });
  const oldResponse = await held;
  await act(async () => {
    await view.result.current.refreshProfile();
  });
  await act(async () => {
    oldResponse.end(`${JSON.stringify({ oxyUserId: 'A' })}}`);
    const error = await old.catch((reason) => reason);
    if (!(error instanceof Error)) throw new Error('Expected the read to reject with an error');
    expect(error.message).toBe('A newer profile request superseded this one');
    expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
  });
  expect(view.result.current.profile).toEqual(expect.objectContaining({ note: 'A-3' }));
});
