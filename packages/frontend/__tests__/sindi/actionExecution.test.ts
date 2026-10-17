/**
 * WHEN the executor does each part of an action.
 *
 * ## The timing
 *
 * Sindi lives in one surface, the SDK's sheet, mounted above the app frame. A
 * host-tool call arrives MID-STREAM: Alia emits `alia.host_action` when the
 * model calls `host_homiio__<name>`, and the model then keeps writing. The page
 * UNDER the sheet changes at once — the sheet survives any navigation — but the
 * sheet itself only gets out of the way once the turn stops streaming, or the
 * person would lose the answer they asked for.
 *
 * The turn's end is the SDK's own conversation store (`streamingConversationId`).
 * The tests drive that real store rather than calling a settle function, so they
 * fail if the executor stops listening to it.
 */

import { act, renderHook } from '@testing-library/react-native';
import { type AliaHostAction, useConversationStore } from '@alia.onl/sdk/runtime';

import { SINDI_HOST_APP } from '@/components/sindi/sindiHostTools';
import { DESTINATION_ROUTES, useSindiActions } from '@/hooks/useSindiActions';
import { useExploreViewStore } from '@/store/exploreViewStore';
import { DEFAULT_SEARCH_QUERY, useSearchQueryStore } from '@/store/searchQueryStore';

const mockPush = jest.fn();
const mockCloseSheet = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
  }),
}));

let calls = 0;
const call = (name: string, input: Record<string, unknown>): AliaHostAction => {
  calls += 1;
  return { toolCallId: `call_${calls}`, app: SINDI_HOST_APP, name, input };
};
const toExplore = () => call('navigate', { destination: 'explore' });

function executor() {
  const hook = renderHook(() => useSindiActions(mockCloseSheet));
  const run = async (action: AliaHostAction) => {
    let outcome: string | undefined;
    await act(async () => {
      outcome = (await hook.result.current.hostTools.execute(action)).outcome;
    });
    return outcome;
  };
  return { ...hook, run };
}

/** A turn is streaming in conversation `c1`, as the SDK's thread reports it. */
const streaming = () => act(() => useConversationStore.getState().setStreamingConversationId('c1'));
/** The stream stopped — finished, or the person pressed Stop. */
const settled = () => act(() => useConversationStore.getState().setStreamingConversationId(null));

beforeEach(() => {
  mockPush.mockClear();
  mockCloseSheet.mockClear();
  useConversationStore.getState().setStreamingConversationId(null);
  useSearchQueryStore.getState().replaceSearch(DEFAULT_SEARCH_QUERY);
  useExploreViewStore.getState().setResultsView('list');
});

describe('the page under the sheet changes at once', () => {
  it('navigates on arrival, while the answer is still streaming', async () => {
    const { run } = executor();
    streaming();
    expect(await run(toExplore())).toBe('applied');
    expect(mockPush).toHaveBeenCalledWith('/explore');
  });

  it('applies the search to the store and navigates in one go', async () => {
    const { run } = executor();
    streaming();
    await run(call('apply_search', { priceMax: 1200 }));

    expect(useSearchQueryStore.getState().query.priceMax).toBe(1200);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/explore?'));
  });

  it('brings Explore with the list/map switch — a store write nobody can see is no action', async () => {
    const { run } = executor();
    await run(call('set_results_view', { view: 'map' }));

    expect(useExploreViewStore.getState().resultsView).toBe('map');
    expect(mockPush).toHaveBeenCalledWith('/explore');
  });
});

describe('the sheet steps aside once the answer is written', () => {
  it('does NOT close while the answer is still streaming', async () => {
    const { run } = executor();
    streaming();
    await run(toExplore());
    expect(mockCloseSheet).not.toHaveBeenCalled();
  });

  it('closes when the turn settles — after Stop as much as after the last word — exactly once', async () => {
    const { run } = executor();
    streaming();
    await run(toExplore());
    settled();
    streaming();
    settled();
    expect(mockCloseSheet).toHaveBeenCalledTimes(1);
  });

  it('closes at once when nothing is streaming — there is no answer left to cut off', async () => {
    const { run } = executor();
    await run(toExplore());
    expect(mockCloseSheet).toHaveBeenCalledTimes(1);
  });
});

