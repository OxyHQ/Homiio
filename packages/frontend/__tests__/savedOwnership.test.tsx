import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react-native';
import { OxyServices } from '@oxy.so/core';
import {
  SavedPropertiesProvider,
  useSavedPropertiesContext,
} from '@/context/SavedPropertiesContext';
import savedPropertyFolderService from '@/services/savedPropertyFolderService';
import savedPropertyService from '@/services/savedPropertyService';
import { savedKeys } from '@/hooks/useSavedQueries';
import type { AccountOwner } from '@/hooks/useAccountOwner';

const mockAuth = {
  isAuthenticated: true,
  user: { id: 'A' } as { id: string } | null,
  activeSessionId: 'session-A' as string | null,
  oxyServices: null as unknown as OxyServices,
};
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => mockAuth }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('i18next', () => ({ t: (key: string) => key }));
jest.mock('@/services/savedPropertyService', () => ({
  __esModule: true,
  default: {
    getSavedProperties: jest.fn(),
    saveProperty: jest.fn(),
    unsaveProperty: jest.fn(),
    updateNotes: jest.fn(),
  },
}));
jest.mock('@/services/savedPropertyFolderService', () => ({
  __esModule: true,
  default: { getSavedPropertyFolders: jest.fn() },
}));

const getSaved = jest.mocked(savedPropertyService.getSavedProperties);
const getFolders = jest.mocked(savedPropertyFolderService.getSavedPropertyFolders);
const save = jest.mocked(savedPropertyService.saveProperty);
const updateNotes = jest.mocked(savedPropertyService.updateNotes);
const properties = (id: string) =>
  ({ properties: [{ id }], total: 1, page: 1, totalPages: 1 }) as Awaited<
    ReturnType<typeof getSaved>
  >;
const folders = (name: string) =>
  ({ folders: [{ id: name, name }] }) as Awaited<ReturnType<typeof getFolders>>;
let client: QueryClient;
let oxy: OxyServices;
const token = (userId: string, nonce = 'first') =>
  `h.${Buffer.from(JSON.stringify({ userId, sessionId: `session-${userId}`, exp: 4102444800, nonce })).toString('base64url')}.s`;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <SavedPropertiesProvider>{children}</SavedPropertiesProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } },
  });
  mockAuth.isAuthenticated = true;
  mockAuth.user = { id: 'A' };
  mockAuth.activeSessionId = 'session-A';
  oxy = new OxyServices({ baseURL: 'https://example.test' });
  oxy.session.setAccessToken(token('A'));
  mockAuth.oxyServices = oxy;
  getSaved.mockReset();
  getFolders.mockReset();
  save.mockReset();
  updateNotes.mockReset();
});
afterEach(() => {
  cleanup();
  client.clear();
  oxy.dispose();
});

it('does not display A saved homes or folders while B is loading', async () => {
  let finishProperties!: (value: Awaited<ReturnType<typeof getSaved>>) => void;
  let finishFolders!: (value: Awaited<ReturnType<typeof getFolders>>) => void;
  getSaved.mockResolvedValueOnce(properties('A-home')).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishProperties = resolve;
      }),
  );
  getFolders.mockResolvedValueOnce(folders('A-folder')).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFolders = resolve;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-home'));
  await waitFor(() => expect(view.result.current.folders[0]?.id).toBe('A-folder'));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  expect(view.result.current.savedProperties).toEqual([]);
  expect(view.result.current.folders).toEqual([]);
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(getFolders).toHaveBeenCalledTimes(2));
  await act(async () => {
    finishProperties(properties('B-home'));
    finishFolders(folders('B-folder'));
  });
});

it('does not expose saved homes or folders after logout', async () => {
  getSaved.mockResolvedValue(properties('A-home'));
  getFolders.mockResolvedValue(folders('A-folder'));
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-home'));
  act(() => {
    oxy.session.clear();
    mockAuth.isAuthenticated = false;
    mockAuth.user = null;
    mockAuth.activeSessionId = null;
    view.rerender(undefined);
  });
  expect(view.result.current.savedProperties).toEqual([]);
  expect(view.result.current.folders).toEqual([]);
});

it('does not overwrite B saved homes with an A rollback', async () => {
  getSaved.mockResolvedValueOnce(properties('A-home')).mockResolvedValueOnce(properties('B-home'));
  getFolders.mockResolvedValue(folders('A-folder'));
  let reject!: (reason?: unknown) => void;
  save.mockImplementation(
    () =>
      new Promise((_resolve, rejectFn) => {
        reject = rejectFn;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-home'));
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.savePropertyToFolder('A-other', null);
  });
  const rejected = expect(pending).rejects.toThrow('failed');
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('B-home'));
  await act(async () => {
    reject(new Error('failed'));
    await rejected;
  });
  expect(view.result.current.savedProperties[0]?.id).toBe('B-home');
});

