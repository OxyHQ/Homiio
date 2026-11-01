import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';

let mockAccount: 'A' | 'B' = 'A';
const mockSave = jest.fn();
const mockPreferences = jest.fn();
const mockStatus = jest.fn();
const mockProfile = jest.fn();
const mockProfileUpdate = jest.fn();
const mockSetProfile = jest.fn();
let mockOxy: OxyServices;
const mockAuth = {
  oxyServices: null as unknown as OxyServices,
  activeSessionId: 'session-A',
  isAuthenticated: true,
  user: { id: 'A' },
};
const token = (id: string, subOnly = false) =>
  `h.${Buffer.from(JSON.stringify({ ...(subOnly ? { sub: id } : { userId: id }), sessionId: `session-${id}`, exp: 4102444800 })).toString('base64url')}.s`;
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => mockAuth }));
jest.mock('@/services/profileService', () => ({
  __esModule: true,
  default: {
    getOrCreateProfile: (...args: unknown[]) => mockProfile(...args),
    updateMyProfile: (...args: unknown[]) => mockProfileUpdate(...args),
  },
}));
jest.mock('@/services/roommateService', () => ({
  roommateService: {
    getRoommateProfiles: jest.fn(async () => ({ profiles: [] })),
    getRoommateRequests: jest.fn(async () => ({ sent: [], received: [] })),
    getRoommateRelationships: jest.fn(async () => ({ data: [] })),
    getMyRoommateStatus: (...args: unknown[]) => mockStatus(...args),
    getMyRoommatePreferences: (...args: unknown[]) => mockPreferences(...args),

    updateRoommatePreferences: (...args: unknown[]) => mockSave(...args),
  },
}));
jest.mock('@/hooks/useRoommate', () => ({ useRoommate: () => ({}) }));
jest.mock('@/hooks/useRoomsFeed', () => ({ useRoomsFeed: () => ({}) }));
jest.mock('@/components/RoommateMatch', () => ({ RoommateMatch: () => null }));
jest.mock('@/components/RoommateRequest', () => ({ RoommateRequestComponent: () => null }));
jest.mock('@/components/RoommateRelationship', () => ({
  RoommateRelationshipComponent: () => null,
}));
jest.mock('@/components/RoomList', () => ({ RoomList: () => null }));
jest.mock('@/components/ui/ErrorState', () => ({ ErrorState: () => null }));
jest.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ actionText, onAction }: { actionText: string; onAction: () => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable accessibilityRole="button" onPress={onAction}>
        <Text>{actionText}</Text>
      </Pressable>
    );
  },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), canGoBack: () => false }),
  useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@oxy.so/bloom/button', () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable accessibilityRole="button" {...props}>
        <Text>{children}</Text>
      </Pressable>
    );
  },
}));
jest.mock('@oxy.so/bloom/typography', () => ({
  H1: require('react-native').Text,
  H2: require('react-native').Text,
  H3: require('react-native').Text,
  Text: require('react-native').Text,
}));
jest.mock('@oxy.so/bloom/tabs', () => ({
  Tabs: require('react-native').View,
  TabsTrigger: () => null,
}));
jest.mock('@oxy.so/bloom/screen', () => ({
  Screen: require('react-native').View,
  ScreenScrollView: require('react-native').View,
}));
jest.mock('@oxy.so/bloom/loading', () => ({ Loading: () => null }));
jest.mock('@oxy.so/bloom/card', () => ({ Card: require('react-native').View }));
jest.mock('@oxy.so/bloom/field', () => ({ Field: require('react-native').View }));
jest.mock('@oxy.so/bloom/chip', () => ({ Chip: () => null }));
jest.mock('@oxy.so/bloom/date-picker', () => ({ DatePicker: () => null }));
jest.mock('@oxy.so/bloom/switch', () => ({ Switch: () => null }));
jest.mock('@oxy.so/bloom/text-field', () => ({ TextFieldInput: () => null }));
jest.mock('@oxy.so/bloom/theme', () => ({
  useTheme: () => ({ colors: { textSecondary: '#777' } }),
}));
jest.mock('@oxy.so/bloom/app-shell', () => ({ AppShellMenuButton: () => null }));
jest.mock('@oxy.so/bloom/page-header', () => ({ PageHeader: () => null }));
jest.mock('@/components/ui/SectionEyebrow', () => ({
  SectionEyebrow: require('react-native').Text,
}));

