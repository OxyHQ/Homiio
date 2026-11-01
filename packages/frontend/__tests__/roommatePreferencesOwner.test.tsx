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
let mockFocus: (() => void) | undefined;
const mockAuth = {
  oxyServices: null as unknown as OxyServices,
  activeSessionId: 'session-A',
  isAuthenticated: true,
  user: { id: 'A' },
};
const token = (id: string, subOnly = false) =>
  `h.${Buffer.from(JSON.stringify({ ...(subOnly ? { sub: id } : { userId: id }), sessionId: `session-${id}`, exp: 4102444800 })).toString('base64url')}.s`;
jest.mock('@/context/ProfileContext', () => ({
  useProfile: () => ({
    hasProfile: true,
    profile: {
      oxyUserId: 'stale-A',
      personalProfile: { settings: { roommate: { enabled: true } } },
    },
  }),
}));
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
  useFocusEffect: (fn: () => void) => {
    require('react').useEffect(() => {
      mockFocus = fn;
      fn();
      return () => {
        mockFocus = undefined;
      };
    }, [fn]);
  },
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
jest.mock('@oxy.so/bloom/switch', () => ({
  Switch: ({
    checked,
    accessibilityLabel,
    disabled,
  }: {
    checked: boolean;
    accessibilityLabel: string;
    disabled?: boolean;
  }) =>
    require('react').createElement(require('react-native').Switch, {
      value: checked,
      accessibilityLabel,
      disabled,
      accessibilityState: { disabled },
    }),
}));
jest.mock('@oxy.so/bloom/text-field', () => ({
  TextFieldInput: ({
    label,
    value,
    disabled,
    onChangeText,
  }: {
    label: string;
    value: string;
    disabled?: boolean;
    onChangeText?: (value: string) => void;
  }) =>
    require('react').createElement(require('react-native').TextInput, {
      accessibilityLabel: label,
      value,
      editable: !disabled,
      onChangeText,
    }),
}));
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
      queries: { networkMode: 'offlineFirst', retry: false, gcTime: Infinity },
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
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.state.fetchStatus === 'idle'),
    ).toBe(true),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  cleanup();
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
  expect(mockSave.mock.calls[0][1]).toBe(false);
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
  const pending = mockSave.mock.results[0].value;
  switchTo('B', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  if (aba) {
    switchTo('A', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
      ).not.toBeDisabled(),
    );
  }
  await act(async () => {
    finish({});
    await pending;
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
  await waitFor(() =>
    expect(screen.getByText('roommates.preferencesPage.refreshToSave')).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: 'roommates.preferencesPage.save' })).toBeNull();
  expect(mockSave).not.toHaveBeenCalled();
});

