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

      choose: (selection) =>
        set((state) => ({
          sessionSelection: selection,
          explicitGlobal: false,
          // The persisted rung only ever remembers an AREA. A device fix stays
          // in the session slot above and dies with the process.
          lastChosenArea: isPersistableArea(selection) ? selection : state.lastChosenArea,
        })),

      exploreGlobal: () => set({ explicitGlobal: true, sessionSelection: null }),

      requestDevice: () => set({ deviceRequested: true, explicitGlobal: false }),

      markPermissionPromptShown: () => set({ permissionPromptShown: true }),

      clearSession: () => set({ sessionSelection: null, explicitGlobal: false }),
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
