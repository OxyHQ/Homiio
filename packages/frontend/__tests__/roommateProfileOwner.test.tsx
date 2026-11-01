import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockAccount: 'A' | 'B' = 'A';
const mockGuards = { A: () => mockAccount === 'A', B: () => mockAccount === 'B' };
const mockRefreshA = jest.fn();
const mockRefreshB = jest.fn();
const mockToggle = jest.fn();
const mockSave = jest.fn();
const mockProfiles = {
  A: { oxyUserId: 'A', personalProfile: { settings: { roommate: { enabled: false } } } },
  B: { oxyUserId: 'B', personalProfile: { settings: { roommate: { enabled: false } } } },
};
jest.mock('@/context/ProfileContext', () => ({
  useProfile: () => ({
    profile: mockProfiles[mockAccount],
    hasProfile: true,
    refreshProfile: mockAccount === 'A' ? mockRefreshA : mockRefreshB,
    isProfileOwnerCurrent: mockGuards[mockAccount],
  }),
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ oxyServices: {}, activeSessionId: `session-${mockAccount}` }),
}));
jest.mock('@/services/roommateService', () => ({
  roommateService: {
    getRoommateProfiles: jest.fn(async () => ({ profiles: [] })),
    getRoommateRequests: jest.fn(async () => ({ sent: [], received: [] })),
    getRoommateRelationships: jest.fn(async () => ({ data: [] })),
    getMyRoommateStatus: jest.fn(async () => ({ hasRoommateMatching: false })),
    getMyRoommatePreferences: jest.fn(async () => null),
    toggleRoommateMatching: (...args: unknown[]) => mockToggle(...args),
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

import RoommatesPage from '@/app/(pages)/roommates/index';
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
  mockRefreshA.mockResolvedValue(null);
  mockRefreshB.mockResolvedValue(null);
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
});
function wrap(children: ReactNode) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('refreshes and confirms a matching change for the current owner', async () => {
  mockToggle.mockResolvedValue({ enabled: true });
  const screen = render(wrap(<RoommatesPage />));
  fireEvent.press(await screen.findByRole('button', { name: 'roommates.screen.enableMatching' }));
  await waitFor(() => expect(mockRefreshA).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
});

it('refreshes and confirms saved preferences for the current owner', async () => {
  mockSave.mockResolvedValue({});
  const screen = render(wrap(<RoommatePreferencesPage />));
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockRefreshA).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
});

it.each(['success', 'failure'] as const)(
  'does not refresh or toast for A matching after switching to B when A ends with %s',
  async (outcome) => {
    let finish!: (value: unknown) => void;
    let fail!: (reason: Error) => void;
    mockToggle.mockReturnValueOnce(
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
    );
    const screen = render(wrap(<RoommatesPage />));
    fireEvent.press(await screen.findByRole('button', { name: 'roommates.screen.enableMatching' }));
    await waitFor(() => expect(mockToggle).toHaveBeenCalledTimes(1));
    await act(async () => {
      mockAccount = 'B';
      screen.rerender(wrap(<RoommatesPage />));
    });
    expect(await screen.findByRole('button', { name: 'roommates.screen.enabling' })).toBeTruthy();
    await act(async () => {
      if (outcome === 'success') finish({ enabled: true });
      else fail(new Error('A failed'));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'roommates.screen.enableMatching' })).toBeTruthy(),
    );
    expect(mockRefreshA).not.toHaveBeenCalled();
    expect(mockRefreshB).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  },
);

it.each(['success', 'failure'] as const)(
  'does not refresh or toast for A preferences after switching to B when A ends with %s',
  async (outcome) => {
    let finish!: (value: unknown) => void;
    let fail!: (reason: Error) => void;
    mockSave.mockReturnValueOnce(
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
    );
    const screen = render(wrap(<RoommatePreferencesPage />));
    fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    await act(async () => {
      mockAccount = 'B';
      screen.rerender(wrap(<RoommatePreferencesPage />));
    });
    expect(screen.getByRole('button', { name: 'roommates.preferencesPage.saving' })).toBeDisabled();
    await act(async () => {
      if (outcome === 'success') finish({});
      else fail(new Error('A failed'));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'roommates.preferencesPage.save' })).toBeTruthy(),
    );
    expect(mockRefreshA).not.toHaveBeenCalled();
    expect(mockRefreshB).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  },
);
