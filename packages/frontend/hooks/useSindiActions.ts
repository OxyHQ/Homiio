/**
 * The executor: the ONE place a host-tool call becomes something the app does.
 *
 * ## Where an action comes from
 *
 * Sindi (or Alia, inside Homiio) calls a host tool — `host_homiio__apply_search`
 * and the rest of `shared-types/sindiAction.ts#SINDI_HOST_TOOLS`. Alia records
 * the call, answers the model `{ status: 'dispatched' }` and emits
 * `alia.host_action` to this client, the only one that declared the tools. The
 * SDK hands it to `hostTools.execute` once per `toolCallId`, and the outcome this
 * hook returns (`applied | inline | rejected | stale | failed`) rides the NEXT
 * request, where the model reads what actually happened.
 *
 * It never interprets prose, never builds a URL from a model's string and never
 * reaches an API the model named: the input is re-validated by the same parser
 * that built the tool's JSON Schema, and every branch below performs a
 * navigation the app already supports.
 *
 * ## The refusals
 *
 *  - **Outside the contract** → `rejected` (`parseSindiHostCall` answers null).
 *  - **The person changed the search during the turn** → `stale`. The query's
 *    revision is taken when the turn is SENT (`runtime.onTurnStart`) and compared
 *    when the action arrives; their change wins (#519 §8.8).
 *  - **No surface that could show it** → `inline`. The capability is re-read at
 *    execution time, because a window can be resized mid-answer.
 *
 * Replays, a stopped turn and history need no check: the SDK performs a call
 * once, Stop aborts the stream that would carry a late call, and a stored
 * conversation carries no `alia.host_action` at all.
 *
 * ## Two things happen at different times
 *
 * The call arrives MID-STREAM: the model asks for the effect and then keeps
 * writing. Two of the three acting modes end with the chat's own surface gone —
 * the overlay panel closes, the full-screen route navigates away — and doing
 * that on arrival unmounts a chat that is still streaming, so the person sees
 * the app move and never reads the answer.
 *
 * So an action is split. The part that changes app STATE (the search query, the
 * results view) runs immediately. The part that takes the chat's surface away —
 * `router.push` from the full-screen chat, closing the overlay panel — waits for
 * the turn to stop streaming, which the SDK's conversation store announces
 * (`streamingConversationId` leaving the conversation that was streaming). It
 * also runs after **Stop**: stopping cancels the answer, and the answer is what
 * the navigation was waiting for. In `beside` mode nothing waits: the docked
 * panel is mounted beside `<Slot/>` and survives any navigation.
 *
 * ## A search is ONE navigation
 *
 * `apply_search` builds the whole next query and navigates to its `exploreHref`
 * in a single operation — never a bare `router.push('/explore')` followed by a
 * patch racing the URL's hydration (#519 §8.6).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'expo-router';
import {
  type AliaHostAction,
  type AliaHostOutcome,
  type AliaHostTools,
  type AliaRuntimeHost,
  useConversationStore,
} from '@alia.onl/sdk/runtime';
import type { SindiAction, SindiActionOutcome } from '@homiio/shared-types';

import {
  controlCapabilityOf,
  type SindiActMode,
  type SindiChatHost,
} from '@/components/sindi/sindiHost';
import {
  actionOfHostCall,
  hostOutcomeOf,
  SINDI_HOST_APP,
  SINDI_HOST_TOOL_DEFINITIONS,
} from '@/components/sindi/sindiHostTools';
import { useSindiPanelLayout } from '@/components/sindi/sindiPanelLayout';
import { revisionOf } from '@/hooks/useSindiAppContext';
import { useExploreViewStore } from '@/store/exploreViewStore';
import { useSearchQueryStore } from '@/store/searchQueryStore';
import { useUIStore } from '@/store/uiStore';
import { exploreHref } from '@/utils/searchUrl';
import { applySearchPatch, turnRefusal } from './sindiActionRules';

export { applySearchPatch, turnRefusal } from './sindiActionRules';

/** Where each enumerated destination actually lives. The ONLY path table. */
export const DESTINATION_ROUTES = {
  explore: '/explore',
  saved: '/saved',
  home: '/',
  my_home: '/my-home',
  evictions: '/evictions',
} as const;

export interface UseSindiActions {
  /** What the surface declares to Alia: the tools, and the executor behind them. */
  readonly hostTools: AliaHostTools;
  /** The runtime callbacks the executor needs: the moment a turn is sent. */
  readonly runtime: AliaRuntimeHost;
  /**
   * The turn has stopped streaming: run what was held back until it had.
   * Called when the SDK's stream ends; exported for the tests that pin WHEN.
   */
  readonly settleTurn: () => void;
}

