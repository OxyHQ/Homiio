/** @jest-environment ./test/http-environment.cjs */
import type React from 'react';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';

let mockOrigin = '';
const mockAuth = {
  isAuthenticated: true,
  user: { id: 'A' } as { id: string } | null,
  activeSessionId: 'session-A' as string | null,
  oxyServices: null as unknown as OxyServices,
  openAccountDialog: jest.fn(),
};
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
let mockLatestSave: (() => void) | undefined;
let mockLatestEdit: (() => void) | undefined;
jest.mock('@/config', () => ({ API_URL: mockOrigin }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => mockAuth }));
jest.mock('@oxy.so/bloom/toast', () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('i18next', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@oxy.so/bloom/app-shell', () => ({ AppShellMenuButton: () => null }));
jest.mock('@oxy.so/bloom/page-header', () => ({
  PageHeader: ({ actions }: { actions: React.ReactNode }) => {
    const { View } = require('react-native');
    return <View>{actions}</View>;
  },
}));
jest.mock('@oxy.so/bloom/screen', () => ({
  Screen: ({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) => {
    const { View } = require('react-native');
    return (
      <View>
        {header}
        {children}
      </View>
    );
  },
  ScreenScrollView: ({ children }: { children: React.ReactNode }) => {
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));
jest.mock('@oxy.so/bloom/button', () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => {
    const { Pressable, Text } = require('react-native');
    if (children === 'Save') mockLatestSave = onPress;
    return (
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}>
        <Text>{children}</Text>
      </Pressable>
    );
  },
}));
jest.mock('@oxy.so/bloom/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TabsTrigger: () => null,
}));
jest.mock('@/components/ui/skeletons/ProfileSkeleton', () => ({
  ProfileSkeleton: () => {
    const { Text } = require('react-native');
    return <Text>profile-loading</Text>;
  },
}));
jest.mock('@/components/ui/ErrorState', () => ({
  ErrorState: ({ title }: { title: string }) => {
    const { Text } = require('react-native');
    return <Text>{title}</Text>;
  },
}));
jest.mock('@/components/profile/edit/PersonalProfileSections', () => ({
  PersonalProfileSections: ({
    personalInfo,
    updatePersonalInfo,
  }: {
    personalInfo: { bio: string };
    updatePersonalInfo: (v: { bio: string }) => void;
  }) => {
    const { Pressable, Text, View } = require('react-native');
    mockLatestEdit = () => updatePersonalInfo({ bio: 'edited-draft' });
    return (
      <View>
        <Text testID="profile-bio">{personalInfo.bio}</Text>
        <Pressable accessibilityRole="button" onPress={mockLatestEdit}>
          <Text>Edit draft</Text>
        </Pressable>
      </View>
    );
  },
}));
jest.mock('@/hooks/profile/useProfileEditTabs', () => ({
  useProfileEditTabs: () => ({ activeSection: 'personal', setActiveSection: () => {}, tabs: [] }),
}));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));

const token = (id: string, nonce = 'first') =>
  `h.${Buffer.from(JSON.stringify({ userId: id, sessionId: `session-${id}`, exp: 4102444800, nonce })).toString('base64url')}.s`;
let server: Server;
let oxy: OxyServices;
let client: QueryClient;
let ProfileEditScreen: typeof import('../app/(pages)/(tabs)/profile/edit').default;
let bindApiToOxy: typeof import('../utils/api').bindApiToOxy;
let requests: Array<{ method: string; owner: string; bio?: string }> = [];
let holdGetB = false;
let holdPutA = false;
let pendingGetB: ServerResponse | undefined;
let pendingPutA: ServerResponse | undefined;

