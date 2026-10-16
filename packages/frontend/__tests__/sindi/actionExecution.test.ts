/**
 * WHEN the executor does each part of an action, per host.
 *
 * `controlCapability.test.ts` pins the decision; this pins the consequence, and
 * the two halves are separate because the interesting property here is a
 * TIMING, which a pure function cannot express.
 *
 * ## The timing
 *
 * A host-tool call arrives MID-STREAM: Alia emits `alia.host_action` when the
 * model calls `host_homiio__<name>`, and the model then keeps writing. Two of
 * the three acting modes end with the chat's own surface gone: the overlay
 * panel closes (`SindiPanel` renders null once `sindiPanelOpen` is false) and
 * the full-screen chat navigates away (it is the routed screen, inside
 * `app/_layout.tsx`'s `<Slot/>`; the panel by contrast is mounted BESIDE the
 * slot and survives navigation). Doing either on arrival unmounts a streaming
 * chat: the app moves and the answer the person asked for never appears.
 *
 * So those steps wait for the turn to stop streaming, which the SDK's own
 * conversation store announces (`streamingConversationId`). The tests drive
 * that real store rather than calling a settle function, so they fail if the
 * executor stops listening to it.
 */

import { act, renderHook } from '@testing-library/react-native';
import { type AliaHostAction, useConversationStore } from '@alia.onl/sdk/runtime';

import type { SindiChatHost } from '@/components/sindi/sindiHost';
import { SINDI_HOST_APP } from '@/components/sindi/sindiHostTools';
import { DESTINATION_ROUTES, useSindiActions } from '@/hooks/useSindiActions';
import { useExploreViewStore } from '@/store/exploreViewStore';
import { DEFAULT_SEARCH_QUERY, useSearchQueryStore } from '@/store/searchQueryStore';

const mockPush = jest.fn();
const mockClosePanel = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
  }),
}));

/** The panel tier the shell would produce. Set per test; see `useSindiPanelLayout`. */
let mockPanelLayout = { visible: true, docked: true, width: 380 };

// Only the hook is replaced: the rest of the module is the real thing, so this
// file cannot pass by mocking away the very layout rules it is reasoning about.
jest.mock('@/components/sindi/sindiPanelLayout', () => ({
  ...jest.requireActual('@/components/sindi/sindiPanelLayout'),
  useSindiPanelLayout: () => mockPanelLayout,
}));

jest.mock('@/store/uiStore', () => {
  const state = { closeSindiPanel: (...args: unknown[]) => mockClosePanel(...args) };
  const useUIStore = (selector: (value: typeof state) => unknown) => selector(state);
  useUIStore.getState = () => state;
  return { useUIStore };
});

let calls = 0;
const call = (name: string, input: Record<string, unknown>): AliaHostAction => {
  calls += 1;
  return { toolCallId: `call_${calls}`, app: SINDI_HOST_APP, name, input };
};
const toExplore = () => call('navigate', { destination: 'explore' });

function executor(host: SindiChatHost) {
  const hook = renderHook(() => useSindiActions(host));
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
  mockClosePanel.mockClear();
  mockPanelLayout = { visible: true, docked: true, width: 380 };
  useConversationStore.getState().setStreamingConversationId(null);
  useSearchQueryStore.getState().replaceSearch(DEFAULT_SEARCH_QUERY);
  useExploreViewStore.getState().setResultsView('list');
});

describe('the docked panel acts at once, because nothing it does hides the chat', () => {
  it('navigates the page column on arrival', async () => {
    const { run } = executor('panel');
    streaming();
    expect(await run(toExplore())).toBe('applied');
    expect(mockPush).toHaveBeenCalledWith('/explore');
  });

  it('leaves the panel open — it is the surface the person is talking in', async () => {
    const { run } = executor('panel');
    streaming();
    await run(toExplore());
    settled();
    expect(mockClosePanel).not.toHaveBeenCalled();
  });
});

describe('the overlay panel acts at once and steps aside when the turn ends', () => {
  beforeEach(() => {
    mockPanelLayout = { visible: true, docked: false, width: 380 };
  });

  it('navigates the page under the scrim immediately', async () => {
    // Safe on arrival: the panel is mounted beside `<Slot/>`, so changing the
    // route does not unmount the chat that is still streaming.
    const { run } = executor('panel');
    streaming();
    expect(await run(toExplore())).toBe('applied');
    expect(mockPush).toHaveBeenCalledWith('/explore');
  });

  it('does NOT close the panel while the answer is still streaming', async () => {
    const { run } = executor('panel');
    streaming();
    await run(toExplore());
    expect(mockClosePanel).not.toHaveBeenCalled();
  });

  it('closes it once the turn settles, exactly once', async () => {
    const { run } = executor('panel');
    streaming();
    await run(toExplore());
    settled();
    streaming();
    settled();
    expect(mockClosePanel).toHaveBeenCalledTimes(1);
  });
});

