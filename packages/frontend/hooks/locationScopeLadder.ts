/**
 * The initial-scope resolution ladder, as a PURE function.
 *
 * ## Why a pure function and not a hook body
 *
 * The hardest requirements are all about ORDERING, and none of them can be
 * demonstrated by rendering:
 *
 *  - "Nunca ejecutar silenciosamente el feed global porque una de las opciones
 *    anteriores falló" — a failure at any rung must NOT fall through to the
 *    bottom one.
 *  - "Respuesta tardía de la ubicación anterior que no sobrescribe la nueva" —
 *    a late answer must not displace a newer choice.
 *  - "Una vez mostrados resultados de una zona, una respuesta automática tardía
 *    no debe mover el mapa y sustituirlos inesperadamente" (#518 §3.3) — a
 *    SECOND automatic answer must not displace the first one either.
 *
 * A ladder expressed as `setState` calls inside effects can only be tested by
 * simulating timing, which is exactly the kind of test that passes for the
 * wrong reason. Expressed as a function from inputs to a state, all three are
 * ordinary assertions — no timers, no fake clocks.
 *
 * The hook that uses this gathers the inputs and renders the output. It makes
 * no decision of its own, which is what keeps the decision testable.
 *
 * ## THE MANDATORY PICKER IS GONE (#518, #519)
 *
 * This ladder used to end at `needsPlace: true`, which every surface read as
 * "render nothing and ask". That was #353's deliberate last rung and it is
 * explicitly superseded: "Esta issue sustituye explícitamente la decisión
 * antigua de terminar en un selector obligatorio."
 *
 * Two things replace it, and the distinction between them is the whole change:
 *
 *  - an **approximate rung** (`ip`), resolved on the server from the visitor's
 *    own connection with no permission prompt; and
 *  - a **discovery** state, which is NOT a gate. `discovery: true` means "no
 *    area is in force, show destinations and a search bar" — the app is fully
 *    usable, nothing is hidden behind a step, and `canQuery` is false only
 *    because there is no area to query, not because querying is forbidden.
 *
 * What is NOT relaxed: `discovery` still never becomes a worldwide feed under a
 * local heading. `isGlobal` remains reachable from exactly one input, and there
 * is still no arm of this function where a failure, an absence or a timeout
 * produces `global`.
 *
 * ## Global is not a rung
 *
 * `explicitGlobal` is checked FIRST and is set by exactly one action — pressing
 * "Explore everywhere". The enum value simply is not reachable from a failure,
 * an absence or a timeout, which is stronger than a rule saying it must not be.
 */

import type {
  ApproximateLocationGranularity,
  LocationFailureReason,
  LocationResolution,
  LocationSelection,
} from '@homiio/shared-types';

/** Which rung of the ladder supplied the committed scope. */
export type LocationScopeSource =
  /** An explicit choice made in this session. */
  | 'session'
  /** The primary area of a saved search / configured home area. */
  | 'saved_area'
  /** The last area this device chose, restored from storage. */
  | 'last_chosen'
  /** The device's current position, with permission already granted. */
  | 'device'
  /** Inferred from the visitor's network, on the server. Never precise. */
  | 'ip'
  /** The user pressed "Explore everywhere". */
  | 'global';

/**
 * Which sources are INFERRED rather than chosen.
 *
 * A single exported set rather than a comparison repeated per surface, because
 * every one of them has to make the same disclosure — "Bucharest · approximate
 * area" — and a surface that forgets states a guess as a fact.
 */
export const INFERRED_SCOPE_SOURCES: ReadonlySet<LocationScopeSource> = new Set<LocationScopeSource>(
  ['device', 'ip'],
);

/**
 * What the device rung currently knows.
 *
 * `idle` is NOT the same as `denied`, and conflating them is how an app ends up
 * asking for permission on every render: `idle` means "we have not asked and
 * will not ask unprompted".
 */
export type DevicePositionState =
  /** Not asked, or not askable without a prompt. The ladder skips this rung. */
  | { readonly status: 'idle' }
  | { readonly status: 'resolving' }
  | { readonly status: 'resolved'; readonly selection: LocationSelection }
  | { readonly status: 'failed'; readonly reason: LocationFailureReason };

