/**
 * What Homiio remembers about WHERE you are looking (#353).
 *
 * ## Two lifetimes, and the split is the privacy decision
 *
 * **Session, in memory:** the explicit choice made in this session and the
 * explicit "Explore everywhere". Neither survives a restart, and that is not an
 * oversight. The first acceptance criterion is "abrir la app no ejecuta una
 * búsqueda global salvo elección explícita" — a global choice made yesterday is
 * not an explicit choice about today's opening, so persisting it would let a
 * single tap turn every future launch into the worldwide feed this issue exists
 * to remove.
 *
 * **Device, on disk:** the last area the user CHOSE, and whether the system
 * permission prompt has already been shown.
 *
 * ## What is never written to disk
 *
 * A `current_location` selection. {@link setLastChosenArea} refuses it — not
 * "avoids" it, refuses it — because that selection carries the device fix at
 * full precision and ADR 0002 §8.2 keeps an exact coordinate out of any
 * persisted client store. The issue says the same thing from the product side:
 * "la última selección se restaura sin conservar GPS exacto indebidamente".
 *
 * A city or neighbourhood selection IS written, `center` included, and that is
 * consistent rather than an exception: its precision is `centroid`, which ADR
 * §8.1 defines as the representative point of an AREA and explicitly not
 * anybody's location.
 *
 * ## Why the permission flag is persisted and the rest is not
 *
 * "No repetir el prompt del sistema en cada render/apertura." The OS prompt is
 * shown once; after that the answer is read, never re-requested, unless the user
 * asks for it again by pressing the button. A flag that reset on restart would
 * re-prompt on every cold start, which is the behaviour being removed.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationSelection } from '@homiio/shared-types';
import type { CommittedAutoScope } from '@/hooks/locationScopeLadder';

const PERSIST_KEY = '@homiio/location-scope-v1';

interface LocationScopeState {
  /** An explicit choice made in this session. Highest rung of the ladder. */
  sessionSelection: LocationSelection | null;
  /** The user pressed "Explore everywhere". Session-only, see the header. */
  explicitGlobal: boolean;
  /** The last area the user chose on this device. Never a device fix. */
  lastChosenArea: LocationSelection | null;
  /** Whether the OS location prompt has been shown at least once. */
  permissionPromptShown: boolean;
  /** True while the user has asked to use their position in this session. */
  deviceRequested: boolean;
  /**
   * The first INFERRED scope of this session, once one has been applied.
   *
   * Session-only and never persisted — a new launch re-resolves, which is what
   * makes moving between networks noticeable. Its whole job is to stop a SECOND
   * automatic answer from replacing the first: the ladder reads it above both
   * inference rungs, so a GPS fix arriving after the network already placed
   * somebody becomes an offer rather than a jump (#518 §3.3).
   */
  autoScope: CommittedAutoScope | null;

  /**
   * Commit an explicit choice.
   *
   * Clears `explicitGlobal`: choosing a place is choosing not to be everywhere,
   * and leaving the flag set would make the next re-resolution silently ignore
   * the place the user just picked.
   */
  choose: (selection: LocationSelection) => void;
  /** The explicit, and only, route to an unscoped query. */
  exploreGlobal: () => void;
  /** Ask to use the device position. Also records that the prompt is coming. */
  requestDevice: () => void;
  /**
   * Apply an inferred scope, ONCE per session.
   *
   * Idempotent by construction: a second call is ignored while one is in force.
   * That is not an optimisation — it is the invariant. The hook calls this from
   * an effect that runs on every render where an inference is in force, so a
   * version that overwrote would reintroduce exactly the jump it prevents.
   */
  commitAutoScope: (scope: CommittedAutoScope) => void;
  /** Record that the OS prompt has been shown, so it is not shown again. */
  markPermissionPromptShown: () => void;
  /** Drop the session choice, returning to whatever the ladder resolves next. */
  clearSession: () => void;
}

/**
 * Whether a selection may be written to disk.
 *
 * Exported so the test can assert the refusal directly rather than through the
 * store, and so the rule reads as a named predicate at the one call site that
 * has to apply it.
 */
export function isPersistableArea(selection: LocationSelection): boolean {
  return selection.kind !== 'current_location';
}

export const useLocationScopeStore = create<LocationScopeState>()(
  persist(
    (set) => ({
      sessionSelection: null,
      explicitGlobal: false,
      lastChosenArea: null,
      permissionPromptShown: false,
      deviceRequested: false,
      autoScope: null,

      choose: (selection) =>
        set((state) => ({
          sessionSelection: selection,
          explicitGlobal: false,
          // A place chosen after "use my location" replaces it.
          deviceRequested: false,
          // An explicit choice ends the session's inferred scope outright. Kept
          // around, it would reappear the moment the choice was cleared — the
          // user would return not to discovery but to a city they had replaced.
          autoScope: null,
          // The persisted rung only ever remembers an AREA. A device fix stays
          // in the session slot above and dies with the process.
          lastChosenArea: isPersistableArea(selection) ? selection : state.lastChosenArea,
        })),

      exploreGlobal: () =>
        set({ explicitGlobal: true, sessionSelection: null, deviceRequested: false, autoScope: null }),

      // Clears the session choice: pressing "use my location" is a newer choice
      // than the place picked before it, and the ladder ranks a session choice
      // above the device.
      requestDevice: () =>
        set({ deviceRequested: true, explicitGlobal: false, sessionSelection: null, autoScope: null }),

      commitAutoScope: (scope) => set((state) => (state.autoScope ? {} : { autoScope: scope })),

      markPermissionPromptShown: () => set({ permissionPromptShown: true }),

      clearSession: () => set({ sessionSelection: null, explicitGlobal: false, autoScope: null }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      // ONLY these two cross a restart. An allow-list rather than a deny-list:
      // a field added later is excluded by default, so the next person to add
      // one cannot accidentally persist a position by forgetting to exclude it.
      partialize: (state) => ({
        lastChosenArea: state.lastChosenArea,
        permissionPromptShown: state.permissionPromptShown,
      }),
    },
  ),
);