it('shows cached values read-only while an offline retry is paused and recovers online', async () => {
  const first = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      first.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  first.unmount();
  client.setDefaultOptions({
    queries: { networkMode: 'offlineFirst', retry: 2, retryDelay: 0, gcTime: Infinity },
    mutations: { networkMode: 'offlineFirst', retry: false },
  });
  act(() => onlineManager.setOnline(false));
  try {
    mockPreferences.mockRejectedValue(new Error('offline'));
    mockStatus.mockRejectedValue(new Error('offline'));
    const second = render(wrap(<RoommatePreferencesPage />));
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .some(
            (query) =>
              query.queryKey[0] === 'roommates' &&
              query.queryKey[1] === 'preferences' &&
              query.state.fetchStatus === 'paused',
          ),
      ).toBe(true),
    );
    expect(second.getByText('roommates.preferencesPage.refreshToSave')).toBeTruthy();
    expect(second.getByRole('button', { name: 'roommates.preferencesPage.save' })).toBeDisabled();
    expect(second.getAllByLabelText('roommates.preferencesPage.min')[0]).toHaveProp(
      'value',
      '1234',
    );
    expect(second.getAllByLabelText('roommates.preferencesPage.min')[0]).toHaveProp(
      'editable',
      false,
    );
    expect(second.getByLabelText('roommates.preferencesPage.enableTitle')).toBeDisabled();
    expect(mockSave).not.toHaveBeenCalled();
    mockPreferences.mockResolvedValue({ budget: { min: 5678, max: 9999 } });
    mockStatus.mockResolvedValue({ hasRoommateMatching: true });
    await act(async () => {
      onlineManager.setOnline(true);
    });
    await waitFor(() =>
      expect(second.getAllByLabelText('roommates.preferencesPage.min')[0]).toHaveProp(
        'value',
        '5678',
      ),
    );
    await waitFor(() =>
      expect(
        second.getByRole('button', { name: 'roommates.preferencesPage.save' }),
      ).not.toBeDisabled(),
    );
    expect(second.getByLabelText('roommates.preferencesPage.enableTitle')).toHaveProp(
      'value',
      true,
    );
  } finally {
    await act(async () => {
      onlineManager.setOnline(true);
    });
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
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
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

it('reflects a matching change when returning with a fresh cached entry', async () => {
  let enabled = false;
  mockStatus.mockImplementation(async () => ({ hasRoommateMatching: enabled }));
  const first = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      first.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  first.unmount();
  enabled = true;
  const second = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() => expect(mockStatus.mock.calls.length).toBeGreaterThan(1));
  await waitFor(() =>
    expect(second.getByLabelText('roommates.preferencesPage.enableTitle')).toHaveProp(
      'value',
      true,
    ),
  );
  await waitFor(() =>
    expect(
      second.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  fireEvent.press(second.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  expect(mockSave.mock.calls[0][1]).toBe(true);
});

it('refreshes matching status when the mounted screen regains focus', async () => {
  let enabled = false;
  mockStatus.mockImplementation(async () => ({ hasRoommateMatching: enabled }));
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  const calls = mockStatus.mock.calls.length;
  enabled = true;
  await act(async () => {
    mockFocus?.();
  });
  await waitFor(() => expect(mockStatus.mock.calls.length).toBeGreaterThan(calls));
  await waitFor(() =>
    expect(screen.getByLabelText('roommates.preferencesPage.enableTitle')).toHaveProp(
      'value',
      true,
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  expect(mockSave.mock.calls[0][1]).toBe(true);
});

it('recovers after one of the two reads fails while the other finishes late', async () => {
  let finish!: (value: unknown) => void;
  mockPreferences.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mockStatus.mockRejectedValueOnce(new Error('offline'));
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(screen.getByText('roommates.preferencesPage.refreshToSave')).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: 'roommates.preferencesPage.save' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  await act(async () => {
    finish({ budget: { min: 9999 } });
  });
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  expect(mockSave.mock.calls[0][0].budget.min).toBe(1234);
});

it('rejects a retained save handler while a focus refresh has started', async () => {
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  const button = screen.getByRole('button', { name: 'roommates.preferencesPage.save' });
  let finish!: (value: unknown) => void;
  mockStatus.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => {
    mockFocus?.();
    fireEvent.press(button);
  });
  expect(mockSave).not.toHaveBeenCalled();
  await act(async () => {
    finish({ hasRoommateMatching: true });
  });
  await waitFor(() =>
    expect(screen.getByLabelText('roommates.preferencesPage.enableTitle')).toHaveProp(
      'value',
      true,
    ),
  );
});

it('preserves an unsaved budget while refreshing a changed matching status', async () => {
  let enabled = false;
  mockStatus.mockImplementation(async () => ({ hasRoommateMatching: enabled }));
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  fireEvent.changeText(screen.getAllByLabelText('roommates.preferencesPage.min')[0], '4321');
  enabled = true;
  await act(async () => {
    mockFocus?.();
  });
  await waitFor(() =>
    expect(screen.getByLabelText('roommates.preferencesPage.enableTitle')).toHaveProp(
      'value',
      true,
    ),
  );
  expect(screen.getAllByLabelText('roommates.preferencesPage.min')[0]).toHaveProp('value', '4321');
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  expect(mockSave.mock.calls[0][0].budget.min).toBe(4321);
  expect(mockSave.mock.calls[0][1]).toBe(true);
});

it('keeps unsaved edits and requires explicit discard after a conflicting remote update', async () => {
  let budget = 1234;
  mockPreferences.mockImplementation(async () => ({ budget: { min: budget, max: 9999 } }));
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  fireEvent.changeText(screen.getAllByLabelText('roommates.preferencesPage.min')[0], '4321');
  budget = 5678;
  await act(async () => {
    mockFocus?.();
  });
  await waitFor(() =>
    expect(screen.getByText('roommates.preferencesPage.remoteConflict')).toBeTruthy(),
  );
  expect(screen.getAllByLabelText('roommates.preferencesPage.min')[0]).toHaveProp('value', '4321');
  expect(screen.getByRole('button', { name: 'roommates.preferencesPage.save' })).toBeDisabled();
  expect(mockSave).not.toHaveBeenCalled();
  fireEvent.press(
    screen.getByRole('button', { name: 'roommates.preferencesPage.discardAndReload' }),
  );
  expect(screen.getAllByLabelText('roommates.preferencesPage.min')[0]).toHaveProp('value', '5678');
  expect(screen.getByRole('button', { name: 'roommates.preferencesPage.save' })).not.toBeDisabled();
});

it('explains a paused offline retry with no cached settings and recovers', async () => {
  client.setDefaultOptions({
    queries: { networkMode: 'offlineFirst', retry: 2, retryDelay: 0, gcTime: Infinity },
    mutations: { networkMode: 'offlineFirst', retry: false },
  });
  act(() => onlineManager.setOnline(false));
  try {
    mockPreferences.mockRejectedValue(new Error('offline'));
    mockStatus.mockRejectedValue(new Error('offline'));
    const screen = render(wrap(<RoommatePreferencesPage />));
    await waitFor(() =>
      expect(screen.getByText('roommates.preferencesPage.refreshToSave')).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: 'roommates.preferencesPage.save' })).toBeNull();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
    mockPreferences.mockResolvedValue({ budget: { min: 1234, max: 9999 } });
    mockStatus.mockResolvedValue({ hasRoommateMatching: false });
    await act(async () => {
      onlineManager.setOnline(true);
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
      ).not.toBeDisabled(),
    );
  } finally {
    await act(async () => {
      onlineManager.setOnline(true);
    });
  }
});

it('keeps B independent of a delayed A retry after an initial partial failure', async () => {
  mockStatus.mockRejectedValueOnce(new Error('offline'));
  let finish!: (value: unknown) => void;
  const screen = render(wrap(<RoommatePreferencesPage />));
  await waitFor(() =>
    expect(screen.getByText('roommates.preferencesPage.refreshToSave')).toBeTruthy(),
  );
  mockStatus.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
  await waitFor(() => expect(mockStatus).toHaveBeenCalledTimes(2));
  switchTo('B', () => screen.rerender(wrap(<RoommatePreferencesPage />)));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'roommates.preferencesPage.save' }),
    ).not.toBeDisabled(),
  );
  await act(async () => {
    finish({ hasRoommateMatching: true });
  });
  expect(screen.getByLabelText('roommates.preferencesPage.enableTitle')).toHaveProp('value', false);
  expect(toast.success).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'roommates.preferencesPage.save' }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  expect(mockSave.mock.calls[0][0].budget.min).toBe(5678);
});
