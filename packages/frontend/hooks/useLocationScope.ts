/**
 * The app-wide answer to "where am I looking?" (#353).
 *
 * Shared on purpose: Home, the eviction board and anything else that has to
 * state its area read the SAME scope, so two surfaces cannot disagree about
 * where the user is. This hook gathers the ladder's inputs; the decision itself
 * lives in `locationScopeLadder.ts` as a pure function, which is what makes the
 * ordering rules testable without rendering anything.
 *
 * ## The permission prompt is shown ONCE, on request
 *
 * On mount this READS the permission (`getForegroundPermissionsAsync`) and never
 * requests it. `requestForegroundPermissionsAsync` runs only when the user
 * presses "use my location", which is the issue's "no repetir el prompt del
 * sistema en cada render/apertura". The previous behaviour requested on every
 * cold start of the home feed.
 *
 * ## A late answer cannot overwrite a newer choice, structurally
 *
 * Nothing here commits a selection from inside a promise. The device rung is
 * REACT QUERY DATA keyed by the gridded fix; the ladder reads it as an input and
 * ranks it below every explicit choice. So the two shapes of the "respuesta
 * tardía" failure are both unreachable rather than defended against:
 *
 *  - a device answer arriving after the user picked a city loses to
 *    `sessionSelection`, because the ladder reads that rung first;
 *  - a stale response for a PREVIOUS position lands in a different cache entry
 *    (its key holds the old grid square) and is never read.
 *
 * ## A geocoding failure never clears the scope
 *
 * The reverse geocode that turns a fix into "near Bucharest" is a SEPARATE query
 * from the fix itself, and its failure produces a selection with no nearby label
 * rather than no selection. The scope is the coordinates and the radius; the
 * label is decoration, and decoration failing must not un-scope a search.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import {
  KEY_COORD_DECIMALS,
  type GeoPlace,
  type LocationSelection,
} from '@homiio/shared-types';

import { reversePlace } from '@/services/geoService';
import { useLocationScopeStore } from '@/store/locationScopeStore';
import { usePrimarySavedArea } from './useSavedSearches';
import {
  resolveLocationScope,
  type DevicePositionState,
  type LocationScopeState,
} from './locationScopeLadder';

/**
 * The radius a device-scoped search covers, in METRES.
 *
 * Matches the search endpoint's own `DEFAULT_RADIUS_METERS`, so the scope asks
 * for exactly what the server would have applied anyway. METRES, and the unit is
 * worth saying twice: the previous "near you" lens sent `25` and meant
 * kilometres, so it asked for everything within 25 metres of the device and
 * returned a global page ranked by a flag that is false for every listing there
 * has ever been.
 */
export const DEVICE_SCOPE_RADIUS_METERS = 25_000;

/**
 * How long a device fix may be reused before it is taken again.
 *
 * ADR 0002 §8.3: in memory, five minutes, never persisted. `gcTime` matches, so
 * an expired fix is dropped rather than lingering as a stale-but-served value —
 * and because the permission is re-read on every refetch, expiry is also what
 * makes a REVOKED permission take effect without killing the app.
 */
const DEVICE_FIX_MAX_AGE_MS = 1000 * 60 * 5;

/**
 * How long to wait for a position before calling it unavailable.
 *
 * `getCurrentPositionAsync` has no timeout of its own and can wait indefinitely
 * indoors, so without this the surface sits on a skeleton forever with no way
 * for the user to learn that nothing is coming. The issue lists "GPS timeout" as
 * a mandatory test case, which is only testable if the timeout is ours.
 */
const DEVICE_FIX_TIMEOUT_MS = 10_000;

/** A reverse-geocoded label is worth keeping far longer than the fix itself. */
const DEVICE_AREA_STALE_MS = 1000 * 60 * 30;

/** What asking the device produced. Never an exception, always an outcome. */
type DeviceFixOutcome =
  | { readonly status: 'granted'; readonly longitude: number; readonly latitude: number }
  | { readonly status: 'denied' }
  | { readonly status: 'unavailable' };

/**
 * Race a promise against a deadline.
 *
 * The timer is cleared on both paths, so a resolved position does not keep a
 * pending timeout alive for ten seconds — which in a test environment is the
 * difference between a suite that exits and one that hangs.
 */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Read the permission, and request it only when the user asked.
 *
 * Split out because the distinction is the whole of the "do not re-prompt" rule
 * and it is one boolean away from being lost.
 */
