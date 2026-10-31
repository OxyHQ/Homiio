import { Suspense, startTransition, type ReactNode } from 'react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import { OxyServices } from '@oxy.so/core';

import { useEarnings, useJoinPartner, usePartnerMe, useReferrals } from '@/hooks/usePartner';
import { partnerApi } from '@/services/partnerApi';
import { useAccountOwner } from '@/hooks/useAccountOwner';

const mockAuth = {
  isAuthenticated: true,
  user: { id: 'A' } as { id: string } | null,
  activeSessionId: 'session-A' as string | null,
  oxyServices: null as unknown as OxyServices,
};

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => mockAuth }));
jest.mock('@/services/partnerApi', () => ({
  partnerApi: {
    getMe: jest.fn(),
    join: jest.fn(),
    getReferrals: jest.fn(),
    getEarnings: jest.fn(),
  },
}));
jest.mock('@/services/propertyService', () => ({ propertyService: {} }));

const getMe = partnerApi.getMe as jest.MockedFunction<typeof partnerApi.getMe>;
const join = partnerApi.join as jest.MockedFunction<typeof partnerApi.join>;
const response = (id: string) =>
  ({
    partner: { id },
    link: `https://example.test/${id}`,
    stats: {},
  }) as Awaited<ReturnType<typeof partnerApi.getMe>>;

let client: QueryClient;
let oxy: OxyServices;
const token = (userId: string, nonce = 'first') =>
  `h.${Buffer.from(JSON.stringify({ userId, sessionId: `session-${userId}`, exp: 4102444800, nonce })).toString('base64url')}.s`;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  mockAuth.isAuthenticated = true;
  mockAuth.user = { id: 'A' };
  mockAuth.activeSessionId = 'session-A';
  oxy = new OxyServices({ baseURL: 'https://example.test' });
  oxy.session.setAccessToken(token('A'));
  mockAuth.oxyServices = oxy;
  getMe.mockReset();
  join.mockReset();
  jest.mocked(partnerApi.getReferrals).mockReset();
  jest.mocked(partnerApi.getEarnings).mockReset();
});
afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
  oxy.dispose();
});

it('does not show account A partner data while B is loading', async () => {
  getMe.mockResolvedValueOnce(response('A')).mockImplementationOnce(() => new Promise(() => {}));
  const view = renderHook(() => usePartnerMe(), { wrapper });
  await waitFor(() => expect(view.result.current.data).toEqual(response('A')));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  expect(view.result.current.data).toBeUndefined();
  await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
});

it('does not expose the cached partner on logout', async () => {
  getMe.mockResolvedValue(response('A'));
  const view = renderHook(() => usePartnerMe(), { wrapper });
  await waitFor(() => expect(view.result.current.data).toEqual(response('A')));
  act(() => {
    oxy.session.clear();
    mockAuth.isAuthenticated = false;
    mockAuth.user = null;
    mockAuth.activeSessionId = null;
    view.rerender(undefined);
  });
  expect(view.result.current.data).toBeUndefined();
});

async function assertAccountSwitch(hook: () => { data: unknown }, getMock: jest.Mock) {
  getMock.mockResolvedValueOnce([{ id: 'A' }]).mockImplementationOnce(() => new Promise(() => {}));
  const view = renderHook(hook, { wrapper });
  await waitFor(() => expect(view.result.current.data).toEqual([{ id: 'A' }]));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  expect(view.result.current.data).toBeUndefined();
  await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
}

it('does not show A referrals while B is loading', async () => {
  await assertAccountSwitch(() => useReferrals(true), partnerApi.getReferrals as jest.Mock);
});

it('does not show A earnings while B is loading', async () => {
  await assertAccountSwitch(() => useEarnings(true), partnerApi.getEarnings as jest.Mock);
});