import RoommatePreferencesPage from '@/app/(pages)/roommates/preferences';
import { ProfileProvider, useProfile } from '@/context/ProfileContext';
import { useProfileStore } from '@/store/profileStore';
import { toast } from '@oxy.so/bloom/toast';

let client: QueryClient;
const originalConsoleError = console.error.bind(console);
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (String(args[0]).includes('act(')) originalConsoleError('ACT_WARNING_TEST', expect.getState().currentTestName);
    originalConsoleError(...args);
  });
  jest.clearAllMocks();
  mockAccount = 'A';
  useProfileStore.setState({
    profile: null,
    profileBinding: null,
    profileUpdatedAt: 0,
    profileRequest: null,
    latestProfileRequest: null,
    isLoading: false,
    error: null,
  });
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { networkMode: 'offlineFirst', retry: false, gcTime: Infinity },
    },
  });
  mockOxy = new OxyServices({ baseURL: 'https://example.invalid' });
  mockOxy.session.setAccessToken(token('A'));
  Object.assign(mockAuth, {
    oxyServices: mockOxy,
    activeSessionId: 'session-A',
    user: { id: 'A' },
  });
  mockPreferences.mockImplementation(async () => ({
    budget: { min: mockAccount === 'A' ? 1234 : 5678 },
  }));
  mockStatus.mockResolvedValue({ hasRoommateMatching: false });
  mockSave.mockResolvedValue({});
  mockProfile.mockImplementation(async () => ({ oxyUserId: mockAccount }));
});
afterEach(async () => {
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .every((mutation) => mutation.state.status !== 'pending'),
    ).toBe(true),
  );
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
  mockOxy.dispose();
});
function wrap(children: ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <ProfileProvider>{children}</ProfileProvider>
    </QueryClientProvider>
  );
}

function switchTo(id: 'A' | 'B', rerender: () => void) {
  act(() => {
    mockAccount = id;
    mockOxy.session.setAccessToken(token(id));
    mockAuth.activeSessionId = `session-${id}`;
    mockAuth.user = { id };
    rerender();
  });
}

it('refreshes the same-owner provider without clearing its binding', async () => {
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  expect(useProfileStore.getState().profileBinding).toEqual({
    userId: 'A',
    sessionId: 'session-A',
  });
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  expect(useProfileStore.getState().profileBinding).toEqual({
    userId: 'A',
    sessionId: 'session-A',
  });
  expect(screen.getByRole('button', { name: 'roommates.preferencesPage.save' })).toBeTruthy();
});

it.each([false, true])('ignores a delayed A profile refresh after B, ABA=%s', async (aba) => {
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  let finish!: (value: unknown) => void;
  mockProfile.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockProfile).toHaveBeenCalledTimes(2));
  switchTo('B', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
  await waitFor(() => expect(useProfileStore.getState().profile?.oxyUserId).toBe('B'));
  if (aba) {
    switchTo('A', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
    await waitFor(() => expect(useProfileStore.getState().profile?.oxyUserId).toBe('A'));
  }
  await act(async () => {
    finish({ oxyUserId: 'A', note: 'old' });
  });
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .every((mutation) => mutation.state.status !== 'pending'),
    ).toBe(true),
  );
  expect(useProfileStore.getState().profile?.oxyUserId).toBe(aba ? 'A' : 'B');
  expect(useProfileStore.getState().profile).not.toEqual(expect.objectContaining({ note: 'old' }));
  expect(toast.success).not.toHaveBeenCalled();
});

it('does not publish an old binding when the profile context has none', async () => {
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  act(() => {
    useProfileStore.setState({ profileBinding: null });
  });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'roommates.preferencesPage.save' })).toBeNull(),
  );
  expect(useProfileStore.getState().profileBinding).toBeNull();
  expect(mockSave).not.toHaveBeenCalled();
});

