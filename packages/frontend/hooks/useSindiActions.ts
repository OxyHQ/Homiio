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
 *  - **No surface that could show it.** The capability is re-read at execution
 *    time, not at stream start, because a window can be resized mid-answer.
 *    This used to be the common case and is now the rare one — see below.
 *
 * ## Every host acts; the HOST decides what acting looks like
 *
 * The fourth refusal was `canControlApp = panelVisible && panelDocked`, so the
 * full-screen chat and the overlay panel both answered `inline` and rendered a
 * button. The person who reported this had typed "muéstrame pisos en hamburg"
 * and watched the app do nothing; their instruction was "debería interactuar
 * como hablamos". So the capability now takes the host
 * (`components/sindi/sindiHost.ts`) and only a surface with nowhere to show a
 * result — the in-property sheet — still offers instead of acting.
 *
 * ## Two things happen at different times, and that is the whole shape below
 *
 * The action frame is written BEFORE the first text delta (`routes/ai.ts`,
 * `pipeStreamingTextDataStream`), so when `execute` runs the answer has not
 * been written yet. Two of the three acting modes end with the chat's own
 * surface gone — the overlay panel closes, the full-screen route navigates away
 * — and doing that on the frame that precedes the text unmounts a chat that is
 * still streaming: the screen changes and the reply the person asked for never
 * appears in front of them.
 *
 * So an action is split. The part that changes app STATE (the search query, the
 * results view) runs immediately, because it costs nothing and keeps the
 * reported outcome honest. The part that takes the chat's surface away —
 * `router.push`, closing the panel — is handed to {@link UseSindiActions.settleTurn},
 * which `useSindiConversation` calls when the stream settles. In `beside` mode
 * nothing is deferred: the docked panel is mounted beside `<Slot/>` and survives
 * any navigation.
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

import { controlCapabilityOf, type SindiActMode, type SindiChatHost } from '@/components/sindi/sindiHost';
import { useSindiPanelLayout } from '@/components/sindi/sindiPanelLayout';
import { applySearchPatch, envelopeRefusal } from './sindiActionRules';
import { useExploreViewStore } from '@/store/exploreViewStore';
import { useSearchQueryStore } from '@/store/searchQueryStore';
import { useUIStore } from '@/store/uiStore';
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
  /** Which surface is rendering this conversation. See {@link SindiChatHost}. */
  readonly host: SindiChatHost;
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
   * intervention — a press IS the intervention. Used by the offer card; there
   * is no other caller, and adding one would need the same justification.
   *
   * Nothing is deferred here: the person is waiting, and they pressed after
   * reading, so there is no answer left to interrupt.
   */
  readonly take: (action: SindiAction) => SindiActionOutcome;
  /**
   * The turn has stopped streaming: run what was held back until it had.
   *
   * Idempotent and cheap — it drains a queue that is empty for every turn that
   * produced no action, which is most of them. Called by
   * `useSindiConversation` from the same effect that closes the turn, which
   * means it also runs after **Stop**: stopping cancels the ANSWER, and the
   * reason the navigation was waiting (not cutting that answer off) is gone the
   * moment the answer is. The action itself was accepted before the stop, so
   * "Cancelar un turno impide aplicar lo que llegue después" is untouched —
   * what arrives after a stop still names a turn that is no longer active and
   * is refused by `envelopeRefusal`.
   */
  readonly settleTurn: () => void;
}

export function useSindiActions({
  host,
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

  /**
   * What runs when the turn stops streaming.
   *
   * A ref for the same reason `applied` is one: it is written from inside
   * `execute` and read from an effect, and neither may cause a render — a
   * re-render here would re-run the effect that offers every accumulated frame
   * to the executor.
   */
  const deferred = useRef<(() => void)[]>([]);

  const settleTurn = useCallback(() => {
    if (deferred.current.length === 0) return;
    // Taken and cleared BEFORE running, so a callback that somehow enqueued
    // another cannot be re-run by the next settle.
    const pending = deferred.current;
    deferred.current = [];
    for (const run of pending) run();
  }, []);

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
      // answer streamed, so the host's mode is derived now rather than when the
      // stream opened.
      const { actMode } = controlCapabilityOf(host, layout);
      const outcome =
        actMode === 'offer'
          ? ('inline' as const)
          : applyAction(envelope.action, router, actMode, (run) => deferred.current.push(run));

      onExecuted({ envelope, outcome });
      return outcome;
    },
    [activeTurnId, contextRevision, host, layout, onExecuted, router],
  );

  const take = useCallback(
    (action: SindiAction): SindiActionOutcome => {
      const { actMode } = controlCapabilityOf(host, layout);
      // `immediately` in place of the deferring sink: a press is not a frame
      // that arrived before the answer, so there is nothing to wait for.
      return applyAction(action, router, actMode, immediately);
    },
    [host, layout, router],
  );

  return useMemo(() => ({ execute, take, settleTurn }), [execute, take, settleTurn]);
}

