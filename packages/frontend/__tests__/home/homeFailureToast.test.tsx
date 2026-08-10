/**
 * A failed Home request produces EXACTLY ONE message (#353).
 *
 * The production incident was four failed requests and nothing said. The render
 * path is pinned by `homeFailureSurfacing.test.ts`; this file pins the other
 * half — that a message is actually emitted, and that it is emitted ONCE rather
 * than once per retry, per re-render, or per anything else that happens more
 * often than a person fails to load a page.
 *
 * The toast module is mocked because it is the EXTERNAL SYSTEM under test here:
 * what matters is how many times the hook calls it and with what, not what
 * Bloom draws. Bloom's own rendering is Bloom's to test.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiError } from '@/utils/api';
import { homeSectionsFailureMessage, useHomeSections } from '@/hooks/useHomeSections';
import { OfferingType, type LocationSelection } from '@homiio/shared-types';

// `mock`-prefixed, because a `jest.mock` factory is hoisted above every other
// statement in the file and may only reach variables named that way — the one
// naming convention jest enforces rather than suggests.
const mockToastError = jest.fn();
jest.mock('@oxyhq/bloom/toast', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() },
}));

const mockFetchHomeSections = jest.fn();
jest.mock('@/services/homeSectionsService', () => ({
  fetchHomeSections: (...args: unknown[]) => mockFetchHomeSections(...args),
  UnscopableLocationError: class extends Error {},
}));

const BARCELONA: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: 'city-barcelona' },
  placeType: 'city',
  label: { primary: 'Barcelona', kind: 'place' },
  admin: { countryCode: 'ES', cityName: 'Barcelona' },
  precision: 'centroid',
  center: { longitude: 2.1686, latitude: 41.3874 },
};

function Probe({ selection }: { selection: LocationSelection | null }): React.ReactElement {
  const home = useHomeSections(selection, OfferingType.LONG_TERM_RENT, { enabled: true });
  return <Text>{home.error ? 'failed' : 'ok'}</Text>;
}

function renderProbe(selection: LocationSelection | null = BARCELONA) {
  // `retry: false` here is a DEFAULT, and the hook overrides it with its own
  // predicate — so these tests exercise that predicate rather than bypassing it.
  // That is not incidental: mutating the predicate to retry a 4xx turns this
  // file red as well as `homeFailureSurfacing.test.ts`, because the doomed
  // request is then attempted three times before the message appears. Measured,
  // not assumed — the first version of this comment claimed retries were off.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Probe selection={selection} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockToastError.mockClear();
  mockFetchHomeSections.mockReset();
});

describe('a failed Home request is never silent', () => {
  it('emits a message when the request fails', async () => {
    mockFetchHomeSections.mockRejectedValue(new ApiError('UNSUPPORTED_LOCATION', 400));

    const { findByText } = renderProbe();
    await findByText('failed');

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));

    // The message is TRANSLATED, so asserting an English sentence would pass
    // while shipping an untranslated string. What must hold is that the hook
    // asked i18n for THIS key and that whatever came back has words in it —
    // `t()` on an uninitialised i18next returns `undefined`, and a toast with no
    // text is the silent failure this file exists to prevent.
    const [message] = mockToastError.mock.calls[0] as [unknown];
    expect(typeof message).toBe('string');
    expect((message as string).trim().length).toBeGreaterThan(0);
    expect(message).toBe(homeSectionsFailureMessage());
  });

  it('emits exactly ONE message however often the surface re-renders', async () => {
    // The incident fired four requests. Whatever the retry count, a person
    // failing to load a page once should be told once.
    mockFetchHomeSections.mockRejectedValue(new ApiError('UNSUPPORTED_LOCATION', 400));

    const { findByText, rerender } = renderProbe();
    await findByText('failed');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    rerender(
      <QueryClientProvider client={client}>
        <Probe selection={BARCELONA} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('says NOTHING when the request succeeds', async () => {
    // The floor. Without it, a hook that toasted unconditionally would satisfy
    // both assertions above.
    mockFetchHomeSections.mockResolvedValue({
      location: { status: 'resolved', key: 'homiio:city:city-barcelona' },
      generatedAt: new Date().toISOString(),
      sections: [],
    });

    const { findByText } = renderProbe();
    await findByText('ok');

    expect(mockToastError).not.toHaveBeenCalled();
  });
});