/**
 * What the approximate (network) rung currently knows.
 *
 * `unavailable` carries no reason on purpose. The SERVER's reasons matter to an
 * operator and are already observed there; to this ladder every one of them
 * means the same thing — there is no area, show discovery — and a reason the
 * ladder cannot act on is a field a surface will eventually render as an
 * apology for something the user did not do.
 */
export type ApproximatePositionState =
  | { readonly status: 'idle' }
  | { readonly status: 'resolving' }
  | {
      readonly status: 'resolved';
      readonly selection: LocationSelection;
      readonly granularity: ApproximateLocationGranularity;
    }
  | { readonly status: 'unavailable' };

/**
 * An automatic scope already in force.
 *
 * Recorded by the hook the first time an inferred rung supplies a scope, and
 * read back here so a SECOND automatic answer cannot replace it. Without it the
 * ladder would happily move somebody from the city their network implied to the
 * city their GPS implied, three seconds after they started scrolling — the jump
 * #518 §3.3 forbids in those words.
 *
 * It is outranked by every explicit rung above it, so it delays nothing the
 * user actually chose; and it is session-only, so a new launch re-resolves.
 */
export interface CommittedAutoScope {
  readonly source: 'device' | 'ip';
  readonly selection: LocationSelection;
}

export interface LocationScopeInputs {
  /** Set by "Explore everywhere". The ONLY route to an unscoped query. */
  readonly explicitGlobal: boolean;
  /** An explicit choice made in this session. Outranks everything below. */
  readonly sessionSelection: LocationSelection | null;
  /**
   * The primary area of a saved search, when the user has one.
   *
   * The ladder behaves correctly with it permanently null — it falls to the
   * next rung, because an absent rung is a skip and not a failure.
   */
  readonly savedAreaSelection: LocationSelection | null;
  /** The last area the user chose on this device, restored from storage. */
  readonly lastChosenSelection: LocationSelection | null;
  readonly device: DevicePositionState;
  /** The server's answer from the visitor's network. Never prompts. */
  readonly approximate: ApproximatePositionState;
  /** An inferred scope already committed this session. See {@link CommittedAutoScope}. */
  readonly committedAuto: CommittedAutoScope | null;
  /**
   * The user pressed "use my current location" and has not chosen anything
   * since.
   *
   * That press is an explicit choice, so it outranks the saved and last-chosen
   * areas below it — otherwise the button is a no-op for anybody who has ever
   * picked a place: the fix arrives and the ladder keeps reading Barcelona. It
   * never outranks a NEWER session choice (the store clears the flag on
   * `choose`), and a failed fix falls back to those areas rather than to
   * nothing, carrying `deviceIssue` so the surface can say why.
   *
   * Optional, `false` when absent.
   */
  readonly deviceRequested?: boolean;
}

/**
 * A better automatic answer that is available but has NOT been applied.
 *
 * Offered as an action ("use my precise location") rather than applied, because
 * applying it is the silent city-jump both epics forbid: "Una mejora de
 * precisión posterior se ofrece como acción cuando implique cambiar la
 * consulta, en vez de saltar automáticamente de ciudad."
 */
export interface ScopeUpgrade {
  readonly source: 'device';
  readonly selection: LocationSelection;
}

/**
 * The resolved scope.
 *
 * `selection` and `resolution` are BOTH present rather than one derived from
 * the other, because they answer different questions and a surface needs both
 * at once: `selection` is what to query, `resolution` is what to say. The case
 * that forces it is "un error de geocoding no borra el scope anterior" — there
 * `selection` is the previous, still-valid area and `resolution` is `failed`,
 * and a shape carrying only one of them cannot render "showing Barcelona; we
 * could not update your position".
 */