type Router = ReturnType<typeof useRouter>;

/** Run a deferred step now. See `take`. */
const immediately = (run: () => void): void => run();

/**
 * Do the thing.
 *
 * Reached for every acting mode from `execute`, and for `offer` too from an
 * explicit press — which is the one legitimate route past the capability check.
 * Every branch either performs a navigation the app already supports or answers
 * `failed`; none of them constructs a URL from model-supplied text.
 *
 * `defer` receives the step that removes the chat from the screen. The caller
 * decides whether that is "now" (`beside`, and an explicit press) or "when the
 * turn settles" (`reveal`, `leave`) — see this module's header for why the
 * distinction is load-bearing rather than cosmetic.
 */
function applyAction(
  action: SindiAction,
  router: Router,
  mode: SindiActMode,
  defer: (run: () => void) => void,
): SindiActionOutcome {
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
      return navigateThen(() => router.push(href), mode, defer);
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
    }
    case 'open_listing': {
      return navigateThen(
        () => router.push({ pathname: '/properties/[id]', params: { id: action.propertyId } }),
        mode,
        defer,
      );
    }
    case 'set_results_view': {
      useExploreViewStore.getState().setResultsView(action.view);
      // The only member that changes state without moving anywhere, and the
      // only one whose visibility depends on where the person already is: the
      // list/map switch belongs to Explore. From the docked panel the main pane
      // is on screen and switching it is the whole request. From any other host
      // the chat is covering or replacing the app, so a store write nobody can
      // see is the invisible action this change exists to stop — Explore comes
      // with it.
      if (mode === 'beside') return 'applied';
      return navigateThen(() => router.push('/explore'), mode, defer);
    }
    case 'navigate': {
      return navigateThen(() => router.push(DESTINATION_ROUTES[action.destination]), mode, defer);
    }
    case 'clarify_location': {
      // The one member with nothing to do to the app: it is a sentence for the
      // conversation, so it reports `inline` in every act mode — nothing is
      // navigated, nothing is deferred to `settleTurn`, and the chat's own
      // surface is exactly where the answer belongs. `SindiActionCard` renders
      // it as text with no button to press.
      //
      // `applied` would be a lie of the kind #519 §8.4 names — "Sindi no debe
      // afirmar que cambió filtros si el executor no lo hizo" — and `failed`
      // would read as a malfunction when the refusal is the correct answer:
      // ADR 0002 §12.2 requires that two real Barcelonas are NOT chosen
      // between. What was broken was saying nothing, not refusing.
      return 'inline';
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

/**
 * Perform the navigation, and whatever else this mode owes the person.
 *
 * `beside` navigates the page column beside the chat and is done. `leave`
 * navigates away from the chat itself, so the navigation IS the thing that must
 * wait. `reveal` navigates under the overlay panel now — harmless, the panel is
 * mounted beside `<Slot/>` — and closes that panel afterwards, which is the
 * step that must wait.
 *
 * `offer` reaches here only from an explicit press, where `defer` runs
 * everything immediately.
 */
function navigateThen(
  navigate: () => void,
  mode: SindiActMode,
  defer: (run: () => void) => void,
): SindiActionOutcome {
  if (mode === 'leave') {
    defer(navigate);
    return 'applied';
  }
  navigate();
  if (mode === 'reveal') {
    // Closing the panel unmounts the chat inside it, which is why this is the
    // deferred half rather than part of the navigation above.
    defer(() => useUIStore.getState().closeSindiPanel());
  }
  return 'applied';
}
