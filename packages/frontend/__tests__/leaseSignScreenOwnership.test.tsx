import type { ReactNode } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import en from '@/locales/en.json';

const mockAuth = {
  isAuthenticated: true,
  user: { id: 'A' } as { id: string } | null,
  activeSessionId: 'session-A' as string | null,
  oxyServices: null as unknown as OxyServices,
};
const mockLease = {
  id: 'lease-1',
  status: 'draft',
  landlordOxyUserId: 'A',
  tenantOxyUserId: 'tenant',
  propertyId: 'property-1',
  termsSha256: 'fixture-terms',
  signatureRecords: [],
  coTenants: [{ oxyUserId: 'co' }],
};
let mockProfileId = 'A';
const mockSign = { isPending: false, mutateAsync: jest.fn() };
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => mockAuth }));
jest.mock('@/config', () => ({ API_URL: 'https://example.invalid' }));
jest.mock('@/services/propertyService', () => ({ propertyService: {} }));
jest.mock('@/hooks/useLeaseQueries', () => {
  const real = jest.requireActual('@/hooks/useLeaseQueries');
  return {
    ...real,
    useLease: () => ({ data: mockLease, isPending: false, isError: false }),
    useUploadLeaseDocument: () => mockSign,
  };
});
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'lease-1' }),
  useRouter: () => ({ canGoBack: () => false, back: jest.fn() }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'contracts.detail.signLease') return 'Sign lease';
      if (key === 'contracts.detail.signAccountUnavailable')
        return require('@/locales/en.json').contracts.detail.signAccountUnavailable;
      return key;
    },
  }),
}));
jest.mock('@oxy.so/bloom/surfaces', () => ({ confirm: jest.fn() }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@oxy.so/bloom/button', () => {
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ children, ...props }: { children: ReactNode }) => (
      <Pressable accessibilityRole="button" {...props}>
        <Text>{children}</Text>
      </Pressable>
    ),
  };
});
jest.mock('@oxy.so/bloom/typography', () => ({ P: require('react-native').Text }));
jest.mock('@oxy.so/bloom/app-shell', () => ({ AppShellMenuButton: () => null }));
jest.mock('@oxy.so/bloom/page-header', () => ({ PageHeader: () => null }));
jest.mock('@oxy.so/bloom/screen', () => ({
  Screen: require('react-native').View,
  ScreenScrollView: require('react-native').View,
}));
jest.mock('@oxy.so/bloom/icons/RiAddLine', () => ({ RiAddLine: () => null }));
jest.mock('@oxy.so/bloom/icons/RiAlertLine', () => ({ RiAlertLine: () => null }));
jest.mock('@oxy.so/bloom/theme', () => ({
  useTheme: () => ({ colors: { backgroundSecondary: '#fff' } }),
}));
jest.mock('@oxy.so/bloom/loading', () => ({ Loading: () => null }));
jest.mock('@oxy.so/bloom/tenancy', () => ({
  LeaseSummaryCard: ({ actions }: { actions: ReactNode }) => actions,
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/components/ui/ErrorState', () => ({ ErrorState: () => null }));
jest.mock('@/components/ContractStatusBadge', () => ({ ContractStatusBadge: () => null }));
jest.mock('@/components/tenancy/leaseTenancy', () => ({
  leaseSummaryProps: () => ({}),
  signingSubject: () => 'fixture terms',
}));
jest.mock('@/components/tenancy/LeaseSections', () => ({
  LeaseDocumentsSection: () => null,
  LeaseHistorySection: () => null,
  LeasePaymentsSection: () => null,
}));
jest.mock('@/components/tenancy/useLeaseFormatContext', () => ({
  useLeaseFormatContext: () => ({}),
}));
jest.mock('@/hooks', () => ({ useProperty: () => ({ property: null }) }));
jest.mock('@/context/ProfileContext', () => ({
  useProfile: () => ({ profile: { oxyUserId: mockProfileId } }),
}));
jest.mock('@/utils/propertyUtils', () => ({
  getPropertyImageSource: () => null,
  getPropertyTitle: () => 'Property',
}));

import ContractDetailScreen from '@/app/(pages)/contracts/[id]';
import { bindApiToOxy } from '@/utils/api';

const token = (id: string) =>
  `h.${Buffer.from(JSON.stringify({ userId: id, sessionId: `session-${id}`, exp: 4102444800 })).toString('base64url')}.s`;
let oxy: OxyServices;
let client: QueryClient;
const mockFetch = jest.fn();
function tree() {
  return (
    <QueryClientProvider client={client}>
      <ContractDetailScreen />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  oxy = new OxyServices({ baseURL: 'https://example.invalid' });
  oxy.session.setAccessToken(token('A'));
  mockLease.status = 'draft';
  mockProfileId = 'A';
  mockAuth.isAuthenticated = true;
  mockAuth.user = { id: 'A' };
  mockAuth.activeSessionId = 'session-A';
  mockAuth.oxyServices = oxy;
  bindApiToOxy(oxy);
  global.fetch = mockFetch;
});
afterEach(() => {
  client.clear();
  oxy.dispose();
});

it('does not sign or toast when an A confirmation resolves after switching to B', async () => {
  let answer!: (confirmed: boolean) => void;
  jest.mocked(confirm).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const screen = render(tree());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign lease' })).toBeEnabled());
  fireEvent.press(screen.getByRole('button', { name: 'Sign lease' }));
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  await act(async () => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    screen.rerender(tree());
  });
  await act(async () => {
    answer(true);
    await Promise.resolve();
  });
  expect(mockFetch).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it('explains an unavailable signing account and disables the action', async () => {
  oxy.session.setAccessToken('opaque');
  const screen = render(tree());
  const reason = await screen.findByText(en.contracts.detail.signAccountUnavailable);
  expect(reason.props.accessibilityLiveRegion).toBe('polite');
  expect(screen.getByRole('button', { name: 'Sign lease' })).toBeDisabled();
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each([
  ['terminate landlord', 'pending_signatures', 'contracts.detail.terminate', 'A'],
  ['terminate tenant', 'pending_signatures', 'contracts.detail.terminate', 'tenant'],
  ['delete landlord', 'draft', 'contracts.detail.deleteDraft', 'A'],
] as const)(
  'does not %s when a confirmation resolves after switching to B',
  async (_kind, status, label, account) => {
    mockLease.status = status;
    mockProfileId = account;
    mockAuth.user = { id: account };
    mockAuth.activeSessionId = `session-${account}`;
    oxy.session.setAccessToken(token(account));
    let answer!: (confirmed: boolean) => void;
    jest.mocked(confirm).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const screen = render(tree());
    await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
    fireEvent.press(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await act(async () => {
      oxy.session.setAccessToken(token('B'));
      mockAuth.user = { id: 'B' };
      mockAuth.activeSessionId = 'session-B';
      screen.rerender(tree());
    });
    await act(async () => {
      answer(true);
      await Promise.resolve();
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  },
);

it.each([
  ['terminate', 'pending_signatures', 'contracts.detail.terminate'],
  ['delete', 'draft', 'contracts.detail.deleteDraft'],
] as const)(
  'explains and disables %s when the subject is unavailable',
  async (_kind, status, label) => {
    mockLease.status = status;
    oxy.session.setAccessToken('opaque');
    const screen = render(tree());
    const reason = await screen.findByText(en.contracts.detail.signAccountUnavailable);
    expect(reason.props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
  },
);

it.each([
  ['tenant', 'draft', 'contracts.detail.deleteDraft'],
  ['co', 'pending_signatures', 'contracts.detail.terminate'],
] as const)(
  'keeps %s without the action not offered to that role',
  async (account, status, label) => {
    mockLease.status = status;
    mockProfileId = account;
    mockAuth.user = { id: account };
    mockAuth.activeSessionId = `session-${account}`;
    oxy.session.setAccessToken(token(account));
    const screen = render(tree());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign lease' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  },
);