async function resolvePermission(mayPrompt: boolean): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === 'granted') return true;
  if (!mayPrompt) return false;
  const requested = await Location.requestForegroundPermissionsAsync();
  return requested.status === 'granted';
}

async function takeDeviceFix(mayPrompt: boolean): Promise<DeviceFixOutcome> {
  const granted = await resolvePermission(mayPrompt);
  if (!granted) return { status: 'denied' };

  const position = await withDeadline(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    DEVICE_FIX_TIMEOUT_MS,
  ).catch(() => 'timeout' as const);

  if (position === 'timeout') return { status: 'unavailable' };
  return {
    status: 'granted',
    longitude: position.coords.longitude,
    latitude: position.coords.latitude,
  };
}

/**
 * The cache key for a fix's reverse geocode: the position on a ~1.1 km grid.
 *
 * Gridded rather than exact for two reasons that happen to agree. ADR 0002 §8.2
 * keeps a full-precision coordinate out of every React Query key; and a label
 * that changed every time the GPS jittered by a metre would re-fetch the gateway
 * continuously for an answer that cannot have changed.
 */
export function deviceAreaKey(longitude: number, latitude: number): string {
  const grid = (value: number): number => {
    const factor = 10 ** KEY_COORD_DECIMALS;
    const rounded = Math.round(value * factor) / factor;
    return rounded === 0 ? 0 : rounded;
  };
  return `${grid(longitude)},${grid(latitude)}`;
}

export interface LocationScope extends LocationScopeState {
  /**
   * The nearest named place, when a reverse geocode succeeded.
   *
   * Display only, and only meaningful for a device scope — it is what turns
   * "near you" into "near Bucharest". Absent when the gateway failed, which
   * degrades the LABEL and not the scope.
   */
  readonly nearbyPlace: GeoPlace | null;
  /** Commit an explicit choice. Outranks every other rung immediately. */
  readonly choose: (selection: LocationSelection) => void;
  /** The one route to an unscoped query. */
  readonly exploreGlobal: () => void;
  /** Ask for the device position; prompts at most once per user request. */
  readonly useCurrentLocation: () => void;
  /** Whether the OS prompt has already been shown on this device. */
  readonly permissionPromptShown: boolean;
}

/**
 * The saved-search rung, LIVE since #356.
 *
 * It reads the watch a person marked as their primary area — at most one each,
 * enforced by a partial unique index — through {@link usePrimarySavedArea}. That
 * flag is an EXPLICIT choice, which is why the rung may outrank the device
 * position; it is not inferred from behaviour.
 *
 * The substitute this rung was written to refuse is still refused: "the most
 * recently updated saved search that has a location" would scope somebody's
 * entire Home to whichever city they happened to bookmark last, presented as
 * their home area, with no way to see why. `usePrimarySavedArea` reads the flag
 * or answers `null`; it never guesses which of several saved searches is
 * primary.
 *
 * `null` remains the COMMON answer — most people have no primary area — and the
 * ladder still falls through it, because an absent rung is a skip and not a
 * failure. What is new is that the absence is now DISTINGUISHED from not knowing
 * yet: see `savedAreaPending` below.
 */