describe('the full-screen chat leaves for the destination, after it has spoken', () => {
  it('does not navigate while the answer is still streaming', async () => {
    const { run } = executor('screen');
    streaming();
    // The whole point: this screen IS the route, so pushing here replaces a
    // chat that has not finished its sentence.
    expect(await run(toExplore())).toBe('applied');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('navigates when the turn settles — after Stop as much as after the last word', async () => {
    const { run } = executor('screen');
    streaming();
    await run(toExplore());
    settled();
    expect(mockPush).toHaveBeenCalledWith('/explore');
  });

  it('acts whatever the side panel happens to be doing', async () => {
    // `sindiPanelOpen` is persisted, and it used to decide this. All three
    // tiers must produce the same navigation.
    for (const tier of [
      { visible: true, docked: true, width: 380 },
      { visible: true, docked: false, width: 380 },
      { visible: false, docked: false, width: 380 },
    ]) {
      mockPush.mockClear();
      mockPanelLayout = tier;
      const { run, unmount } = executor('screen');
      streaming();
      await run(toExplore());
      settled();
      expect(mockPush).toHaveBeenCalledWith('/explore');
      unmount();
    }
  });

  it('applies the search to the store at once and only the navigation waits', async () => {
    // The split that keeps the reported outcome honest: by the time the model
    // reads "applied", the query really has changed — what is outstanding is the
    // screen the person is about to be taken to.
    const { run } = executor('screen');
    streaming();
    await run(call('apply_search', { priceMax: 1200 }));

    expect(useSearchQueryStore.getState().query.priceMax).toBe(1200);
    expect(mockPush).not.toHaveBeenCalled();

    settled();
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/explore?'));
  });

  it('goes at once when nothing is streaming — there is no answer left to cut off', async () => {
    const { run } = executor('screen');
    await run(toExplore());
    expect(mockPush).toHaveBeenCalledWith('/explore');
  });
});

describe('the list/map switch: the one action that changes nothing on its own', () => {
  it('stays put for the docked panel, whose main pane is already on screen', async () => {
    const { run } = executor('panel');
    streaming();
    await run(call('set_results_view', { view: 'map' }));
    settled();

    expect(useExploreViewStore.getState().resultsView).toBe('map');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('brings Explore with it from a host that is covering the app', async () => {
    // A store write nobody can see is the invisible action this exists to stop.
    mockPanelLayout = { visible: false, docked: false, width: 380 };
    const { run } = executor('screen');
    streaming();
    await run(call('set_results_view', { view: 'map' }));
    settled();

    expect(useExploreViewStore.getState().resultsView).toBe('map');
    expect(mockPush).toHaveBeenCalledWith('/explore');
  });
});

describe('the sheet moves nothing', () => {
  it('answers inline, now and when the turn settles', async () => {
    const { run } = executor('sheet');
    streaming();
    expect(await run(toExplore())).toBe('inline');
    settled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('the refusals', () => {
  it('rejects a call outside the contract and moves nothing', async () => {
    const { run } = executor('panel');
    expect(await run(call('navigate', { destination: 'https://example.com' }))).toBe('rejected');
    expect(await run(call('pay_rent', { leaseId: 'x' }))).toBe('rejected');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('answers stale when the person changed the search after sending the turn', async () => {
    // #519 §8.8: their change wins, and the model is told so.
    const { result, run } = executor('screen');
    act(() => result.current.runtime.onTurnStart?.());
    act(() =>
      useSearchQueryStore.getState().replaceSearch({ ...DEFAULT_SEARCH_QUERY, priceMax: 700 }),
    );
    streaming();
    expect(await run(call('apply_search', { bedrooms: 3 }))).toBe('stale');
    settled();

    expect(useSearchQueryStore.getState().query.bedrooms).not.toBe(3);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('applies when the search is as it was when the turn was sent', async () => {
    const { result, run } = executor('panel');
    act(() => result.current.runtime.onTurnStart?.());
    expect(await run(call('apply_search', { bedrooms: 3 }))).toBe('applied');
    expect(useSearchQueryStore.getState().query.bedrooms).toBe(3);
  });

  it('answers failed for an area Explore cannot carry, and navigates nowhere', async () => {
    // A polygon has no `loc` wire format yet (ADR 0002 §2.1): navigating anyway
    // would drop the scope and answer globally under a local heading.
    const { run } = executor('panel');
    expect(await run(call('apply_search', { location: { kind: 'polygon', rings: [] } }))).toBe(
      'failed',
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('what settling does not do', () => {
  it('drains nothing for a turn that produced no action', () => {
    executor('screen');
    streaming();
    settled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClosePanel).not.toHaveBeenCalled();
  });

  it('discards a deferred navigation when its surface leaves', async () => {
    const { run, unmount } = executor('screen');
    streaming();
    await run(toExplore());
    unmount();
    settled();
    expect(mockPush).not.toHaveBeenCalled();
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
