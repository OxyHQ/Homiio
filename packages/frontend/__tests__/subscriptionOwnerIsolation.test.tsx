/** @jest-environment ./test/http-environment.cjs */
import type React from 'react';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Linking } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';

let mockOrigin = '';
const mockAuth = {
  isAuthenticated: true,
  user: { id: 'A' },
  activeSessionId: 'session-A',
  oxyServices: null as unknown as OxyServices,
};
let mockConfirm: (value: boolean) => void = () => {};
let mockRetainedCancel: (() => void) | undefined;
let mockRetainedCheckout: (() => void) | undefined;
const mockConfirmStarted = jest.fn();
const mockOpen = jest.fn(async () => {});
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock('@/config', () => ({ API_URL: mockOrigin }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => mockAuth }));
jest.mock('expo-router', () => ({ useRouter: () => ({ canGoBack: () => false }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'subscriptions.loadFailed'
        ? require('@/locales/en.json').subscriptions.loadFailed
        : key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: mockToast }));
jest.mock('@oxy.so/bloom/surfaces', () => ({
  confirm: () => {
    mockConfirmStarted();
    return new Promise<boolean>((resolve) => {
      mockConfirm = resolve;
    });
  },
}));
jest.mock('@oxy.so/bloom/theme', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('@oxy.so/bloom/app-shell', () => ({ AppShellMenuButton: () => null }));
jest.mock('@oxy.so/bloom/page-header', () => ({ PageHeader: () => null }));
jest.mock('@oxy.so/bloom/icon-circle', () => ({ IconCircle: () => null }));
jest.mock('@oxy.so/bloom/badge', () => ({ Badge: () => null }));
jest.mock('@oxy.so/bloom/icons/RiCheckboxCircleFill', () => ({ RiCheckboxCircleFill: () => null }));
jest.mock('@oxy.so/bloom/icons/RiFileTextLine', () => ({ RiFileTextLine: () => null }));
jest.mock('@oxy.so/bloom/icons/RiHeartLine', () => ({ RiHeartLine: () => null }));
jest.mock('@oxy.so/bloom/icons/RiStarLine', () => ({ RiStarLine: () => null }));
jest.mock('@oxy.so/bloom/admonition', () => ({
  Admonition: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@oxy.so/bloom/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@oxy.so/bloom/screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ScreenScrollView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@oxy.so/bloom/typography', () => {
  const { Text } = require('react-native');
  return { H1: Text, H3: Text, Text };
});
jest.mock('@oxy.so/bloom/button', () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => {
    const { Pressable, Text } = require('react-native');
    if (children === 'subscriptions.page.founder.becomeSupporter') mockRetainedCheckout = onPress;
    return (
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Text>{children}</Text>
      </Pressable>
    );
  },
}));
jest.mock('@oxy.so/bloom/settings-list', () => ({
  SettingsListGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SettingsListItem: ({ title, onPress }: { title: string; onPress?: () => void }) => {
    const { Pressable, Text } = require('react-native');
    if (title === 'Cancel Immediately') mockRetainedCancel = onPress;
    return (
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    );
  },
}));
jest.mock('@/components/ui/ErrorState', () => ({
  ErrorState: ({
    title,
    retryLabel,
    onRetry,
  }: {
    title: string;
    retryLabel: string;
    onRetry: () => void;
  }) => {
    const { Text, Pressable } = require('react-native');
    return (
      <>
        <Text>{title}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text>{retryLabel}</Text>
        </Pressable>
      </>
    );
  },
}));
jest.mock('@/components/ui/skeletons/ProfileSkeleton', () => ({ ProfileSkeleton: () => null }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));

const token = (id: string) =>
  `h.${Buffer.from(JSON.stringify({ userId: id, sessionId: `session-${id}`, exp: 4102444800 })).toString('base64url')}.s`;
let server: Server;
let oxy: OxyServices;
let client: QueryClient;
let Screen: typeof import('../app/(pages)/(tabs)/profile/subscriptions').default;
let bind: typeof import('../utils/api').bindApiToOxy;
let mockPost: jest.SpyInstance;
let requests: Array<{ owner: string; path: string; method: string }> = [];
let held: ServerResponse | undefined;
let holdPath = '';
let failEntitlements = false;
let entitlementsOverride: object | undefined;
function respond(res: ServerResponse, data: object) {
  if (!res.destroyed) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
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
    requests.push({ owner, path: req.url ?? '', method: req.method ?? '' });
    if (req.url === '/api/profiles/me/entitlements' && failEntitlements) {
      res.writeHead(503);
      res.end();
      return;
    }
    if (req.url === '/api/profiles/me/entitlements' && entitlementsOverride) {
      respond(res, entitlementsOverride);
      return;
    }
    if (req.url === holdPath) {
      held = res;
      return;
    }
    if (req.url === '/api/profiles/me/entitlements')
      respond(res, {
        success: true,
        entitlements: {
          plusActive: true,
          plusStripeSubscriptionId: `sub-${owner}`,
          fileCredits: 0,
          founderSupporter: false,
          processedSessions: [],
        },
      });
    else
      respond(res, {
        success: true,
        entitlements: { plusActive: false },
        url: 'https://example.invalid/checkout',
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realApi = jest.requireActual('../utils/api');
  bind = realApi.bindApiToOxy;
  mockPost = jest.spyOn(realApi.api, 'post');
  Screen = jest.requireActual('../app/(pages)/(tabs)/profile/subscriptions').default;
  jest.spyOn(Linking, 'openURL').mockImplementation(mockOpen);
});
beforeEach(() => {
  requests = [];
  held = undefined;
  holdPath = '';
  failEntitlements = false;
  entitlementsOverride = undefined;
  mockOpen.mockClear();
  mockPost.mockClear();
  mockConfirmStarted.mockClear();
  mockRetainedCancel = undefined;
  Object.values(mockToast).forEach((fn) => {
    fn.mockClear();
  });
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
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
  held?.destroy();
  cleanup();
  client.clear();
  oxy.dispose();
  onlineManager.setOnline(true);
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function view() {
  return (
    <QueryClientProvider client={client}>
      <Screen />
    </QueryClientProvider>
  );
}
async function switchToB(rerender: (element: React.ReactElement) => void) {
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    rerender(view());
  });
}
it('does not open a portal URL issued for A after switching to B', async () => {
  holdPath = '/api/billing/customer-portal';
  const screen = render(view());
  await waitFor(() => expect(screen.getByText('subscriptions.page.plus.manage')).toBeTruthy());
  fireEvent.press(screen.getByText('subscriptions.page.plus.manage'));
  await waitFor(() => expect(held).toBeDefined());
  await switchToB(screen.rerender);
  await waitFor(() => expect(held?.destroyed).toBe(true));
  await waitFor(() =>
    expect(requests).toContainEqual({
      owner: 'B',
      path: '/api/profiles/me/entitlements',
      method: 'GET',
    }),
  );
  expect(mockOpen).not.toHaveBeenCalled();
  expect(mockToast.error).not.toHaveBeenCalled();
});
it('does not send a cancellation confirmed for A with B bearer', async () => {
  const screen = render(view());
  await waitFor(() => expect(screen.getByText('Cancel Immediately')).toBeTruthy());
  fireEvent.press(screen.getByText('Cancel Immediately'));
  await switchToB(screen.rerender);
  await act(async () => {
    mockConfirm(true);
  });
  expect(mockPost.mock.calls.map((call) => call[0])).not.toContain(
    '/api/billing/cancel-subscription',
  );
});

it('cancels normally when A confirms without a session change', async () => {
  const screen = render(view());
  await waitFor(() => expect(screen.getByText('Cancel Immediately')).toBeTruthy());
  fireEvent.press(screen.getByText('Cancel Immediately'));
  await act(async () => {
    mockConfirm(true);
  });
  await waitFor(() =>
    expect(requests).toContainEqual({
      owner: 'A',
      path: '/api/billing/cancel-subscription',
      method: 'POST',
    }),
  );
  await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
});
it('does not execute a checkout paused in A after switching to B', async () => {
  const screen = render(view());
  await waitFor(() =>
    expect(screen.getByText('subscriptions.page.founder.becomeSupporter')).toBeTruthy(),
  );
  onlineManager.setOnline(false);
  fireEvent.press(screen.getByText('subscriptions.page.founder.becomeSupporter'));
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .some((m) => m.state.isPaused),
    ).toBe(true),
  );
  await switchToB(screen.rerender);
  await act(async () => {
    onlineManager.setOnline(true);
    await client.resumePausedMutations();
  });
  expect(requests.filter((r) => r.path === '/api/billing/checkout')).toEqual([]);
  expect(mockOpen).not.toHaveBeenCalled();
  expect(mockToast.error).not.toHaveBeenCalled();
});

