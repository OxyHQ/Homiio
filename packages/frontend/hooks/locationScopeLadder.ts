/**
 * The initial-scope resolution ladder (#353), as a PURE function.
 *
 * ## Why a pure function and not a hook body
 *
 * The two hardest requirements in the issue are both about ORDERING, and
 * neither can be demonstrated by rendering:
 *
 *  - "Nunca ejecutar silenciosamente el feed global porque una de las opciones
 *    anteriores falló" — a failure at any rung must NOT fall through to the
 *    bottom one.
 *  - "Respuesta tardía de la ubicación anterior que no sobrescribe la nueva" —
 *    a late answer must not displace a newer choice.
 *
 * A ladder expressed as `setState` calls inside effects can only be tested by
 * simulating timing, which is exactly the kind of test that passes for the wrong
 * reason. Expressed as a function from inputs to a state, both properties are
 * ordinary assertions: the first is "a failed rung yields `needs_place`, never
 * `global`", and the second is "an explicit choice outranks a device answer, so
 * supplying both yields the choice" — no timers, no fake clocks.
 *
 * The hook that uses this gathers the inputs and renders the output. It makes no
 * decision of its own, which is what keeps the decision testable.
 *
 * ## Global is not a rung
 *
 * `explicitGlobal` is checked FIRST and is set by exactly one action — pressing
 * "Explore everywhere". Every other path ends at `needs_place` when it runs out
 * of options. There is deliberately no arm of this function that reaches
 * `global` from a failure, an absence or a timeout; the enum value simply is not
 * reachable from those inputs, which is stronger than a rule saying it must not
 * be.
 */

