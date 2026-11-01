import type { ReactNode } from 'react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react-native';
import { OxyServices } from '@oxy.so/core';
import { toast } from '@oxy.so/bloom/toast';
import { SavedPropertyChangeSupersededError } from '@/hooks/savedPropertyErrors';
import {
  SavedPropertiesProvider,
  useSavedPropertiesContext,
} from '@/context/SavedPropertiesContext';
import savedPropertyFolderService from '@/services/savedPropertyFolderService';
import savedPropertyService from '@/services/savedPropertyService';
import { savedKeys } from '@/hooks/useSavedQueries';
import { useSavedNotesMutation } from '@/hooks/useSavedNotes';
import type { AccountOwner } from '@/hooks/useAccountOwner';

const mockAuth = {
  isAuthenticated: true,
  user: { id: 'A' } as { id: string } | null,
  activeSessionId: 'session-A' as string | null,
  oxyServices: null as unknown as OxyServices,
};
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockImplementation(() => `test-${Math.random()}`),
}));
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
  default: { getSavedPropertyFolders: jest.fn(), updateSavedPropertyFolder: jest.fn() },
}));

const getSaved = jest.mocked(savedPropertyService.getSavedProperties);
const getFolders = jest.mocked(savedPropertyFolderService.getSavedPropertyFolders);
const updateFolder = jest.mocked(savedPropertyFolderService.updateSavedPropertyFolder);
const save = jest.mocked(savedPropertyService.saveProperty);
const unsave = jest.mocked(savedPropertyService.unsaveProperty);
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
  getSaved.mockResolvedValue(properties('server-home'));
  getFolders.mockReset();
  updateFolder.mockReset();
  save.mockReset();
  unsave.mockReset();
  updateNotes.mockReset();
  jest.mocked(toast.error).mockClear();
  jest.mocked(toast.success).mockClear();
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  client.unmount();
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
    .mockResolvedValueOnce(properties('A-after'))
    .mockResolvedValue(properties('A-after'));
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
    view.unmount();
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

it.each(['save', 'unsave'] as const)(
  'removes optimistic %s data after failure when the initial query has no data',
  async (operation) => {
    const pending: Array<(value: Awaited<ReturnType<typeof getSaved>>) => void> = [];
    getSaved.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    getFolders.mockResolvedValue(folders('A-folder'));
    save.mockRejectedValue(new Error('offline'));
    unsave.mockRejectedValue(new Error('offline'));
    const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
    await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(1));
    const key = savedKeys.properties(getSaved.mock.calls[0][0] as AccountOwner);
    expect(client.getQueryData(key)).toBeUndefined();
    await act(async () => {
      const promise =
        operation === 'save'
          ? view.result.current.savePropertyToFolder('new-home', null)
          : view.result.current.unsaveProperty('new-home');
      await expect(promise).rejects.toThrow('offline');
    });
    await waitFor(() =>
      expect(client.getQueryData<{ properties: unknown[] }>(key)?.properties).toEqual([]),
    );
    expect(view.result.current.savedProperties).toEqual([]);
    view.unmount();
    pending.forEach((resolve) => resolve(properties('server-home')));
  },
);

it.each([false, true])(
  'preserves another pending save when the first fails (initial cache: %s)',
  async (withCache) => {
    const initialResolvers: Array<(value: Awaited<ReturnType<typeof getSaved>>) => void> = [];
    if (withCache) getSaved.mockResolvedValueOnce(properties('existing'));
    else
      getSaved.mockImplementationOnce(
        () => new Promise((resolve) => initialResolvers.push(resolve)),
      );
    getSaved.mockResolvedValue(properties('P2'));
    getFolders.mockResolvedValue(folders('folder'));
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (value: unknown) => void;
    save.mockImplementation(
      (_owner, id) =>
        new Promise((resolve, reject) => {
          if (id === 'P1') rejectFirst = reject;
          else resolveSecond = resolve;
        }),
    );
    const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
    await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(1));
    if (withCache)
      await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('existing'));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = view.result.current.savePropertyToFolder('P1', null);
      second = view.result.current.savePropertyToFolder('P2', null);
    });
    const rejection = expect(first).rejects.toThrow('offline');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await act(async () => {
      rejectFirst(new Error('offline'));
      await rejection;
    });
    expect(view.result.current.savedProperties.map((p) => p.id)).toContain('P2');
    expect(view.result.current.savedProperties.map((p) => p.id)).not.toContain('P1');
    await act(async () => {
      resolveSecond(undefined);
      await second;
    });
    await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(view.result.current.savedProperties.map((p) => p.id)).toEqual(['P2']),
    );
    view.unmount();
    initialResolvers.forEach((resolve) => resolve(properties('old-response')));
  },
);