beforeAll(async () => {
  Object.assign(globalThis, Reflect.get(globalThis, '__realHttp'));
  server = createServer(async (req, res) => {
    const bearer = req.headers.authorization;
    const owner =
      bearer === `Bearer ${token('A')}` ? 'A' : bearer === `Bearer ${token('B')}` ? 'B' : 'unknown';
    if (req.method === 'GET') {
      requests.push({ method: 'GET', owner });
      if (owner === 'B' && holdGetB) {
        pendingGetB = res;
        return;
      }
      respondProfile(res, owner);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({
      method: req.method ?? '',
      owner,
      bio: body.personalProfile?.personalInfo?.bio,
    });
    if (owner === 'A' && holdPutA) {
      pendingPutA = res;
      return;
    }
    respondProfile(res, owner, body.personalProfile?.personalInfo?.bio);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ bindApiToOxy } = jest.requireActual('../utils/api'));
  ProfileEditScreen = jest.requireActual('../app/(pages)/(tabs)/profile/edit').default;
});
function respondProfile(res: ServerResponse, owner: string, bio = `draft-${owner}`) {
  if (res.destroyed) return;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      success: true,
      data: {
        id: `profile-${owner}`,
        oxyUserId: owner,
        personalProfile: { personalInfo: { bio } },
      },
    }),
  );
}
beforeEach(() => {
  requests = [];
  holdGetB = false;
  holdPutA = false;
  pendingGetB = undefined;
  pendingPutA = undefined;
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  mockAuth.openAccountDialog.mockReset();
  mockLatestSave = undefined;
  mockLatestEdit = undefined;
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 300000, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
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
  pendingGetB?.destroy();
  pendingPutA?.destroy();
  cleanup();
  client.clear();
  oxy.dispose();
  onlineManager.setOnline(true);
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function wrap() {
  return (
    <QueryClientProvider client={client}>
      <ProfileEditScreen />
    </QueryClientProvider>
  );
}
async function switchTo(id: 'A' | 'B', rerender: (v: React.ReactElement) => void) {
  await act(async () => {
    oxy.session.setAccessToken(token(id));
    mockAuth.user = { id };
    mockAuth.activeSessionId = `session-${id}`;
    rerender(wrap());
  });
}
async function loadA() {
  const screen = render(wrap());
  await waitFor(() => expect(screen.getByTestId('profile-bio').props.children).toBe('draft-A'));
  return screen;
}

it('keeps A drafts and retained submit out of B while B is loading, then saves B normally', async () => {
  const screen = await loadA();
  fireEvent.press(screen.getByRole('button', { name: 'Edit draft' }));
  expect(screen.getByTestId('profile-bio').props.children).toBe('edited-draft');
  const oldSave = mockLatestSave;
  const oldEdit = mockLatestEdit;
  expect(oldSave).toBeDefined();
  expect(oldEdit).toBeDefined();
  holdGetB = true;
  await switchTo('B', screen.rerender);
  expect(screen.queryByTestId('profile-bio')).toBeNull();
  await waitFor(() => expect(pendingGetB).toBeDefined());
  await act(async () => {
    oldSave?.();
  });
  expect(requests.filter((r) => r.method === 'PUT')).toEqual([]);
  await act(async () => {
    if (pendingGetB) respondProfile(pendingGetB, 'B');
  });
  await waitFor(() => expect(screen.getByTestId('profile-bio').props.children).toBe('draft-B'));
  await act(async () => {
    oldEdit?.();
  });
  expect(screen.getByTestId('profile-bio').props.children).toBe('draft-B');
  fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(requests).toContainEqual({ method: 'PUT', owner: 'B', bio: 'draft-B' }),
  );
});

it('does not execute A queued offline with B bearer', async () => {
  const screen = await loadA();
  holdGetB = true;
  onlineManager.setOnline(false);
  fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .some((m) => m.state.isPaused),
    ).toBe(true),
  );
  await switchTo('B', screen.rerender);
  await act(async () => {
    onlineManager.setOnline(true);
    await client.resumePausedMutations();
  });
  expect(requests.filter((r) => r.method === 'PUT')).toEqual([]);
  expect(mockToastSuccess).not.toHaveBeenCalled();
  expect(mockToastError).not.toHaveBeenCalled();
});

it('does not report a late A save into B after A was already sent', async () => {
  const screen = await loadA();
  holdPutA = true;
  fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(pendingPutA).toBeDefined());
  await switchTo('B', screen.rerender);
  await waitFor(() => expect(screen.getByTestId('profile-bio').props.children).toBe('draft-B'));
  await act(async () => {
    if (pendingPutA) respondProfile(pendingPutA, 'A');
  });
  expect(requests).toContainEqual({ method: 'PUT', owner: 'A', bio: 'draft-A' });
  expect(mockToastSuccess).not.toHaveBeenCalled();
  expect(mockToastError).not.toHaveBeenCalled();
  expect(screen.getByTestId('profile-bio').props.children).toBe('draft-B');
});

it('does not revive a retained A submit after A to B to A', async () => {
  const screen = await loadA();
  const oldSave = mockLatestSave;
  expect(oldSave).toBeDefined();
  await switchTo('B', screen.rerender);
  await waitFor(() => expect(screen.getByTestId('profile-bio').props.children).toBe('draft-B'));
  await switchTo('A', screen.rerender);
  await waitFor(() => expect(screen.getByTestId('profile-bio').props.children).toBe('draft-A'));
  await act(async () => {
    oldSave?.();
  });
  expect(requests.filter((r) => r.method === 'PUT')).toEqual([]);
});

it('retains a same-account draft when its session ID arrives later', async () => {
  mockAuth.activeSessionId = null;
  const screen = await loadA();
  fireEvent.press(screen.getByRole('button', { name: 'Edit draft' }));
  await act(async () => {
    mockAuth.activeSessionId = 'session-A';
    screen.rerender(wrap());
  });
  expect(screen.getByTestId('profile-bio').props.children).toBe('edited-draft');
  expect(requests.filter((r) => r.method === 'GET')).toEqual([{ method: 'GET', owner: 'A' }]);
});

it('does not load an editor when the bearer subject cannot be verified locally', async () => {
  oxy.session.setAccessToken('opaque-bearer');
  const screen = render(wrap());
  expect(screen.queryByTestId('profile-bio')).toBeNull();
  expect(requests).toEqual([]);
});