export interface LocationScopeState {
  readonly selection: LocationSelection | null;
  readonly resolution: LocationResolution;
  /** Which rung supplied `selection`, or `null` when there is none. */
  readonly source: LocationScopeSource | null;
  /**
   * The device rung failed, whether or not another rung supplied the scope.
   *
   * A SEPARATE field from `resolution` because the "permiso revocado o
   * localización fallida" state needs both facts at once: keep the last valid
   * selection AND say that the current location is no longer available.
   */
  readonly deviceIssue: LocationFailureReason | null;
  /**
   * No area is in force, and the app shows destinations instead.
   *
   * **This is not a gate.** It replaces `needsPlace`, which every surface read
   * as "render nothing until the user picks". Search, navigation, saved items
   * and every listing remain reachable; what is absent is a LOCAL feed, because
   * there is no locality — and saying so honestly is the whole point.
   */
  readonly discovery: boolean;
  /** The user asked for everywhere, explicitly. */
  readonly isGlobal: boolean;
  /**
   * The scope was INFERRED (network or device), not chosen.
   *
   * Surfaces must disclose it: "Bucharest · approximate area", with a one-tap
   * way to change it. Derived here rather than per surface so a screen cannot
   * forget, and so "we never present a guess as a choice" is one assertion.
   */
  readonly isApproximate: boolean;
  /** How coarse an inferred area is, when it came from the network. */
  readonly granularity: ApproximateLocationGranularity | null;
  /** A more precise automatic answer, offered rather than applied. */
  readonly upgrade: ScopeUpgrade | null;
  /**
   * True when a query may run.
   *
   * The one flag every consumer gates on, so "may I fetch?" is answered in one
   * place rather than re-derived per screen from a combination that one of them
   * will eventually get wrong. False in `discovery` because there is no area —
   * NOT because the surface should hide.
   */
  readonly canQuery: boolean;
}

/** The fields every return shares, so a new one cannot forget a disclosure. */
interface ScopeBase {
  readonly deviceIssue: LocationFailureReason | null;
  readonly upgrade: ScopeUpgrade | null;
}

function scoped(
  selection: LocationSelection,
  source: LocationScopeSource,
  base: ScopeBase,
  granularity: ApproximateLocationGranularity | null = null,
): LocationScopeState {
  return {
    selection,
    // A committed area is resolved even while a lower rung is still resolving
    // or has failed underneath it. Reporting `resolving` here would make the
    // surface flicker into a loading state for an answer it is not going to
    // use, and reporting `failed` would attach an error to a scope that is
    // perfectly valid.
    resolution: { status: 'resolved', selection },
    source,
    deviceIssue: base.deviceIssue,
    discovery: false,
    isGlobal: false,
    isApproximate: INFERRED_SCOPE_SOURCES.has(source),
    granularity,
    upgrade: base.upgrade,
    canQuery: true,
  };
}

function resolving(base: ScopeBase): LocationScopeState {
  return {
    selection: null,
    resolution: { status: 'resolving' },
    source: null,
    deviceIssue: base.deviceIssue,
    // NOT discovery: the destinations board would flash for the half-second an
    // answer takes and then be replaced, which is the jump this file exists to
    // prevent, arriving at the top of the sequence instead of the end.
    discovery: false,
    isGlobal: false,
    isApproximate: false,
    granularity: null,
    upgrade: base.upgrade,
    canQuery: false,
  };
}

function discovery(base: ScopeBase, resolution: LocationResolution): LocationScopeState {
  return {
    selection: null,
    resolution,
    source: null,
    deviceIssue: base.deviceIssue,
    discovery: true,
    isGlobal: false,
    isApproximate: false,
    granularity: null,
    upgrade: base.upgrade,
    canQuery: false,
  };
}

/**
 * Resolve the scope from the ladder's inputs.
 *
 * Order: explicit session choice → saved/home area → last chosen area → an
 * inferred scope already committed → device position → network inference →
 * discovery. Global only via `explicitGlobal`.
 */