it('does not undo a later action on the same property when an earlier request fails last', async () => {
  const empty = { ...properties('unused'), properties: [], total: 0 };
  getSaved.mockResolvedValueOnce(properties('P')).mockResolvedValue(empty);
  getFolders.mockResolvedValue(folders('folder'));
  let rejectFirst!: (error: Error) => void;
  let resolveSecond!: (value: unknown) => void;
  save.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectFirst = reject;
      }),
  );
  unsave.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('P'));
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = view.result.current.savePropertyToFolder('P', null);
  });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  act(() => {
    second = view.result.current.unsaveProperty('P');
  });
  const rejection = expect(first).rejects.toBeInstanceOf(SavedPropertyChangeSupersededError);
  await waitFor(() => expect(unsave).toHaveBeenCalledTimes(1));
  await act(async () => {
    resolveSecond(undefined);
    await second;
  });
  await act(async () => {
    rejectFirst(new Error('offline'));
    await rejection;
  });
  expect(view.result.current.savedProperties).toEqual([]);
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.result.current.savedProperties).toEqual([]));
});

it('ignores an older in-flight GET after starting an optimistic save', async () => {
  let finishOldGet!: (value: Awaited<ReturnType<typeof getSaved>>) => void;
  let finishSave!: (value: unknown) => void;
  getSaved
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldGet = resolve;
        }),
    )
    .mockResolvedValue(properties('new-home'));
  getFolders.mockResolvedValue(folders('folder'));
  save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(1));
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.savePropertyToFolder('new-home', null);
  });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await act(async () => {
    finishOldGet(properties('stale-home'));
  });
  expect(view.result.current.savedProperties.map((p) => p.id)).toEqual(['new-home']);
  await act(async () => {
    finishSave(undefined);
    await pending;
  });
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(view.result.current.savedProperties.map((p) => p.id)).toEqual(['new-home']),
  );
});

it('rejects a retained A action after an observed projection-only A to B to A transition', async () => {
  getSaved.mockResolvedValue(properties('A-home'));
  getFolders.mockResolvedValue(folders('folder'));
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-home'));
  const retained = view.result.current.savePropertyToFolder;
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
  await expect(retained('home', null)).rejects.toThrow('The active account changed');
  expect(save).not.toHaveBeenCalled();
});

it('does not erase another property save when a notes update fails', async () => {
  getSaved.mockResolvedValueOnce(properties('existing')).mockResolvedValue(properties('new-home'));
  getFolders.mockResolvedValue(folders('folder'));
  let rejectNotes!: (error: Error) => void;
  let resolveSave!: (value: unknown) => void;
  updateNotes.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectNotes = reject;
      }),
  );
  save.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('existing'));
  let notes!: Promise<void>;
  let saved!: Promise<void>;
  act(() => {
    notes = view.result.current.updateNotes('existing', 'private note');
    saved = view.result.current.savePropertyToFolder('new-home', null);
  });
  const rejection = expect(notes).rejects.toThrow('offline');
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await act(async () => {
    rejectNotes(new Error('offline'));
    await rejection;
  });
  expect(view.result.current.savedProperties.map((p) => p.id)).toContain('new-home');
  await act(async () => {
    resolveSave(undefined);
    await saved;
  });
  await waitFor(() =>
    expect(view.result.current.savedProperties.map((p) => p.id)).toEqual(['new-home']),
  );
});