it('does not put a late A join result into B partner cache', async () => {
  let complete!: (value: Awaited<ReturnType<typeof partnerApi.join>>) => void;
  join.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  getMe.mockResolvedValueOnce(response('A')).mockResolvedValueOnce(response('B'));
  const view = renderHook(() => ({ me: usePartnerMe(), join: useJoinPartner() }), { wrapper });
  await waitFor(() => expect(view.result.current.me.data).toEqual(response('A')));
  act(() => view.result.current.join.mutate());
  await waitFor(() => expect(join).toHaveBeenCalledTimes(1));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.me.data).toEqual(response('B')));
  await act(async () => {
    complete(response('A-joined'));
  });
  expect(view.result.current.me.data).toEqual(response('B'));
});

it('does not request A data using a bearer for B', () => {
  oxy.session.setAccessToken(token('B'));
  const view = renderHook(() => ({ me: usePartnerMe(), join: useJoinPartner() }), { wrapper });
  expect(view.result.current.me.data).toBeUndefined();
  expect(view.result.current.join.isOwnerReady).toBe(false);
  expect(getMe).not.toHaveBeenCalled();
});

it('preserves cached data on a same-session bearer refresh', async () => {
  getMe.mockResolvedValue(response('A'));
  const view = renderHook(() => usePartnerMe(), { wrapper });
  await waitFor(() => expect(view.result.current.data).toEqual(response('A')));
  act(() => oxy.session.setAccessToken(token('A', 'refreshed')));
  expect(view.result.current.data).toEqual(response('A'));
  expect(getMe).toHaveBeenCalledTimes(1);
});

it('does not restore an old A response after an observed A to B to A switch', async () => {
  let complete!: (value: Awaited<ReturnType<typeof partnerApi.getMe>>) => void;
  getMe
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValueOnce(response('B'))
    .mockResolvedValueOnce(response('A-new'));
  const view = renderHook(() => usePartnerMe(), { wrapper });
  await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.data).toEqual(response('B')));
  act(() => {
    oxy.session.setAccessToken(token('A', 'returned'));
    mockAuth.user = { id: 'A' };
    mockAuth.activeSessionId = 'session-A';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.data).toEqual(response('A-new')));
  await act(async () => {
    complete(response('A-old'));
  });
  expect(view.result.current.data).toEqual(response('A-new'));
});

it('loads a matching account before its projected session id is available', async () => {
  mockAuth.activeSessionId = null;
  getMe.mockResolvedValue(response('A'));
  const view = renderHook(() => ({ me: usePartnerMe(), join: useJoinPartner() }), { wrapper });
  await waitFor(() => expect(view.result.current.me.data).toEqual(response('A')));
  expect(view.result.current.join.isOwnerReady).toBe(true);
  act(() => oxy.session.setAccessToken(token('A', 'refreshed')));
  expect(view.result.current.me.data).toEqual(response('A'));
  expect(getMe).toHaveBeenCalledTimes(1);
});

it('finishes a join when the same account receives its session id during recovery', async () => {
  mockAuth.activeSessionId = null;
  getMe.mockResolvedValue(response('A-before'));
  let complete!: (value: Awaited<ReturnType<typeof partnerApi.join>>) => void;
  join.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const view = renderHook(() => ({ me: usePartnerMe(), join: useJoinPartner() }), { wrapper });
  await waitFor(() => expect(view.result.current.me.data).toEqual(response('A-before')));
  let pending!: Promise<unknown>;
  act(() => {
    pending = view.result.current.join.mutateAsync();
  });
  await waitFor(() => expect(join).toHaveBeenCalledTimes(1));
  act(() => {
    mockAuth.activeSessionId = 'session-A';
    view.rerender(undefined);
  });
  await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
  await act(async () => {
    complete(response('A'));
    await expect(pending).resolves.toEqual(response('A'));
  });
  await waitFor(() => expect(view.result.current.me.data).toEqual(response('A')));
});

