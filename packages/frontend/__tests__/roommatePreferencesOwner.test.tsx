import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';

let mockAccount: 'A' | 'B' = 'A';
const mockSave = jest.fn();
const mockPreferences = jest.fn();
const mockStatus = jest.fn();
const mockProfile = jest.fn();
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
jest.mock('@/context/ProfileContext', () => ({ useProfile: () => ({ hasProfile: true }) }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => mockAuth }));
jest.mock('@/services/profileService', () => ({
  __esModule: true,
  default: { getOrCreateProfile: (...args: unknown[]) => mockProfile(...args) },
}));
jest.mock('@/store/profileStore', () => ({
  useProfileStore: { getState: () => ({ setProfile: mockSetProfile }) },
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
import { toast } from '@oxy.so/bloom/toast';

let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = 'A';
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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
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

it('loads each account before submitting its existing preferences', async () => {
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  switchTo('B', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
  await waitFor(() => expect(mockPreferences).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  expect(mockSave.mock.calls[0][0].budget.min).toBe(5678);
  expect(mockSave.mock.calls[0][2].userId).toBe('B');
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
});

it.each([false, true])('ignores a late A read across A to B, ABA=%s', async (aba) => {
  let finish!: (value: unknown) => void;
  mockPreferences.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() => expect(mockPreferences).toHaveBeenCalledTimes(1));
  switchTo('B', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
  await waitFor(() => expect(mockPreferences).toHaveBeenCalledTimes(2));
  if (aba) {
    switchTo('A', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
    await waitFor(() => expect(mockPreferences).toHaveBeenCalledTimes(3));
  }
  await act(async () => {
    finish({ budget: { min: 9999 } });
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  expect(mockSave.mock.calls[0][0].budget.min).toBe(aba ? 1234 : 5678);
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
});

it.each([false, true])('does not publish a late A save after B, ABA=%s', async (aba) => {
  let finish!: (value: unknown) => void;
  mockSave.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  switchTo('B', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
  if (aba) switchTo('A', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
  await act(async () => {
    finish({});
  });
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .every((mutation) => mutation.state.status !== 'pending'),
    ).toBe(true),
  );
  expect(mockProfile).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it.each(['sub-only', 'opaque', 'mismatched'])(
  'does not load or save with %s bearer',
  async (kind) => {
    mockOxy.session.setAccessToken(
      kind === 'sub-only' ? token('A', true) : kind === 'opaque' ? 'opaque' : token('B'),
    );
    const screen = render(wrap(<RoommatePreferencesPage />));
    expect(screen.getByText('contracts.detail.signAccountUnavailable')).toBeTruthy();
    expect(mockPreferences).not.toHaveBeenCalled();
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  },
);

it('does not enable save when either server read fails', async () => {
  mockStatus.mockRejectedValue(new Error('offline'));
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() => expect(screen.getByText('roommates.screen.loadError')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'roommates.preferencesPage.save' })).toBeNull();
  expect(mockSave).not.toHaveBeenCalled();
});

it('retains fresh same-generation in-memory preferences on remount offline', async () => {
  const first = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      first.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  first.unmount();
  act(() => onlineManager.setOnline(false));
  try {
    mockPreferences.mockRejectedValue(new Error('offline'));
    mockStatus.mockRejectedValue(new Error('offline'));
    const second = render(wrap(<RoommatePreferencesPage />));
    await waitFor(() =>
      expect(
        second.getByRole('button', { name: 'roommates.preferencesPage.save' }),
      ).not.toBeDisabled(),
    );
    expect(mockPreferences).toHaveBeenCalledTimes(1);
    fireEvent.press(second.getByRole('button', { name: 'roommates.preferencesPage.save' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0].budget.min).toBe(1234);
  } finally {
    act(() => onlineManager.setOnline(true));
  }
});

it('does not apply a profile refresh that finishes after switching', async () => {
  let finish!: (value: unknown) => void;
  mockProfile.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockProfile).toHaveBeenCalledTimes(1));
  switchTo('B', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
  await act(async () => {
    finish({ oxyUserId: 'A' });
  });
  await waitFor(() =>
    expect(
      client
        .getMutationCache()
        .getAll()
        .every((mutation) => mutation.state.status !== 'pending'),
    ).toBe(true),
  );
  expect(mockSetProfile).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
