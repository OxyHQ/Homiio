/**
 * WHEN the executor does each part of an action, per host.
 *
 * `controlCapability.test.ts` pins the decision; this pins the consequence, and
 * the two halves are separate because the interesting property here is a
 * TIMING, which a pure function cannot express.
 *
 * ## The measurement the timing comes from
 *
 * `backend/routes/ai.ts#pipeStreamingTextDataStream` awaits the action envelope
 * and writes it to the data channel **before the first text delta** — the
 * comment there says so and gives the reason (apply the action while the
 * sentence describing it arrives). So when `execute` runs, Sindi has not said
 * anything yet.
 *
 * Two of the three acting modes end with the chat's own surface gone: the
 * overlay panel closes (`SindiPanel` renders null once `sindiPanelOpen` is
 * false) and the full-screen chat navigates away (it is the routed screen,
 * inside `app/_layout.tsx`'s `<Slot/>`; the panel by contrast is mounted BESIDE
 * the slot and survives navigation). Doing either on the frame that precedes
 * the text unmounts a streaming chat: the app moves and the answer the person
 * asked for never appears in front of them.
 *
 * So those steps wait for `settleTurn`, which `useSindiConversation` calls when
 * the stream stops. Everything below is that rule, one assertion at a time.
 */

import { act, renderHook } from '@testing-library/react-native';

import { SINDI_ACTION_VERSION, type SindiActionEnvelope } from '@homiio/shared-types';

import { useSindiActions } from '@/hooks/useSindiActions';
import type { SindiChatHost } from '@/components/sindi/sindiHost';
import { useExploreViewStore } from '@/store/exploreViewStore';
import { DEFAULT_SEARCH_QUERY, useSearchQueryStore } from '@/store/searchQueryStore';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockClosePanel = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args), replace: mockReplace, back: jest.fn() }),
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

const TURN = 't1';
const REVISION = 7;

const envelope = (overrides: Partial<SindiActionEnvelope> = {}): SindiActionEnvelope => ({
  version: SINDI_ACTION_VERSION,
  actionId: `a${Math.random().toString(36).slice(2)}`,
  turnId: TURN,
  contextRevision: REVISION,
  action: { kind: 'navigate', destination: 'explore' },
  ...overrides,
});

function executor(host: SindiChatHost) {
  const executions: string[] = [];
  const { result } = renderHook(() =>
    useSindiActions({
      host,
      activeTurnId: TURN,
      contextRevision: REVISION,
      onExecuted: ({ outcome }) => executions.push(outcome),
    }),
  );
  return { result, executions };
}

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockClosePanel.mockClear();
  mockPanelLayout = { visible: true, docked: true, width: 380 };
  useSearchQueryStore.getState().replaceSearch(DEFAULT_SEARCH_QUERY);
  useExploreViewStore.getState().setResultsView('list');
});

describe('the docked panel acts at once, because nothing it does hides the chat', () => {
  it('navigates the page column on arrival', () => {
    const { result, executions } = executor('panel');
    act(() => {
      result.current.execute(envelope());
    });

    expect(mockPush).toHaveBeenCalledWith('/explore');
    expect(executions).toEqual(['applied']);
  });

  it('leaves the panel open — it is the surface the person is talking in', () => {
    const { result } = executor('panel');
    act(() => {
      result.current.execute(envelope());
      result.current.settleTurn();
    });

    expect(mockClosePanel).not.toHaveBeenCalled();
  });
});

describe('the overlay panel acts at once and steps aside when the turn ends', () => {
  beforeEach(() => {
    mockPanelLayout = { visible: true, docked: false, width: 380 };
  });

  it('navigates the page under the scrim immediately', () => {
    // Safe on arrival: the panel is mounted beside `<Slot/>`, so changing the
    // route does not unmount the chat that is still streaming.
    const { result, executions } = executor('panel');
    act(() => {
      result.current.execute(envelope());
    });

    expect(mockPush).toHaveBeenCalledWith('/explore');
    expect(executions).toEqual(['applied']);
  });

  it('does NOT close the panel while the answer is still streaming', () => {
    const { result } = executor('panel');
    act(() => {
      result.current.execute(envelope());
    });

    // Closing here would unmount `ChatContent` mid-stream and the person would
    // be looking at Explore with no idea what Sindi was about to say.
    expect(mockClosePanel).not.toHaveBeenCalled();
  });

  it('closes it once the turn settles, exactly once', () => {
    const { result } = executor('panel');
    act(() => {
      result.current.execute(envelope());
      result.current.settleTurn();
      result.current.settleTurn();
    });

    expect(mockClosePanel).toHaveBeenCalledTimes(1);
  });
});

