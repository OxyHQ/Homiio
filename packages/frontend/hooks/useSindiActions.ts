/**
 * The executor: the ONE place a Sindi action becomes something the app does.
 *
 * ## What it is responsible for, and what it refuses
 *
 * An envelope arrives on the stream's data channel, already validated as a
 * member of the closed union (`shared-types/sindiAction.ts`). This hook decides
 * whether it may still be applied, and then applies it — or reports that it did
 * not. It never interprets prose, never builds a URL from a model's string, and
 * never reaches an API the model named.
 *
 * Four refusals, each closing a failure #519 §8.8 lists by name:
 *
 *  - **Not this turn.** `turnId` must be the active one. Cancelling a turn
 *    ("Stop"), or starting a new one, makes everything still in flight
 *    unapplicable. This is what makes Stop actually stop.
 *  - **Already done.** `actionId` is remembered for the session. A reconnection
 *    that replays the stream, or a duplicated frame, navigates once.
 *  - **The context moved.** `contextRevision` must match what the client had
 *    when it sent the turn. If the user changed a filter by hand in the
 *    meantime, THEIR change wins and the action is `stale` — "Si el usuario
 *    cambia un filtro manualmente después del contexto enviado, ese cambio
 *    gana."
 *  - **No main pane.** The capability is re-read at execution time, not at
 *    stream start, because a window can be resized mid-answer. Without a main
 *    pane the result is presented INLINE; nothing navigates behind a scrim.
 *
 * ## History executes nothing, structurally
 *
 * Actions arrive on the AI SDK's `data` channel, which belongs to a live
 * `useChat` stream. A conversation restored from the store, a shared transcript
 * opened by link, and a Markdown re-render all carry TEXT and nothing else —
 * there is no code path from a stored message to this hook. That is why the
 * rule "no ejecutar acciones al hidratar una conversación guardada" needs no
 * check: the channel does not reach them.
 *
 * ## A search is ONE navigation, not a push plus a patch
 *
 * `apply_search` builds the whole next query and navigates to its `exploreHref`
 * in a single operation. #519 §8.6 forbids the alternative in those words —
 * "no hacer un `router.push('/explore')` vacío seguido de un patch que compita
 * con la hidratación de la URL" — and `/explore` hydrates its store FROM the
 * URL, so a patch racing that hydration is a filter that flickers and loses.
 */

import { useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'expo-router';
import {
  type SindiAction,
  type SindiActionEnvelope,
  type SindiActionOutcome,
} from '@homiio/shared-types';

import { controlCapabilityOf } from '@/components/sindi/sindiPanelLayout';
import { useSindiPanelLayout } from '@/components/sindi/sindiPanelLayout';
import { applySearchPatch, envelopeRefusal } from './sindiActionRules';
import { useExploreViewStore } from '@/store/exploreViewStore';
import { useSearchQueryStore } from '@/store/searchQueryStore';
import { exploreHref } from '@/utils/searchUrl';

// Re-exported so the hook stays the single import for a consumer that wants
// both the executor and the rules it applies.
export { applySearchPatch, envelopeRefusal } from './sindiActionRules';

/** Where each enumerated destination actually lives. The ONLY path table. */
const DESTINATION_ROUTES = {
  explore: '/explore',
  saved: '/saved',
  home: '/',
  my_home: '/my-home',
  evictions: '/evictions',
} as const;

export interface SindiActionExecution {
  readonly envelope: SindiActionEnvelope;
  readonly outcome: SindiActionOutcome;
}

export interface UseSindiActionsArgs {
  /** The turn currently streaming. `null` when nothing is. */
  readonly activeTurnId: string | null;
  /** The revision of the app context sent with that turn. */
  readonly contextRevision: number;
  /** Told what happened, so the surface can render an inline result or a notice. */
  readonly onExecuted: (execution: SindiActionExecution) => void;
}

export interface UseSindiActions {
  /**
   * Offer an envelope to the executor.
   *
   * Idempotent for a given `actionId`. Safe to call for every frame on every
   * render — which is what the caller does, because the data channel is an
   * accumulating array rather than an event.
   */
  readonly execute: (envelope: SindiActionEnvelope) => SindiActionOutcome;
  /**
   * Perform an action because the PERSON pressed a button offering it.
   *
   * The one legitimate route past the capability check, and it is legitimate
   * precisely because the check exists to stop the app moving without
   * intervention — a press IS the intervention. Used by the chat-only offer
   * card; there is no other caller, and adding one would need the same
   * justification.
   */
  readonly take: (action: SindiAction) => SindiActionOutcome;
}

export function useSindiActions({
  activeTurnId,
  contextRevision,
  onExecuted,
}: UseSindiActionsArgs): UseSindiActions {
  const router = useRouter();
  const layout = useSindiPanelLayout();

  /**
   * Every `actionId` this session has already answered.
   *
   * A ref, not state: it must not re-render anything, and it must be read
   * synchronously inside `execute` so two frames arriving in one tick cannot
   * both pass the check.
   */
  const applied = useRef<Set<string>>(new Set());

  const execute = useCallback(
    (envelope: SindiActionEnvelope): SindiActionOutcome => {
      const refusal = envelopeRefusal({
        envelope,
        activeTurnId,
        contextRevision,
        alreadyApplied: applied.current.has(envelope.actionId),
      });
      if (refusal) {
        // A refusal is still an ANSWER, and the caller is told — Sindi must not
        // claim to have changed filters the executor left alone.
        if (refusal !== 'rejected') onExecuted({ envelope, outcome: refusal });
        return refusal;
      }
      applied.current.add(envelope.actionId);

      // Re-read at EXECUTION time: the window may have been resized while the
      // answer streamed, and navigating a pane that is now behind a scrim is
      // worse than not navigating.
      const { canControlApp } = controlCapabilityOf(layout);
      const outcome = canControlApp
        ? applyToMainPane(envelope.action, router)
        : ('inline' as const);

      onExecuted({ envelope, outcome });
      return outcome;
    },
    [activeTurnId, contextRevision, layout, onExecuted, router],
  );

  const take = useCallback(
    (action: SindiAction): SindiActionOutcome => applyToMainPane(action, router),
    [router],
  );

  return useMemo(() => ({ execute, take }), [execute, take]);
}

type Router = ReturnType<typeof useRouter>;

/**
 * Do the thing, in the main pane.
 *
 * Reached only with `canControlApp` true. Every branch either performs a
 * navigation the app already supports or answers `failed`; none of them
 * constructs a URL from model-supplied text.
 */
function applyToMainPane(action: SindiAction, router: Router): SindiActionOutcome {
  switch (action.kind) {
    case 'apply_search': {
      const current = useSearchQueryStore.getState().query;
      const next = applySearchPatch(current, action.patch);
      const href = exploreHref(next);
      // `exploreHref` answers null for a selection the `loc` grammar cannot
      // express. Navigating anyway would drop the scope and answer globally
      // under a local heading — ADR 0002 §4.3, and the reason this is a failure
      // rather than a best effort.
      if (!href) return 'failed';
      // ONE operation. The store is written too, so a surface reading it
      // directly does not lag a frame behind the URL; `/explore` re-derives
      // from the URL on arrival and the two agree because both came from
      // `next`.
      useSearchQueryStore.getState().replaceSearch(next);
      router.push(href);
      return 'applied';
    }
    case 'show_saved': {
      // `/saved/[folderId]` is a real route — a query parameter on `/saved`
      // would be read by nothing and the person would land on the whole list
      // having asked for one folder, which is a CTA ending on the wrong screen.
      //
      // The id is NOT trusted as an authorisation: the screen loads the
      // person's own folders under their own session, and an id naming somebody
      // else's simply matches nothing there. A responsive capability grants no
      // permissions (#519 §8.3).
      router.push(
        action.folderId
          ? { pathname: '/saved/[folderId]', params: { folderId: action.folderId } }
          : '/saved',
      );
      return 'applied';
    }
    case 'open_listing': {
      router.push({ pathname: '/properties/[id]', params: { id: action.propertyId } });
      return 'applied';
    }
    case 'set_results_view': {
      useExploreViewStore.getState().setResultsView(action.view);
      return 'applied';
    }
    case 'navigate': {
      router.push(DESTINATION_ROUTES[action.destination]);
      return 'applied';
    }
    default: {
      // The union is closed, so a member added later is a COMPILE error here
      // rather than an action this switch silently drops.
      const exhaustive: never = action;
      void exhaustive;
      return 'rejected';
    }
  }
}