it.each(['success', 'failure'] as const)(
  'finishes a saved preferences action when its profile refresh is superseded and the newer refresh has %s',
  async (newer) => {
    let refresh!: () => Promise<unknown>;
    function CaptureRefresh() {
      refresh = useProfile().refreshProfile;
      return null;
    }
    const screen = render(
      wrap(
        <>
          <CaptureRefresh />
          <RoommatePreferencesPage />
        </>,
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
      ).not.toBeDisabled(),
    );
    let finish!: (value: unknown) => void;
    mockProfile.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    if (newer === 'success') mockProfile.mockResolvedValueOnce({ oxyUserId: 'A', note: 'newer' });
    else mockProfile.mockRejectedValueOnce(new Error('temporary outage'));
    fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
    await waitFor(() => expect(mockProfile).toHaveBeenCalledTimes(2));
    await act(async () => {
      if (newer === 'success') await refresh();
      else await expect(refresh()).rejects.toThrow('temporary outage');
    });
    await act(async () => {
      finish({ oxyUserId: 'A', note: 'superseded' });
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(useProfileStore.getState().profile).not.toEqual(
      expect.objectContaining({ note: 'superseded' }),
    );
    if (newer === 'success')
      expect(useProfileStore.getState().profile).toEqual(
        expect.objectContaining({ note: 'newer' }),
      );
  },
);

it('does not toast for an accepted A save after switching during settings invalidation', async () => {
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const original = client.invalidateQueries.bind(client);
  const invalidate = jest
    .spyOn(client, 'invalidateQueries')
    .mockImplementation((filters, options) => {
      if (filters?.queryKey?.[0] === 'roommates' && filters.queryKey[1] === 'preferences')
        return held;
      return original(filters, options);
    });
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(invalidate).toHaveBeenCalled());
  switchTo('B', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
  await waitFor(() => expect(useProfileStore.getState().profile?.oxyUserId).toBe('B'));
  await act(async () => {
    finish();
    await held;
  });
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .every((mutation) => mutation.state.status !== 'pending'),
    ).toBe(true),
  );
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  invalidate.mockRestore();
});

it('keeps profile data out of the query cache when a write settles before query publication', async () => {
  let finishRead!: (value: unknown) => void;
  mockProfile.mockReturnValueOnce(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  mockProfileUpdate.mockResolvedValueOnce({ oxyUserId: 'A', note: 'accepted-write' });
  const events: string[] = [];
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.query.state.status === 'success')
      events.push('query-success');
  });
  function Capture() {
    useProfile();
    return null;
  }
  render(wrap(<Capture />));
  await waitFor(() => expect(mockProfile).toHaveBeenCalledTimes(1));
  const query = client
    .getQueryCache()
    .find({ queryKey: ['profile', 'me', 'provider-v2', 'session-A'], exact: false });
  const queryPromise = query?.promise;
  if (!queryPromise) throw new Error('Expected the profile query in flight');
  const request = useProfileStore.getState().latestProfileRequest;
  if (!request) throw new Error('Expected a pending profile owner');
  const owner = request.owner;
  let resolveWrite!: () => void;
  let rejectWrite!: (error: unknown) => void;
  const written = new Promise<void>((resolve, reject) => {
    resolveWrite = resolve;
    rejectWrite = reject;
  });
  function startAfter(count: number) {
    queueMicrotask(() => {
      if (count) startAfter(count - 1);
      else {
        events.push('write-start');
        void useProfileStore
          .getState()
          .updateProfile({}, owner)
          .then(() => {
            events.push('write-accepted');
            resolveWrite();
          }, rejectWrite);
      }
    });
  }
  await act(async () => {
    finishRead({ oxyUserId: 'A', note: 'old-read' });
    startAfter(2);
    await written;
    await queryPromise;
  });
  expect(events.indexOf('write-start')).toBeLessThan(events.indexOf('write-accepted'));
  expect(events.indexOf('write-accepted')).toBeLessThan(events.indexOf('query-success'));
  expect(useProfileStore.getState().profile).toEqual(
    expect.objectContaining({ note: 'accepted-write' }),
  );
  const entries = client
    .getQueryCache()
    .findAll({ queryKey: ['profile', 'me', 'provider-v2', 'session-A'] });
  expect(entries).toHaveLength(1);
  expect(entries[0].state.data).toBe(true);
  unsubscribe();
});