describe('the refusals', () => {
  it('rejects a call outside the contract, moves nothing and keeps the sheet', async () => {
    const { run } = executor();
    expect(await run(call('navigate', { destination: 'https://example.com' }))).toBe('rejected');
    expect(await run(call('pay_rent', { leaseId: 'x' }))).toBe('rejected');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockCloseSheet).not.toHaveBeenCalled();
  });

  it('answers stale when the person changed the search after sending the turn', async () => {
    // #519 §8.8: their change wins, and the model is told so.
    const { result, run } = executor();
    act(() => result.current.runtime.onTurnStart?.());
    act(() =>
      useSearchQueryStore.getState().replaceSearch({ ...DEFAULT_SEARCH_QUERY, priceMax: 700 }),
    );
    streaming();
    expect(await run(call('apply_search', { bedrooms: 3 }))).toBe('stale');
    settled();

    expect(useSearchQueryStore.getState().query.bedrooms).not.toBe(3);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockCloseSheet).not.toHaveBeenCalled();
  });

  it('applies when the search is as it was when the turn was sent', async () => {
    const { result, run } = executor();
    act(() => result.current.runtime.onTurnStart?.());
    expect(await run(call('apply_search', { bedrooms: 3 }))).toBe('applied');
    expect(useSearchQueryStore.getState().query.bedrooms).toBe(3);
  });

  it('answers failed for an area Explore cannot carry, and navigates nowhere', async () => {
    // A polygon has no `loc` wire format yet (ADR 0002 §2.1): navigating anyway
    // would drop the scope and answer globally under a local heading.
    const { run } = executor();
    expect(await run(call('apply_search', { location: { kind: 'polygon', rings: [] } }))).toBe(
      'failed',
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockCloseSheet).not.toHaveBeenCalled();
  });
});

describe('what settling does not do', () => {
  it('closes nothing for a turn that produced no action', () => {
    executor();
    streaming();
    settled();
    expect(mockCloseSheet).not.toHaveBeenCalled();
  });

  it('discards a deferred close when the executor leaves', async () => {
    const { run, unmount } = executor();
    streaming();
    await run(toExplore());
    unmount();
    settled();
    expect(mockCloseSheet).not.toHaveBeenCalled();
  });
});

describe('every destination the executor can reach is a real route', () => {
  // A CTA that ends on the wrong screen is the failure a types-only check
  // cannot see: `router.push('/sved')` compiles. Expo Router derives routes
  // from the filesystem, so the check is that each path the executor can
  // produce has a file behind it.
  const { existsSync, readFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
  const { join } = jest.requireActual<typeof import('node:path')>('node:path');
  const frontend = join(__dirname, '..', '..');
  const appDir = join(frontend, 'app');

  const ROUTE_FILES: ReadonlyArray<[string, readonly string[]]> = [
    ['/explore', ['explore/index.tsx']],
    ['/saved', ['(tabs)/saved/index.tsx']],
    ['/saved/[folderId]', ['(tabs)/saved/[folderId]/index.tsx', '(tabs)/saved/[folderId].tsx']],
    ['/', ['(tabs)/index.tsx']],
    ['/my-home', ['my-home.tsx']],
    ['/evictions', ['evictions/index.tsx']],
    ['/properties/[id]', ['properties/[id]/index.tsx', 'properties/[id].tsx']],
  ];

  it.each(ROUTE_FILES)('%s exists', (route, candidates) => {
    const found = candidates.some((candidate) => existsSync(join(appDir, candidate)));
    expect({ route, found }).toEqual({ route, found: true });
  });

  it('the destination table names only those routes', () => {
    const known = new Set(ROUTE_FILES.map(([route]) => route));
    for (const route of Object.values(DESTINATION_ROUTES)) expect(known.has(route)).toBe(true);
  });

  it('the executor names no path outside that table', () => {
    // Every absolute-path STRING LITERAL in the executor, wherever it sits —
    // the destination table, a `pathname:` field or a bare `router.push`.
    const executor = readFileSync(join(frontend, 'hooks/useSindiActions.ts'), 'utf8');
    const paths = [...executor.matchAll(/'(\/[^']*)'/g)].map((match) => match[1]);
    const known = new Set(ROUTE_FILES.map(([route]) => route));

    expect(paths.filter((path) => !known.has(path))).toEqual([]);
    // A vacuity floor: a regex that stopped matching would pass the line above.
    expect(paths.length).toBeGreaterThanOrEqual(ROUTE_FILES.length - 1);
  });
});