export function useSindiActions(host: SindiChatHost): UseSindiActions {
  const router = useRouter();
  // The SDK reads the declaration when an action ARRIVES, so a resize
  // mid-answer re-derives the mode from the layout of that moment.
  const layout = useSindiPanelLayout();

  /** The live query's revision when the current turn was sent. */
  const turnRevision = useRef<number | null>(null);
  /** The steps that remove the chat from the screen, waiting for the turn to end. */
  const deferred = useRef<(() => void)[]>([]);

  const settleTurn = useCallback(() => {
    if (deferred.current.length === 0) return;
    // Taken and cleared BEFORE running, so a step cannot be re-run by the next settle.
    const pending = deferred.current;
    deferred.current = [];
    for (const run of pending) run();
  }, []);

  // A turn ends when the SDK stops streaming the conversation that was.
  useEffect(
    () =>
      useConversationStore.subscribe((state, previous) => {
        const was = previous.streamingConversationId;
        if (was !== null && state.streamingConversationId !== was) settleTurn();
      }),
    [settleTurn],
  );

  // The surface left before its turn ended: what it was going to do goes with it.
  useEffect(
    () => () => {
      deferred.current = [];
    },
    [],
  );

  const execute = useCallback(
    async (call: AliaHostAction): Promise<AliaHostOutcome> => {
      const action = actionOfHostCall(call);
      if (!action) return hostOutcomeOf('rejected');

      const refusal = turnRefusal({
        turnRevision: turnRevision.current,
        currentRevision: revisionOf(useSearchQueryStore.getState().query),
      });
      if (refusal) return hostOutcomeOf(refusal);

      const { actMode } = controlCapabilityOf(host, layout);
      if (actMode === 'offer') return hostOutcomeOf('inline');

      // Nothing streaming means nothing will settle: there is no answer left to cut off.
      const streaming = useConversationStore.getState().streamingConversationId !== null;
      const defer = streaming
        ? (run: () => void) => deferred.current.push(run)
        : (run: () => void) => run();
      return hostOutcomeOf(applyAction(action, router, actMode, defer));
    },
    [host, layout, router],
  );

  const onTurnStart = useCallback(() => {
    turnRevision.current = revisionOf(useSearchQueryStore.getState().query);
  }, []);

  return useMemo(
    () => ({
      hostTools: { app: SINDI_HOST_APP, definitions: SINDI_HOST_TOOL_DEFINITIONS, execute },
      runtime: { onTurnStart },
      settleTurn,
    }),
    [execute, onTurnStart, settleTurn],
  );
}

type Router = ReturnType<typeof useRouter>;

/**
 * Do the thing. Every branch performs a navigation the app already supports or
 * answers `failed`; none constructs a URL from model-supplied text. `defer`
 * receives the step that removes the chat from the screen.
 */
function applyAction(
  action: SindiAction,
  router: Router,
  mode: Exclude<SindiActMode, 'offer'>,
  defer: (run: () => void) => void,
): SindiActionOutcome {
  switch (action.kind) {
    case 'apply_search': {
      const next = applySearchPatch(useSearchQueryStore.getState().query, action.patch);
      const href = exploreHref(next);
      // `exploreHref` answers null for a selection the `loc` grammar cannot
      // express. Navigating anyway would drop the scope and answer globally
      // under a local heading (ADR 0002 §4.3).
      if (!href) return 'failed';
      // The store is written too, so a surface reading it does not lag the URL.
      useSearchQueryStore.getState().replaceSearch(next);
      return navigateThen(() => router.push(href), mode, defer);
    }
    case 'show_saved':
      // `/saved/[folderId]` is a real route. The screen loads the person's own
      // folders under their own session, so the id authorises nothing.
      return navigateThen(
        () =>
          router.push(
            action.folderId
              ? { pathname: '/saved/[folderId]', params: { folderId: action.folderId } }
              : '/saved',
          ),
        mode,
        defer,
      );
    case 'open_listing':
      return navigateThen(
        () => router.push({ pathname: '/properties/[id]', params: { id: action.propertyId } }),
        mode,
        defer,
      );
    case 'set_results_view':
      useExploreViewStore.getState().setResultsView(action.view);
      // From the docked panel the main pane is on screen and switching it is the
      // whole request. From any other host the chat covers or replaces the app,
      // so Explore comes with it — a store write nobody can see is no action.
      if (mode === 'beside') return 'applied';
      return navigateThen(() => router.push('/explore'), mode, defer);
    case 'navigate':
      return navigateThen(() => router.push(DESTINATION_ROUTES[action.destination]), mode, defer);
    default: {
      // The union is closed, so a member added later is a COMPILE error here.
      const exhaustive: never = action;
      void exhaustive;
      return 'rejected';
    }
  }
}

/**
 * Perform the navigation, and whatever else this mode owes the person: `beside`
 * navigates the page column and is done; `leave` navigates away from the chat
 * itself, so the navigation waits; `reveal` navigates under the overlay panel
 * now (it is mounted beside `<Slot/>`) and closes the panel once the turn ends.
 */
function navigateThen(
  navigate: () => void,
  mode: Exclude<SindiActMode, 'offer'>,
  defer: (run: () => void) => void,
): SindiActionOutcome {
  if (mode === 'leave') {
    defer(navigate);
    return 'applied';
  }
  navigate();
  if (mode === 'reveal') defer(() => useUIStore.getState().closeSindiPanel());
  return 'applied';
}