it('resumes a paused notes mutation for the same owner and releases its captured operation', async () => {
  getSaved.mockResolvedValue(properties('A-home'));
  getFolders.mockResolvedValue(folders('folder'));
  updateNotes.mockResolvedValue(undefined);
  client.setDefaultOptions({
    queries: { retry: false, networkMode: 'always' },
    mutations: { networkMode: 'online', gcTime: Infinity },
  });
  client.mount();
  const view = renderHook(() => useSavedNotesMutation(), { wrapper });
  await waitFor(() => expect(getSaved).toHaveBeenCalled());
  act(() => {
    onlineManager.setOnline(false);
  });
  const onSuccess = jest.fn();
  const onSettled = jest.fn();
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.mutateAsync(
      { propertyId: 'A-home', notes: 'draft' },
      { onSuccess, onSettled },
    );
  });
  await waitFor(() => expect(view.result.current.isPaused).toBe(true));
  const queued = client.getMutationCache().getAll()[0];
  const captured = queued.state.variables as {
    propertyId: string;
    notes: string;
    operationId: string;
  };
  expect(JSON.stringify(captured)).not.toContain('oxyServices');
  const run = queued.options.mutationFn!;
  await expect(run({ ...captured, operationId: 'unknown' }, {} as never)).rejects.toThrow(
    'no longer available',
  );
  expect(updateNotes).not.toHaveBeenCalled();
  await act(async () => {
    onlineManager.setOnline(true);
    await pending;
  });
  expect(updateNotes).toHaveBeenCalledTimes(1);
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(onSettled).toHaveBeenCalledTimes(1);
  await expect(run(captured, {} as never)).rejects.toThrow('no longer available');
});

it('rejects a paused notes mutation if another account is active when it resumes', async () => {
  getSaved.mockResolvedValue(properties('A-home'));
  getFolders.mockResolvedValue(folders('folder'));
  updateNotes.mockResolvedValue(undefined);
  client.setDefaultOptions({
    queries: { retry: false, networkMode: 'always' },
    mutations: { networkMode: 'online', gcTime: Infinity },
  });
  client.mount();
  const view = renderHook(() => useSavedNotesMutation(), { wrapper });
  await waitFor(() => expect(getSaved).toHaveBeenCalled());
  act(() => {
    onlineManager.setOnline(false);
  });
  const onSuccess = jest.fn();
  const onError = jest.fn();
  const onSettled = jest.fn();
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.mutateAsync(
      { propertyId: 'A-home', notes: 'private A' },
      { onSuccess, onError, onSettled },
    );
  });
  const rejected = expect(pending).rejects.toThrow('The active account changed');
  await waitFor(() => expect(view.result.current.isPaused).toBe(true));
  const queued = client.getMutationCache().getAll()[0];
  const captured = queued.state.variables as {
    propertyId: string;
    notes: string;
    operationId: string;
  };
  const run = queued.options.mutationFn!;
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await act(async () => {
    onlineManager.setOnline(true);
    await rejected;
  });
  expect(updateNotes).not.toHaveBeenCalled();
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(onSettled).not.toHaveBeenCalled();
  await expect(run(captured, {} as never)).rejects.toThrow('no longer available');
});