it('refuses a retained cancellation action after A to B to A', async () => {
  const screen = render(view());
  await waitFor(() => expect(screen.getByText('Cancel Immediately')).toBeTruthy());
  const retained = mockRetainedCancel;
  expect(retained).toBeDefined();
  await switchToB(screen.rerender);
  await act(async () => {
    oxy.session.setAccessToken(token('A'));
    mockAuth.user = { id: 'A' };
    mockAuth.activeSessionId = 'session-A';
    screen.rerender(view());
  });
  await waitFor(() => expect(screen.getByText('Cancel Immediately')).toBeTruthy());
  await act(async () => {
    retained?.();
  });
  expect(mockConfirmStarted).not.toHaveBeenCalled();
  expect(requests.filter((r) => r.path === '/api/billing/cancel-subscription')).toEqual([]);
});
it('opens the current account portal normally', async () => {
  const screen = render(view());
  await waitFor(() => expect(screen.getByText('subscriptions.page.plus.manage')).toBeTruthy());
  fireEvent.press(screen.getByText('subscriptions.page.plus.manage'));
  await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('https://example.invalid/checkout'));
  expect(requests).toContainEqual({
    owner: 'A',
    path: '/api/billing/customer-portal',
    method: 'POST',
  });
});
it('opens the current account checkout normally', async () => {
  const screen = render(view());
  await waitFor(() =>
    expect(screen.getByText('subscriptions.page.founder.becomeSupporter')).toBeTruthy(),
  );
  fireEvent.press(screen.getByText('subscriptions.page.founder.becomeSupporter'));
  await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('https://example.invalid/checkout'));
  expect(requests).toContainEqual({ owner: 'A', path: '/api/billing/checkout', method: 'POST' });
});