export function resolveLocationScope(inputs: LocationScopeInputs): LocationScopeState {
  // Carried into EVERY return: a revoked permission is a fact about the device,
  // not about whichever rung happened to supply the scope, so it must survive
  // being outranked.
  const deviceIssue = inputs.device.status === 'failed' ? inputs.device.reason : null;

  /**
   * The precision upgrade on offer, if any.
   *
   * Only ever from the device, and only while the scope in force came from the
   * NETWORK: a device answer arriving over a network guess is a real
   * improvement worth offering, whereas one arriving over a city the user
   * picked is not an improvement at all — it is a different place.
   *
   * Which is why it is attached ONLY to the committed-inference return below
   * and not to `base`. Carrying it everywhere would offer "use my exact
   * location" beside Madrid, chosen by hand, whose only effect would be to
   * replace the user's choice with wherever they happen to be standing.
   */
  const upgrade: ScopeUpgrade | null =
    inputs.committedAuto?.source === 'ip' && inputs.device.status === 'resolved'
      ? { source: 'device', selection: inputs.device.selection }
      : null;

  const base: ScopeBase = { deviceIssue, upgrade: null };

  // 0. The explicit escape hatch, checked before the ladder so that choosing
  //    "everywhere" is not something a stale lower rung can override.
  if (inputs.explicitGlobal) {
    return {
      selection: null,
      resolution: { status: 'idle' },
      source: 'global',
      deviceIssue,
      discovery: false,
      isGlobal: true,
      isApproximate: false,
      granularity: null,
      upgrade: null,
      canQuery: true,
    };
  }

  // 0b. "Use my current location", pressed after an area was already in use.
  //     Only a resolved or resolving device answer takes over; a failure falls
  //     through to the committed rungs (with `deviceIssue` set), never to global.
  if (inputs.deviceRequested && !inputs.sessionSelection) {
    if (inputs.device.status === 'resolved') {
      return scoped(inputs.device.selection, 'device', { deviceIssue, upgrade: null });
    }
    if (inputs.device.status === 'resolving') {
      // Not the previous area: the user just asked for a different one, and
      // showing Barcelona's homes under "finding where you are" would state an
      // area the next render is about to replace.
      return resolving({ deviceIssue, upgrade: null });
    }
  }

  // 1–3. The three rungs that are already RESOLVED when present. An inferred
  //      answer arriving late cannot displace any of them, because they are
  //      read first and this function has no notion of "most recent".
  const committed: readonly [LocationSelection | null, LocationScopeSource][] = [
    [inputs.sessionSelection, 'session'],
    [inputs.savedAreaSelection, 'saved_area'],
    [inputs.lastChosenSelection, 'last_chosen'],
  ];
  for (const [selection, source] of committed) {
    if (!selection) continue;
    return scoped(selection, source, base);
  }

  // 4. An inferred scope ALREADY IN FORCE. Above both inference rungs, so the
  //    second answer to arrive cannot replace the first one the user has been
  //    looking at — it becomes `upgrade` instead.
  if (inputs.committedAuto) {
    return scoped(inputs.committedAuto.selection, inputs.committedAuto.source, {
      deviceIssue,
      upgrade,
    });
  }

  // 5. The device, only when it has actually answered. It outranks the network
  //    because a real fix is strictly better than an inference from routing —
  //    but only as the FIRST automatic answer; see rung 4.
  if (inputs.device.status === 'resolved') {
    return scoped(inputs.device.selection, 'device', base);
  }

  // 6. The network. No prompt, no permission, no precision claimed.
  if (inputs.approximate.status === 'resolved') {
    return scoped(
      inputs.approximate.selection,
      'ip',
      base,
      inputs.approximate.granularity,
    );
  }

  // 7. Still waiting on something that can answer. A skeleton, not a board.
  if (inputs.device.status === 'resolving' || inputs.approximate.status === 'resolving') {
    return resolving(base);
  }

  // 8. Nothing knows where this person is, and that is a SUPPORTED state.
  //
  //    The resolution reported is the device's failure when there was one —
  //    "location is off" is worth saying beside the destinations board — and
  //    `idle` otherwise, because never having asked is not a failure.
  return discovery(
    base,
    inputs.device.status === 'failed'
      ? { status: 'failed', reason: inputs.device.reason }
      : { status: 'idle' },
  );
}