it('rejects a retained A action when B is projected before its bearer arrives', async () => {
  getSaved.mockResolvedValue(properties('A-home'));
  getFolders.mockResolvedValue(folders('A-folder'));
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-home'));
  const retained = view.result.current.savePropertyToFolder;
  act(() => {
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await expect(retained('home', null)).rejects.toThrow('The active account changed');
  expect(save).not.toHaveBeenCalled();
});

it('does not apply an old A rollback after an observed A to B to A switch', async () => {
  getSaved
    .mockResolvedValueOnce(properties('A-old'))
    .mockResolvedValueOnce(properties('B-home'))
    .mockResolvedValueOnce(properties('A-new'));
  getFolders.mockResolvedValue(folders('folder'));
  let reject!: (reason?: unknown) => void;
  save.mockImplementation(
    () =>
      new Promise((_resolve, rejectFn) => {
        reject = rejectFn;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-old'));
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.savePropertyToFolder('A-other', null);
  });
  const rejected = expect(pending).rejects.toThrow('failed');
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('B-home'));
  act(() => {
    oxy.session.setAccessToken(token('A', 'returned'));
    mockAuth.user = { id: 'A' };
    mockAuth.activeSessionId = 'session-A';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-new'));
  await act(async () => {
    reject(new Error('failed'));
    await rejected;
  });
  expect(view.result.current.savedProperties[0]?.id).toBe('A-new');
});

it('refreshes the new cache when the same session id arrives during a save', async () => {
  mockAuth.activeSessionId = null;
  getSaved
    .mockResolvedValueOnce(properties('A-before'))
    .mockResolvedValueOnce(properties('A-before'))
    .mockResolvedValueOnce(properties('A-after'));
  getFolders.mockResolvedValue(folders('folder'));
  let finish!: (value: unknown) => void;
  save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-before'));
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.savePropertyToFolder('new-home', null);
  });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  act(() => {
    mockAuth.activeSessionId = 'session-A';
    view.rerender(undefined);
  });
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(2));
  await act(async () => {
    finish(undefined);
    await pending;
  });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-after'));
});

it('does not roll A notes back into B saved data', async () => {
  getSaved.mockResolvedValueOnce(properties('A-home')).mockResolvedValueOnce(properties('B-home'));
  getFolders.mockResolvedValue(folders('folder'));
  let reject!: (reason?: unknown) => void;
  updateNotes.mockImplementation(
    () =>
      new Promise((_resolve, rejectFn) => {
        reject = rejectFn;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-home'));
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.updateNotes('A-home', 'private A');
  });
  const rejected = expect(pending).rejects.toThrow('failed');
  await waitFor(() => expect(updateNotes).toHaveBeenCalledTimes(1));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('B-home'));
  await act(async () => {
    reject(new Error('failed'));
    await rejected;
  });
  expect(view.result.current.savedProperties[0]?.id).toBe('B-home');
});

it('rolls back an offline failure after the screen unmounts while its owner remains', async () => {
  getSaved.mockResolvedValue(properties('A-home'));
  getFolders.mockResolvedValue(folders('A-folder'));
  let reject!: (reason?: unknown) => void;
  save.mockImplementation(
    () =>
      new Promise((_resolve, rejectFn) => {
        reject = rejectFn;
      }),
  );
  let context!: ReturnType<typeof useSavedPropertiesContext>;
  function Child() {
    context = useSavedPropertiesContext();
    return null;
  }
  function App({ show }: { show: boolean }) {
    return (
      <QueryClientProvider client={client}>
        <SavedPropertiesProvider>{show ? <Child /> : null}</SavedPropertiesProvider>
      </QueryClientProvider>
    );
  }
  const view = render(<App show />);
  await waitFor(() => expect(context.savedProperties[0]?.id).toBe('A-home'));
  let pending!: Promise<void>;
  act(() => {
    pending = context.savePropertyToFolder('A-other', null);
  });
  const rejected = expect(pending).rejects.toThrow('offline');
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const captured = save.mock.calls[0][0] as AccountOwner;
  view.rerender(<App show={false} />);
  await act(async () => {
    reject(new Error('offline'));
    await rejected;
  });
  expect(client.getQueryData(savedKeys.properties(captured))).toEqual(properties('A-home'));
});

it('does not reuse a cache entry when the Oxy provider instance changes', async () => {
  let finish!: (value: Awaited<ReturnType<typeof getSaved>>) => void;
  getSaved.mockResolvedValueOnce(properties('first-provider-home')).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  getFolders.mockResolvedValue(folders('folder'));
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() =>
    expect(view.result.current.savedProperties[0]?.id).toBe('first-provider-home'),
  );
  const replacement = new OxyServices({ baseURL: 'https://example.test' });
  replacement.session.setAccessToken(token('A'));
  try {
    act(() => {
      mockAuth.oxyServices = replacement;
      view.rerender(undefined);
    });
    expect(view.result.current.savedProperties).toEqual([]);
    await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(2));
    await act(async () => {
      finish(properties('replacement-provider-home'));
    });
    await waitFor(() =>
      expect(view.result.current.savedProperties[0]?.id).toBe('replacement-provider-home'),
    );
  } finally {
    replacement.dispose();
  }
});

it('hides cached data when the projected account and bearer disagree', async () => {
  getSaved.mockResolvedValue(properties('A-home'));
  getFolders.mockResolvedValue(folders('A-folder'));
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-home'));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    view.rerender(undefined);
  });
  expect(view.result.current.savedProperties).toEqual([]);
  expect(view.result.current.folders).toEqual([]);
  expect(getSaved).toHaveBeenCalledTimes(1);
});