export function useLocationScope(): LocationScope {
  const sessionSelection = useLocationScopeStore((s) => s.sessionSelection);
  const explicitGlobal = useLocationScopeStore((s) => s.explicitGlobal);
  const lastChosenArea = useLocationScopeStore((s) => s.lastChosenArea);
  const deviceRequested = useLocationScopeStore((s) => s.deviceRequested);
  const permissionPromptShown = useLocationScopeStore((s) => s.permissionPromptShown);
  const primaryArea = usePrimarySavedArea();
  const savedAreaSelection = primaryArea.selection;
  /**
   * Whether the saved-area rung has ANSWERED yet.
   *
   * Distinct from `savedAreaSelection === null`, and the distinction is the
   * whole reason this exists rather than a bare read. Treating "still loading"
   * as "absent" produces exactly the late-answer failure this file's header
   * claims is unreachable: the ladder would fall to the device rung, resolve
   * Home to the device position, and then jump to the saved area a moment later
   * when the request lands — a scope changing under the user with no action
   * from them.
   *
   * `false` for a logged-out user, who cannot have a primary area, so nothing
   * ever waits on a request that will not be made.
   */
  const savedAreaPending = primaryArea.pending;

  // The device rung runs when there is nothing above it to use, or when the user
  // asked for it. Gating on the higher rungs is not an optimisation: taking a
  // position for a scope that will be outranked is a location read the user did
  // not ask for and would not benefit from.
  const deviceNeeded =
    deviceRequested ||
    (!explicitGlobal &&
      !sessionSelection &&
      // NOT merely `!savedAreaSelection`: taking a position while the rung above
      // is still loading is a location read for a scope that may be about to be
      // outranked, which is the very thing the gate below it exists to avoid.
      !savedAreaPending &&
      !savedAreaSelection &&
      !lastChosenArea);

  const fixQuery = useQuery({
    // `deviceRequested` is part of the key so that pressing the button after a
    // denial re-runs the read instead of serving the cached denial forever.
    queryKey: ['locationScope', 'deviceFix', deviceRequested] as const,
    queryFn: () => takeDeviceFix(deviceRequested),
    enabled: deviceNeeded,
    staleTime: DEVICE_FIX_MAX_AGE_MS,
    gcTime: DEVICE_FIX_MAX_AGE_MS,
    retry: false,
  });

  const outcome = fixQuery.data;
  const fix: Extract<DeviceFixOutcome, { status: 'granted' }> | null =
    outcome !== undefined && outcome.status === 'granted' ? outcome : null;

  const areaQuery = useQuery({
    // Keyed by the GRID SQUARE, never the exact position — see `deviceAreaKey`.
    queryKey: ['locationScope', 'deviceArea', fix ? deviceAreaKey(fix.longitude, fix.latitude) : 'none'] as const,
    // Only ever invoked with `fix` present (`enabled` below), so the fallbacks
    // are unreachable; they exist because the queryFn is typed independently of
    // `enabled` and a non-null assertion is not allowed here.
    queryFn: () => reversePlace(fix?.longitude ?? 0, fix?.latitude ?? 0),
    enabled: fix !== null,
    staleTime: DEVICE_AREA_STALE_MS,
    retry: false,
  });

  const device = useMemo((): DevicePositionState => {
    // `resolving` while the rung ABOVE is still loading, so the ladder reports
    // `resolving` rather than falling through to the mandatory picker. Reporting
    // `idle` here would flash the place picker open for the half-second the
    // saved-search request takes, for a user who has already chosen an area —
    // the same reason the device rung's own `resolving` branch refuses
    // `needsPlace`.
    if (savedAreaPending) return { status: 'resolving' };
    if (!deviceNeeded) return { status: 'idle' };
    if (fixQuery.isPending || fixQuery.isFetching) return { status: 'resolving' };
    const outcome = fixQuery.data;
    if (!outcome) {
      // The query is enabled, settled, and produced nothing — the only way that
      // happens is a rejection, which `takeDeviceFix` does not throw but a
      // cancelled query can produce. Treated as unavailable, never as denied:
      // telling somebody their permission was refused when it was not is worse
      // than telling them we could not get a fix.
      return { status: 'failed', reason: 'position_unavailable' };
    }
    if (outcome.status === 'denied') return { status: 'failed', reason: 'permission_denied' };
    if (outcome.status === 'unavailable') return { status: 'failed', reason: 'position_unavailable' };
    return {
      status: 'resolved',
      selection: {
        kind: 'current_location',
        center: { longitude: outcome.longitude, latitude: outcome.latitude },
        radiusMeters: DEVICE_SCOPE_RADIUS_METERS,
        precision: 'exact',
      },
    };
  }, [savedAreaPending, deviceNeeded, fixQuery.isPending, fixQuery.isFetching, fixQuery.data]);

  const state = useMemo(
    () =>
      resolveLocationScope({
        explicitGlobal,
        sessionSelection,
        savedAreaSelection,
        lastChosenSelection: lastChosenArea,
        device,
      }),
    [explicitGlobal, sessionSelection, savedAreaSelection, lastChosenArea, device],
  );

  const choose = useCallback((selection: LocationSelection) => {
    useLocationScopeStore.getState().choose(selection);
  }, []);

  const exploreGlobal = useCallback(() => {
    useLocationScopeStore.getState().exploreGlobal();
  }, []);

  const useCurrentLocation = useCallback(() => {
    const store = useLocationScopeStore.getState();
    store.requestDevice();
    store.markPermissionPromptShown();
  }, []);

  return {
    ...state,
    nearbyPlace: state.source === 'device' ? (areaQuery.data ?? null) : null,
    choose,
    exploreGlobal,
    useCurrentLocation,
    permissionPromptShown,
  };
}