it('rejects a retained join action after switching accounts', async () => {
  const view = renderHook(() => useJoinPartner(), { wrapper });
  const old = view.result.current.mutateAsync;
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await act(async () => {
    await expect(old()).rejects.toThrow('The active account changed');
  });
  expect(join).not.toHaveBeenCalled();
});

it('delivers a successful join callback and caches only the current owner', async () => {
  getMe.mockResolvedValue(response('A-before'));
  join.mockResolvedValue(response('A'));
  const callback = jest.fn();
  const view = renderHook(() => ({ me: usePartnerMe(), join: useJoinPartner() }), { wrapper });
  await waitFor(() => expect(view.result.current.me.data).toEqual(response('A-before')));
  act(() => view.result.current.join.mutate(undefined, { onSuccess: callback }));
  await waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(view.result.current.me.data).toEqual(response('A')));
  expect(client.getQueriesData({ queryKey: ['partner'] })).toEqual([
    [expect.arrayContaining(['A', 'session-A', 'me']), response('A')],
  ]);
});

it('rejects a completion when B is projected before its bearer arrives', async () => {
  let complete!: (value: Awaited<ReturnType<typeof partnerApi.join>>) => void;
  join.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const view = renderHook(() => useJoinPartner(), { wrapper });
  let pending!: Promise<unknown>;
  act(() => {
    pending = view.result.current.mutateAsync();
  });
  const rejected = expect(pending).rejects.toThrow('The active account changed');
  await waitFor(() => expect(join).toHaveBeenCalledTimes(1));
  act(() => {
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await act(async () => {
    complete(response('A'));
    await rejected;
  });
  expect(client.getQueryCache().findAll({ queryKey: ['partner'] })).toHaveLength(0);
});

it('allows an accepted offline join to resume after unmount for the same session', async () => {
  client.setDefaultOptions({ mutations: { networkMode: 'online', gcTime: 0 } });
  client.mount();
  onlineManager.setOnline(false);
  join.mockResolvedValue(response('A'));
  const view = renderHook(() => useJoinPartner(), { wrapper });
  let pending!: Promise<unknown>;
  act(() => {
    pending = view.result.current.mutateAsync();
  });
  await waitFor(() => expect(view.result.current.isPaused).toBe(true));
  view.unmount();
  onlineManager.setOnline(true);
  await expect(pending).resolves.toEqual(response('A'));
  expect(join).toHaveBeenCalledTimes(1);
  client.unmount();
});

it('rejects a retained join after an observed projection-only A to B to A transition', async () => {
  const view = renderHook(() => useJoinPartner(), { wrapper });
  const old = view.result.current.mutateAsync;
  act(() => {
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  act(() => {
    mockAuth.user = { id: 'A' };
    mockAuth.activeSessionId = 'session-A';
    view.rerender(undefined);
  });
  await act(async () => {
    await expect(old()).rejects.toThrow('The active account changed');
  });
  expect(join).not.toHaveBeenCalled();
});

it('keeps the committed A owner valid when a B render suspends and is abandoned', async () => {
  join.mockResolvedValue(response('A'));
  const active = renderHook(() => useJoinPartner(), { wrapper });
  const retained = active.result.current.mutateAsync;
  let resume!: () => void;
  const pending = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const attempted = jest.fn();
  function Candidate({ suspend }: { suspend: boolean }) {
    useAccountOwner();
    if (suspend) attempted();
    if (suspend) throw pending;
    return null;
  }
  const candidate = render(
    <Suspense fallback={null}>
      <Candidate suspend={false} />
    </Suspense>,
  );
  act(() => {
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    startTransition(() =>
      candidate.rerender(
        <Suspense fallback={null}>
          <Candidate suspend />
        </Suspense>,
      ),
    );
  });
  expect(attempted).toHaveBeenCalled();
  mockAuth.user = { id: 'A' };
  mockAuth.activeSessionId = 'session-A';
  await act(async () => {
    await expect(retained()).resolves.toEqual(response('A'));
  });
  candidate.unmount();
  await act(async () => {
    resume();
    await pending;
  });
});