it('does not open checkout or report an old error after an account change', async () => {
  holdPath = '/api/billing/checkout';
  const screen = render(view());
  await waitFor(() =>
    expect(screen.getByText('subscriptions.page.founder.becomeSupporter')).toBeTruthy(),
  );
  fireEvent.press(screen.getByText('subscriptions.page.founder.becomeSupporter'));
  await waitFor(() => expect(held).toBeDefined());
  await switchToB(screen.rerender);
  await waitFor(() => expect(held?.destroyed).toBe(true));
  await waitFor(() =>
    expect(requests).toContainEqual({
      owner: 'B',
      path: '/api/profiles/me/entitlements',
      method: 'GET',
    }),
  );
  expect(mockOpen).not.toHaveBeenCalled();
  expect(mockToast.error).not.toHaveBeenCalled();
});

it('does not present purchase actions while the first entitlements query is offline', async () => {
  onlineManager.setOnline(false);
  const screen = render(view());
  await waitFor(() => expect(screen.getByText('Could not load your subscription')).toBeTruthy());
  expect(screen.queryByText('subscriptions.page.founder.becomeSupporter')).toBeNull();
  expect(requests.filter((r) => r.path === '/api/profiles/me/entitlements')).toEqual([]);
});

it('describes an entitlements failure as a subscription error and retries', async () => {
  failEntitlements = true;
  const screen = render(view());
  await waitFor(() => expect(screen.getByText('Could not load your subscription')).toBeTruthy());
  expect(screen.queryByText('subscriptions.page.founder.becomeSupporter')).toBeNull();
  failEntitlements = false;
  fireEvent.press(screen.getByText('common.retry'));
  await waitFor(() =>
    expect(screen.getByText('subscriptions.page.founder.becomeSupporter')).toBeTruthy(),
  );
  expect(requests.filter((r) => r.path === '/api/profiles/me/entitlements')).toHaveLength(2);
});

it.each([
  ['missing', { success: true }],
  ['null', { success: true, entitlements: null }],
  [
    'malformed',
    {
      success: true,
      entitlements: {
        plusActive: false,
        fileCredits: 0,
        founderSupporter: false,
        processedSessions: [42],
      },
    },
  ],
])('rejects %s entitlements without presenting a free plan', async (_label, body) => {
  entitlementsOverride = body;
  const screen = render(view());
  await waitFor(() => expect(screen.getByText('Could not load your subscription')).toBeTruthy());
  expect(screen.queryByText('subscriptions.page.plus.subscribeNow')).toBeNull();
});
it('accepts the zeroed free entitlement shape returned by the backend', async () => {
  entitlementsOverride = {
    success: true,
    entitlements: {
      plusActive: false,
      fileCredits: 0,
      founderSupporter: false,
      processedSessions: [],
    },
  };
  const screen = render(view());
  await waitFor(() =>
    expect(screen.getByText('subscriptions.page.plus.subscribeNow')).toBeTruthy(),
  );
});


it('diagnostic: retained checkout can run when entitlements were reset and are pending', async () => {
  const screen = render(view());
  await waitFor(() => expect(screen.getByText('subscriptions.page.founder.becomeSupporter')).toBeTruthy());
  const retained = mockRetainedCheckout;
  expect(retained).toBeDefined();
  holdPath = '/api/profiles/me/entitlements';
  let resetting!: Promise<void>;
  act(() => { resetting = client.resetQueries({ queryKey: ['profiles', 'me', 'entitlements'] }); });
  await waitFor(() => expect(held).toBeDefined());
  await waitFor(() => expect(screen.queryByText('subscriptions.page.founder.becomeSupporter')).toBeNull());
  await act(async () => { retained?.(); });
  await waitFor(() => expect(requests).toContainEqual({ owner: 'A', path: '/api/billing/checkout', method: 'POST' }));
  await act(async () => { respond(held!, { success: true, entitlements: { plusActive: true, fileCredits: 0, founderSupporter: false, processedSessions: [] } }); await resetting; });
});