describe('the full-screen chat leaves for the destination, after it has spoken', () => {
  it('does not navigate on the frame that arrives before the text', () => {
    const { result, executions } = executor('screen');
    act(() => {
      result.current.execute(envelope());
    });

    // The whole point: this screen IS the route, so pushing here replaces a
    // chat that has not written a word yet.
    expect(mockPush).not.toHaveBeenCalled();
    expect(executions).toEqual(['applied']);
  });

  it('navigates when the turn settles', () => {
    const { result } = executor('screen');
    act(() => {
      result.current.execute(envelope());
      result.current.settleTurn();
    });

    expect(mockPush).toHaveBeenCalledWith('/explore');
  });

  it('acts whatever the side panel happens to be doing', () => {
    // `sindiPanelOpen` is persisted, and it used to decide this. All three
    // tiers must now produce the same navigation.
    for (const tier of [
      { visible: true, docked: true, width: 380 },
      { visible: true, docked: false, width: 380 },
      { visible: false, docked: false, width: 380 },
    ]) {
      mockPush.mockClear();
      mockPanelLayout = tier;
      const { result } = executor('screen');
      act(() => {
        result.current.execute(envelope());
        result.current.settleTurn();
      });
      expect(mockPush).toHaveBeenCalledWith('/explore');
    }
  });

  it('applies the search to the store at once and only the navigation waits', () => {
    // The split that keeps the reported outcome honest: by the time the card
    // says "Done", the query really has changed — what is outstanding is the
    // screen the person is about to be taken to.
    const { result } = executor('screen');
    act(() => {
      result.current.execute(
        envelope({ action: { kind: 'apply_search', patch: { priceMax: 1200 } } }),
      );
    });

    expect(useSearchQueryStore.getState().query.priceMax).toBe(1200);
    expect(mockPush).not.toHaveBeenCalled();

    act(() => {
      result.current.settleTurn();
    });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/explore?'));
  });
});

describe('the list/map switch: the one action that changes nothing on its own', () => {
  it('stays put for the docked panel, whose main pane is already on screen', () => {
    const { result } = executor('panel');
    act(() => {
      result.current.execute(envelope({ action: { kind: 'set_results_view', view: 'map' } }));
      result.current.settleTurn();
    });

    expect(useExploreViewStore.getState().resultsView).toBe('map');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('brings Explore with it from a host that is covering the app', () => {
    // A store write nobody can see is the invisible action this change exists
    // to stop: the view belongs to Explore, and from the full-screen chat the
    // person is not looking at Explore.
    mockPanelLayout = { visible: false, docked: false, width: 380 };
    const { result } = executor('screen');
    act(() => {
      result.current.execute(envelope({ action: { kind: 'set_results_view', view: 'map' } }));
      result.current.settleTurn();
    });

    expect(useExploreViewStore.getState().resultsView).toBe('map');
    expect(mockPush).toHaveBeenCalledWith('/explore');
  });
});

describe('the in-property sheet offers, and a press is the intervention', () => {
  it('answers inline and moves nothing', () => {
    const { result, executions } = executor('sheet');
    act(() => {
      result.current.execute(envelope());
      result.current.settleTurn();
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(executions).toEqual(['inline']);
  });

  it('acts immediately when the person presses the offer', () => {
    const { result } = executor('sheet');
    act(() => {
      result.current.take({ kind: 'navigate', destination: 'saved' });
    });

    expect(mockPush).toHaveBeenCalledWith('/saved');
  });
});

describe('what settling does not do', () => {
  it('drains nothing for a turn that produced no action', () => {
    const { result } = executor('screen');
    act(() => {
      result.current.settleTurn();
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClosePanel).not.toHaveBeenCalled();
  });

  it('never applies a refused envelope, deferred or otherwise', () => {
    // A turn that is no longer the active one: the refusal must happen before
    // anything is queued, or "Stop" would merely postpone the navigation it is
    // supposed to prevent.
    const { result, executions } = executor('screen');
    act(() => {
      result.current.execute(envelope({ turnId: 'another-turn' }));
      result.current.settleTurn();
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(executions).toEqual(['stale']);
  });
});