it('resumes a paused notes mutation after its screen unmounts while the provider remains', async () => {
  getSaved.mockResolvedValue(properties('A-home'));
  getFolders.mockResolvedValue(folders('folder'));
  updateNotes.mockResolvedValue(undefined);
  client.setDefaultOptions({
    queries: { retry: false, networkMode: 'always' },
    mutations: { networkMode: 'online', gcTime: Infinity },
  });
  client.mount();
  let notes!: ReturnType<typeof useSavedNotesMutation>;
  function Child() {
    notes = useSavedNotesMutation();
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
  await waitFor(() => expect(getSaved).toHaveBeenCalled());
  act(() => {
    onlineManager.setOnline(false);
  });
  let pending!: Promise<void>;
  act(() => {
    pending = notes.mutateAsync({ propertyId: 'A-home', notes: 'draft' });
  });
  await waitFor(() => expect(notes.isPaused).toBe(true));
  view.rerender(<App show={false} />);
  await act(async () => {
    onlineManager.setOnline(true);
    await pending;
  });
  expect(updateNotes).toHaveBeenCalledTimes(1);
});

it('releases a paused notes operation removed from its isolated query client', async () => {
  getSaved.mockResolvedValue(properties('A-home'));
  getFolders.mockResolvedValue(folders('folder'));
  client.setDefaultOptions({
    queries: { retry: false, networkMode: 'always' },
    mutations: { networkMode: 'online', gcTime: Infinity },
  });
  client.mount();
  const view = renderHook(() => useSavedNotesMutation(), { wrapper });
  await waitFor(() => expect(getSaved).toHaveBeenCalled());
  act(() => {
    onlineManager.setOnline(false);
  });
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.mutateAsync({ propertyId: 'A-home', notes: 'draft' });
  });
  const rejected = expect(pending).rejects.toThrow('no longer available');
  await waitFor(() => expect(view.result.current.isPaused).toBe(true));
  const queued = client.getMutationCache().getAll()[0];
  const captured = queued.state.variables as {
    propertyId: string;
    notes: string;
    operationId: string;
  };
  const run = queued.options.mutationFn!;
  view.unmount();
  act(() => {
    client.clear();
  });
  await expect(run(captured, {} as never)).rejects.toThrow('no longer available');
  await act(async () => {
    onlineManager.setOnline(true);
    void queued.continue().catch(() => {});
    await rejected;
  });
  expect(updateNotes).not.toHaveBeenCalled();
});

it('does not refetch between an earlier completion and a second mutation waiting to prepare', async () => {
  getSaved.mockResolvedValue(properties('existing'));
  getFolders.mockResolvedValue(folders('folder'));
  let finishFirst!: (value: unknown) => void;
  let finishSecond!: (value: unknown) => void;
  let finishPreparation!: () => void;
  save.mockImplementation(
    (_owner, id) =>
      new Promise((resolve) => {
        if (id === 'P1') finishFirst = resolve;
        else finishSecond = resolve;
      }),
  );
  const originalCancel = client.cancelQueries.bind(client);
  let cancellations = 0;
  const spy = jest.spyOn(client, 'cancelQueries').mockImplementation((...args) => {
    cancellations += 1;
    const cancelled = originalCancel(...args);
    return cancellations === 2
      ? cancelled.then(
          () =>
            new Promise<void>((resolve) => {
              finishPreparation = resolve;
            }),
        )
      : cancelled;
  });
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  try {
    await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('existing'));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = view.result.current.savePropertyToFolder('P1', null);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    act(() => {
      second = view.result.current.savePropertyToFolder('P2', null);
    });
    await waitFor(() => expect(finishPreparation).toBeDefined());
    await act(async () => {
      finishFirst(undefined);
      await first;
    });
    expect(getSaved).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishPreparation();
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await act(async () => {
      finishSecond(undefined);
      await second;
    });
  } finally {
    spy.mockRestore();
    finishPreparation?.();
    finishSecond?.(undefined);
    view.unmount();
  }
});

it('releases preparation after cancellation fails and reconciles the same owner', async () => {
  getSaved.mockResolvedValue(properties('existing'));
  getFolders.mockResolvedValue(folders('folder'));
  save.mockResolvedValue(undefined);
  const spy = jest.spyOn(client, 'cancelQueries').mockRejectedValueOnce(new Error('cancel failed'));
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('existing'));
  await act(async () => {
    await expect(view.result.current.savePropertyToFolder('P1', null)).rejects.toThrow(
      'cancel failed',
    );
  });
  expect(save).not.toHaveBeenCalled();
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(2));
  await act(async () => {
    await view.result.current.savePropertyToFolder('P2', null);
  });
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(3));
  spy.mockRestore();
});