import type {
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
  /** The user pressed "Explore everywhere". */
  | 'global';

/**
 * What the device rung currently knows.
 *
 * `idle` is NOT the same as `denied`, and conflating them is how an app ends up
 * asking for permission on every render: `idle` means "we have not asked and
 * will not ask unprompted", which is the issue's "no repetir el prompt del
 * sistema en cada render/apertura".
 */
export type DevicePositionState =
  /** Not asked. The ladder skips this rung silently and offers the picker. */
  | { readonly status: 'idle' }
  | { readonly status: 'resolving' }
  | { readonly status: 'resolved'; readonly selection: LocationSelection }
  | { readonly status: 'failed'; readonly reason: LocationFailureReason };

export interface LocationScopeInputs {
  /** Set by "Explore everywhere". The ONLY route to an unscoped query. */
  readonly explicitGlobal: boolean;
  /** An explicit choice made in this session. Outranks everything below. */
  readonly sessionSelection: LocationSelection | null;
  /**
   * The primary area of a saved search, when the user has one.
   *
   * `null` until #356 lands the primary-area flag, and the ladder must behave
   * correctly with it permanently null — which it does, by falling to the next
   * rung, because an absent rung is not a failure.
   */
  readonly savedAreaSelection: LocationSelection | null;
  /** The last area the user chose on this device, restored from storage. */
  readonly lastChosenSelection: LocationSelection | null;
  readonly device: DevicePositionState;
}

/**
 * The resolved scope.
 *
 * `selection` and `resolution` are BOTH present rather than one derived from the
 * other, because they answer different questions and a surface needs both at
 * once: `selection` is what to query, `resolution` is what to say. The case that
 * forces it is the acceptance criterion "un error de geocoding no borra el scope
 * anterior" — there `selection` is the previous, still-valid area and
 * `resolution` is `failed`, and a shape carrying only one of them cannot render
 * "showing Barcelona; we could not update your position".
 */
export interface LocationScopeState {
  readonly selection: LocationSelection | null;
  readonly resolution: LocationResolution;
  /** Which rung supplied `selection`, or `null` when there is none. */
  readonly source: LocationScopeSource | null;
  /**
   * The device rung failed, whether or not another rung supplied the scope.
   *
   * A SEPARATE field from `resolution` because the issue's "permiso revocado o
   * localización fallida" state needs both facts at once: keep the last valid
   * selection AND say that the current location is no longer available. Folding
   * the failure into `resolution` would force a choice between reporting the
   * scope as broken (it is not) and hiding the revocation (the user is entitled
   * to know their position stopped being used).
   */
  readonly deviceIssue: LocationFailureReason | null;
  /** The user must pick a place: nothing may be queried until they do. */
  readonly needsPlace: boolean;
  /** The user asked for everywhere, explicitly. */
  readonly isGlobal: boolean;
  /**
   * True when a query may run.
   *
   * The one flag every consumer gates on, so "may I fetch?" is answered in one
   * place rather than re-derived per screen from a combination that one of them
   * will eventually get wrong.
   */
  readonly canQuery: boolean;
}

/**
 * Resolve the scope from the ladder's inputs.
 *
 * Order, from the issue: explicit session choice → saved/home area → last chosen
 * area → device position → mandatory picker. Global only via `explicitGlobal`.
 */
export function resolveLocationScope(inputs: LocationScopeInputs): LocationScopeState {
  // Carried into EVERY return: a revoked permission is a fact about the device,
  // not about whichever rung happened to supply the scope, so it must survive
  // being outranked.
  const deviceIssue = inputs.device.status === 'failed' ? inputs.device.reason : null;

  // 0. The explicit escape hatch, checked before the ladder so that choosing
  //    "everywhere" is not something a stale lower rung can override.
  if (inputs.explicitGlobal) {
    return {
      selection: null,
      resolution: { status: 'idle' },
      source: 'global',
      deviceIssue,
      needsPlace: false,
      isGlobal: true,
      canQuery: true,
    };
  }

  // 1–3. The three rungs that are already RESOLVED when present. A device answer
  //      arriving late cannot displace any of them, because they are read first
  //      and this function has no notion of "most recent".
  const committed: readonly [LocationSelection | null, LocationScopeSource][] = [
    [inputs.sessionSelection, 'session'],
    [inputs.savedAreaSelection, 'saved_area'],
    [inputs.lastChosenSelection, 'last_chosen'],
  ];
  for (const [selection, source] of committed) {
    if (!selection) continue;
    return {
      selection,
      // A committed area is resolved even while the DEVICE rung is still
      // resolving or has failed underneath it. Reporting `resolving` here would
      // make the surface flicker into a loading state for an answer it is not
      // going to use, and reporting `failed` would attach an error to a scope
      // that is perfectly valid — which is the acceptance criterion about a
      // geocoding error not clearing the previous scope, seen from the inside.
      resolution: { status: 'resolved', selection },
      source,
      deviceIssue,
      needsPlace: false,
      isGlobal: false,
      canQuery: true,
    };
  }

  // 4. The device, only when it has actually answered.
  switch (inputs.device.status) {
    case 'resolved':
      return {
        selection: inputs.device.selection,
        resolution: { status: 'resolved', selection: inputs.device.selection },
        source: 'device',
        deviceIssue,
        needsPlace: false,
        isGlobal: false,
        canQuery: true,
      };
    case 'resolving':
      // NOT `needsPlace`: the picker must not flash open for the half-second a
      // fix takes, or every launch with permission granted shows a modal it then
      // dismisses. Nothing may be queried yet either.
      return {
        selection: null,
        resolution: { status: 'resolving' },
        source: null,
        deviceIssue,
        needsPlace: false,
        isGlobal: false,
        canQuery: false,
      };
    case 'failed':
      // 5. The mandatory picker, carrying the REASON so the surface can say
      //    "location is off" rather than a generic error — and, critically, NOT
      //    a global feed. This is the rung the old code fell through.
      return {
        selection: null,
        resolution: { status: 'failed', reason: inputs.device.reason },
        source: null,
        deviceIssue,
        needsPlace: true,
        isGlobal: false,
        canQuery: false,
      };
    case 'idle':
      // Never asked, and we do not ask unprompted. The picker is the answer.
      return {
        selection: null,
        resolution: { status: 'idle' },
        source: null,
        deviceIssue,
        needsPlace: true,
        isGlobal: false,
        canQuery: false,
      };
    default: {
      const exhaustive: never = inputs.device;
      return exhaustive;
    }
  }
}
