/**
 * Opening a listing's detail screen records ONE view; refreshing what the
 * screen shows never records another.
 *
 * The server counts a view on `POST /api/properties/:id/open` (the counter, and
 * the signed-in person's recently-viewed history). A refetch that reached it —
 * an invalidation after an edit, a window focus, a reconnect — would inflate
 * both, which is exactly the bug the plain read was split off to fix. So the
 * listing's data and the open are separate cache entries, and these tests drive
 * the data's every refresh path while counting the opens.
 */
import type React from 'react';
import type { ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { api } from '@/utils/api';
import { useProperty, useRecordPropertyOpen } from '@/hooks/usePropertyQueries';

jest.mock('@/utils/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  ApiError: class ApiError extends Error {},
}));

jest.mock('@oxy.so/services', () => ({
  useOxy: () => ({ oxyServices: null, activeSessionId: null }),
}));

const apiGet = api.get as jest.MockedFunction<typeof api.get>;
const apiPost = api.post as jest.MockedFunction<typeof api.post>;

const LISTING_ID = 'listing-1';
const OPEN_URL = `/api/properties/${LISTING_ID}/open`;

/** What the detail screen does: show the listing, and record that it was opened. */
function useDetailScreen(id: string) {
  const { property } = useProperty(id);
  useRecordPropertyOpen(id);
  return property;
}

/**
 * ONE client per test, created outside the wrapper component — built inside
 * it, every render would make a new client and a new cache.
 */
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function opens(): number {
  return apiPost.mock.calls.filter(([url]) => url === OPEN_URL).length;
}

beforeEach(() => {
  client = new QueryClient();
  apiGet.mockResolvedValue({ data: { success: true, data: { id: LISTING_ID } } });
  apiPost.mockResolvedValue({ data: { success: true, data: null } });
});

afterEach(() => {
  client.clear();
  jest.clearAllMocks();
});

/** Mount the screen and wait until it shows the listing and has sent `expectedOpens` in all. */
async function openScreen(expectedOpens = 1) {
  const screen = renderHook(() => useDetailScreen(LISTING_ID), { wrapper });
  await waitFor(() => expect(screen.result.current).toEqual({ id: LISTING_ID }));
  await waitFor(() => expect(opens()).toBe(expectedOpens));
  return screen;
}

describe('the detail screen records an open', () => {
  it('once, when it is opened', async () => {
    await openScreen();
    expect(opens()).toBe(1);
  });

  it('not again when the listing is invalidated — the data refreshes, the open does not', async () => {
    await openScreen();
    const readsBefore = apiGet.mock.calls.length;

    await act(() => client.invalidateQueries({ queryKey: ['property', LISTING_ID] }));

    // The negative control: the listing really did refetch, so the open
    // staying at one is not just "nothing ran".
    expect(apiGet.mock.calls.length).toBe(readsBefore + 1);
    expect(opens()).toBe(1);
  });

  it('not again on a window focus or a reconnect', async () => {
    await openScreen();

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });

    expect(opens()).toBe(1);
    focusManager.setFocused(undefined);
  });

  it('again on the next visit — leaving the screen ends this open', async () => {
    const first = await openScreen();
    first.unmount();
    // The open's cache entry is collected as soon as nothing shows it.
    await waitFor(() =>
      expect(
        client.getQueryCache().find({ queryKey: ['propertyOpen', LISTING_ID] }),
      ).toBeUndefined(),
    );

    await openScreen(2);
  });
});
