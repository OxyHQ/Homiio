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
 *
 * Replays, a stopped turn and history need no check: the SDK performs a call
 * once, Stop aborts the stream that would carry a late call, and a stored
 * conversation carries no `alia.host_action` at all.
 *
 * ## Two things happen at different times
 *
 * Sindi lives in ONE surface, the SDK's sheet (`context/AskAgentProvider.tsx`),
 * which floats over whatever page the person was reading and is mounted above
 * the app frame, so a navigation never unmounts it. Acting therefore means
 * changing the page UNDER the sheet, and then getting the sheet out of the way
 * so the person sees what changed.
 *
 * The call arrives MID-STREAM: the model asks for the effect and then keeps
 * writing. Closing the sheet on arrival would take away an answer still being
 * written. So the page changes at once, and the sheet closes when the turn
 * stops streaming, which the SDK's conversation store announces
 * (`streamingConversationId` leaving the conversation that was streaming). It
 * also closes after **Stop**: stopping cancels the answer, and the answer is
 * what the close was waiting for.
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
  actionOfHostCall,
  hostOutcomeOf,
  SINDI_HOST_APP,
  SINDI_HOST_TOOL_DEFINITIONS,
} from '@/components/sindi/sindiHostTools';
import { revisionOf } from '@/hooks/useSindiAppContext';
import { useExploreViewStore } from '@/store/exploreViewStore';
import { useSearchQueryStore } from '@/store/searchQueryStore';
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

/**
 * The executor of the sheet. `closeSheet` is the sheet's own dismiss
 * (`useAskAgent().dismiss`, through the provider's ref): it runs once the turn
 * that acted has been written.
 */
export function useSindiActions(closeSheet: () => void): UseSindiActions {
  const router = useRouter();

  /** The live query's revision when the current turn was sent. */
  const turnRevision = useRef<number | null>(null);
  /** The steps that take the sheet off the screen, waiting for the turn to end. */
  const deferred = useRef<(() => void)[]>([]);

  const settleTurn = useCallback(() => {
    if (deferred.current.length === 0) return;
    // Taken and cleared BEFORE running, so a step cannot be re-run by the next settle.
    const pending = deferred.current;
    deferred.current = [];
    for (const run of pending) run();
  }, []);

  // A turn ends when the SDK stops streaming the conversation that was.
  //
  // These two stay effects, deliberately. The end of a turn is an EVENT in the
  // SDK's store, not a value to render, and the steps waiting for it belong to
  // THIS mount: the panel remounts per conversation (`key={open.serial}`) and
  // the route can be left mid-answer, and a step from the old mount must not
  // run then. Subscribing from `execute` would cover the first half but not the
  // second — the hook renders no element of its own whose ref could carry the
  // mount's lifetime (the SDK draws the whole chat). What would retire both is
  // a host callback in `@alia.onl/sdk` — `AliaRuntimeHost.onTurnEnd`, called by
  // the mounted thread, which dies with the surface.
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

      const outcome = applyAction(action, router);
      if (outcome === 'applied') {
        // Nothing streaming means nothing will settle: there is no answer left to cut off.
        const streaming = useConversationStore.getState().streamingConversationId !== null;
        if (streaming) deferred.current.push(closeSheet);
        else closeSheet();
      }
      return hostOutcomeOf(outcome);
    },
    [router, closeSheet],
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
 * Do the thing, on the page under the sheet. Every branch performs a navigation
 * the app already supports or answers `failed`; none constructs a URL from
 * model-supplied text.
 */
function applyAction(action: SindiAction, router: Router): SindiActionOutcome {
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
      router.push(href);
      return 'applied';
    }
    case 'show_saved':
      // `/saved/[folderId]` is a real route. The screen loads the person's own
      // folders under their own session, so the id authorises nothing.
      router.push(
        action.folderId
          ? { pathname: '/saved/[folderId]', params: { folderId: action.folderId } }
          : '/saved',
      );
      return 'applied';
    case 'open_listing':
      router.push({ pathname: '/properties/[id]', params: { id: action.propertyId } });
      return 'applied';
    case 'set_results_view':
      useExploreViewStore.getState().setResultsView(action.view);
      // The sheet covers the app, so Explore comes with it — a store write
      // nobody can see is no action.
      router.push('/explore');
      return 'applied';
    case 'navigate':
      router.push(DESTINATION_ROUTES[action.destination]);
      return 'applied';
    default: {
      // The union is closed, so a member added later is a COMPILE error here.
      const exhaustive: never = action;
      void exhaustive;
      return 'rejected';
    }
  }
}