it('releases preparation without reconciling B when A changes during cancellation', async () => {
  getSaved.mockResolvedValueOnce(properties('A-home')).mockResolvedValue(properties('B-home'));
  getFolders.mockResolvedValue(folders('folder'));
  let finishPreparation!: () => void;
  const spy = jest.spyOn(client, 'cancelQueries').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPreparation = resolve;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-home'));
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.savePropertyToFolder('A-other', null);
  });
  const rejected = expect(pending).rejects.toThrow('The active account changed');
  await waitFor(() => expect(finishPreparation).toBeDefined());
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('B-home'));
  await act(async () => {
    finishPreparation();
    await rejected;
  });
  expect(save).not.toHaveBeenCalled();
  expect(getSaved).toHaveBeenCalledTimes(2);
  save.mockResolvedValue(undefined);
  await act(async () => {
    await view.result.current.savePropertyToFolder('B-other', null);
  });
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(3));
  spy.mockRestore();
});

it('rejects an earlier change prepared after a later action on the same property', async () => {
  const empty = { ...properties('unused'), properties: [], total: 0 };
  getSaved.mockResolvedValueOnce(properties('P')).mockResolvedValue(empty);
  getFolders.mockResolvedValue(folders('folder'));
  unsave.mockResolvedValue(undefined);
  let finishFirstPreparation!: () => void;
  const spy = jest.spyOn(client, 'cancelQueries').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirstPreparation = resolve;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('P'));
  let earlier!: Promise<void>;
  act(() => {
    earlier = view.result.current.savePropertyToFolder('P', null);
  });
  const rejected = expect(earlier).rejects.toThrow('superseded');
  await waitFor(() => expect(finishFirstPreparation).toBeDefined());
  await act(async () => {
    await view.result.current.unsaveProperty('P');
  });
  expect(unsave).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishFirstPreparation();
    await rejected;
  });
  expect(save).not.toHaveBeenCalled();
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.result.current.savedProperties).toEqual([]));
  spy.mockRestore();
});

it.each([false, true])('suppresses an older sent change when it later %s', async (succeeds) => {
  getSaved.mockResolvedValue(properties('P'));
  getFolders.mockResolvedValue(folders('folder'));
  let finishFirst!: (value: unknown) => void;
  let failFirst!: (error: Error) => void;
  save.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        finishFirst = resolve;
        failFirst = reject;
      }),
  );
  unsave.mockResolvedValue(undefined);
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('P'));
  let earlier!: Promise<void>;
  act(() => {
    earlier = view.result.current.savePropertyToFolder('P', null);
  });
  const rejected = expect(earlier).rejects.toBeInstanceOf(SavedPropertyChangeSupersededError);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await act(async () => {
    await view.result.current.unsaveProperty('P');
  });
  await act(async () => {
    if (succeeds) finishFirst(undefined);
    else failFirst(new Error('network'));
    await rejected;
  });
  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(toast.error).not.toHaveBeenCalled();
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('P'));
});

it('suppresses callbacks for an older notes mutation after a later one succeeds', async () => {
  getSaved.mockResolvedValue(properties('P'));
  getFolders.mockResolvedValue(folders('folder'));
  let finishFirst!: () => void;
  updateNotes
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const view = renderHook(
    () => ({ first: useSavedNotesMutation(), second: useSavedNotesMutation() }),
    { wrapper },
  );
  await waitFor(() => expect(getSaved).toHaveBeenCalled());
  const onSuccess = jest.fn();
  const onError = jest.fn();
  const onSettled = jest.fn();
  const laterSuccess = jest.fn();
  let earlier!: Promise<void>;
  act(() => {
    earlier = view.result.current.first.mutateAsync(
      { propertyId: 'P', notes: 'old' },
      { onSuccess, onError, onSettled },
    );
  });
  const rejected = expect(earlier).rejects.toBeInstanceOf(SavedPropertyChangeSupersededError);
  await waitFor(() => expect(updateNotes).toHaveBeenCalledTimes(1));
  await act(async () => {
    await view.result.current.second.mutateAsync(
      { propertyId: 'P', notes: 'new' },
      { onSuccess: laterSuccess },
    );
  });
  await act(async () => {
    finishFirst();
    await rejected;
  });
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(onSettled).not.toHaveBeenCalled();
  expect(laterSuccess).toHaveBeenCalledTimes(1);
});

it('supersedes an earlier preparation across null to known session recovery', async () => {
  mockAuth.activeSessionId = null;
  const empty = { ...properties('unused'), properties: [], total: 0 };
  getSaved
    .mockResolvedValueOnce(properties('P'))
    .mockResolvedValueOnce(properties('P'))
    .mockResolvedValue(empty);
  getFolders.mockResolvedValue(folders('folder'));
  unsave.mockResolvedValue(undefined);
  let finishPreparation!: () => void;
  const spy = jest.spyOn(client, 'cancelQueries').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPreparation = resolve;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('P'));
  let earlier!: Promise<void>;
  act(() => {
    earlier = view.result.current.savePropertyToFolder('P', null);
  });
  const rejected = expect(earlier).rejects.toBeInstanceOf(SavedPropertyChangeSupersededError);
  await waitFor(() => expect(finishPreparation).toBeDefined());
  act(() => {
    mockAuth.activeSessionId = 'session-A';
    view.rerender(undefined);
  });
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(2));
  await act(async () => {
    await view.result.current.unsaveProperty('P');
  });
  expect(getSaved).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishPreparation();
    await rejected;
  });
  expect(save).not.toHaveBeenCalled();
  await waitFor(() => expect(getSaved).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(view.result.current.savedProperties).toEqual([]));
  spy.mockRestore();
});

it('clears the save spinner after a newer notes action supersedes the pending save', async () => {
  getSaved.mockResolvedValue(properties('P'));
  getFolders.mockResolvedValue(folders('folder'));
  updateNotes.mockResolvedValue(undefined);
  let finishSave!: (value: unknown) => void;
  save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('P'));
  let earlier!: Promise<void>;
  act(() => {
    earlier = view.result.current.savePropertyToFolder('P', null);
  });
  const rejected = expect(earlier).rejects.toBeInstanceOf(SavedPropertyChangeSupersededError);
  await waitFor(() => expect(view.result.current.isPropertySaving('P')).toBe(true));
  await act(async () => {
    await view.result.current.updateNotes('P', 'new note');
  });
  await act(async () => {
    finishSave(undefined);
    await rejected;
  });
  await waitFor(() => expect(view.result.current.isPropertySaving('P')).toBe(false));
});

it('keeps the spinner while a later save on the same property is still active', async () => {
  getSaved.mockResolvedValue(properties('P'));
  getFolders.mockResolvedValue(folders('folder'));
  let first!: (value: unknown) => void;
  let second!: (value: unknown) => void;
  save
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          second = resolve;
        }),
    );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('P'));
  let older!: Promise<void>;
  let newer!: Promise<void>;
  act(() => {
    older = view.result.current.savePropertyToFolder('P', null);
  });
  const rejected = expect(older).rejects.toBeInstanceOf(SavedPropertyChangeSupersededError);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  act(() => {
    newer = view.result.current.savePropertyToFolder('P', null);
  });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await act(async () => {
    first(undefined);
    await rejected;
  });
  expect(view.result.current.isPropertySaving('P')).toBe(true);
  await act(async () => {
    second(undefined);
    await newer;
  });
  await waitFor(() => expect(view.result.current.isPropertySaving('P')).toBe(false));
});

it('does not clear B save spinner when an earlier A save completes', async () => {
  getSaved.mockResolvedValueOnce(properties('A-home')).mockResolvedValue(properties('B-home'));
  getFolders.mockResolvedValue(folders('folder'));
  let finishA!: (value: unknown) => void;
  let finishB!: (value: unknown) => void;
  save
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishA = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishB = resolve;
        }),
    );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('A-home'));
  let a!: Promise<void>;
  act(() => {
    a = view.result.current.savePropertyToFolder('P', null);
  });
  const rejected = expect(a).rejects.toThrow('The active account changed');
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  act(() => {
    oxy.session.setAccessToken(token('B'));
    mockAuth.user = { id: 'B' };
    mockAuth.activeSessionId = 'session-B';
    view.rerender(undefined);
  });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('B-home'));
  let b!: Promise<void>;
  act(() => {
    b = view.result.current.savePropertyToFolder('P', null);
  });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await act(async () => {
    finishA(undefined);
    await rejected;
  });
  expect(view.result.current.isPropertySaving('P')).toBe(true);
  await act(async () => {
    finishB(undefined);
    await b;
  });
  await waitFor(() => expect(view.result.current.isPropertySaving('P')).toBe(false));
});

it('attempts folder and saved-home actions offline with Homiio offlineFirst defaults', async () => {
  client.setDefaultOptions({
    queries: { retry: false, networkMode: 'always' },
    mutations: { networkMode: 'offlineFirst', retry: 0 },
  });
  client.mount();
  getSaved.mockResolvedValue(properties('P'));
  getFolders.mockResolvedValue(folders('folder'));
  save.mockRejectedValue(new Error('offline'));
  updateFolder.mockRejectedValue(new Error('offline'));
  act(() => {
    onlineManager.setOnline(false);
  });
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('P'));
  await act(async () => {
    const saveResult = view.result.current.savePropertyToFolder('P', null);
    const folderResult = view.result.current.updateFolder('folder', { name: 'new name' });
    await Promise.all([
      expect(saveResult).rejects.toThrow('offline'),
      expect(folderResult).rejects.toThrow('offline'),
    ]);
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(updateFolder).toHaveBeenCalledTimes(1);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

it('keeps the saving indicator while the same owner recovers a session id', async () => {
  mockAuth.activeSessionId = null;
  getSaved.mockResolvedValue(properties('P'));
  getFolders.mockResolvedValue(folders('folder'));
  let finish!: (value: unknown) => void;
  save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('P'));
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.savePropertyToFolder('P', null);
  });
  await waitFor(() => expect(view.result.current.isPropertySaving('P')).toBe(true));
  act(() => {
    mockAuth.activeSessionId = 'session-A';
    view.rerender(undefined);
  });
  expect(view.result.current.isPropertySaving('P')).toBe(true);
  await act(async () => {
    finish(undefined);
    await pending;
  });
  await waitFor(() => expect(view.result.current.isPropertySaving('P')).toBe(false));
});

it('keeps the newer saving indicator when an earlier save finishes after session recovery', async () => {
  mockAuth.activeSessionId = null;
  getSaved.mockResolvedValue(properties('P'));
  getFolders.mockResolvedValue(folders('folder'));
  let finishFirst!: (value: unknown) => void;
  let finishSecond!: (value: unknown) => void;
  save
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = resolve;
        }),
    );
  const view = renderHook(() => useSavedPropertiesContext(), { wrapper });
  await waitFor(() => expect(view.result.current.savedProperties[0]?.id).toBe('P'));
  let earlier!: Promise<void>;
  act(() => {
    earlier = view.result.current.savePropertyToFolder('P', null);
  });
  const rejected = expect(earlier).rejects.toBeInstanceOf(SavedPropertyChangeSupersededError);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  act(() => {
    mockAuth.activeSessionId = 'session-A';
    view.rerender(undefined);
  });
  let later!: Promise<void>;
  act(() => {
    later = view.result.current.savePropertyToFolder('P', null);
  });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await act(async () => {
    finishFirst(undefined);
    await rejected;
  });
  expect(view.result.current.isPropertySaving('P')).toBe(true);
  await act(async () => {
    finishSecond(undefined);
    await later;
  });
  await waitFor(() => expect(view.result.current.isPropertySaving('P')).toBe(false));
});
