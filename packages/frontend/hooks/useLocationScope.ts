/**
 * The app-wide answer to "where am I looking?".
 *
 * Shared on purpose: Home, Explore, the eviction board and anything else that
 * has to state its area read the SAME scope, so two surfaces cannot disagree
 * about where the user is. This hook gathers the ladder's inputs; the decision
 * itself lives in `locationScopeLadder.ts` as a pure function, which is what
 * makes the ordering rules testable without rendering anything.
 *
 * ## Nothing here asks for permission, and nothing here blocks
 *
 * On mount this READS the permission (`getForegroundPermissionsAsync`) and
 * never requests it. `requestForegroundPermissionsAsync` runs only when the
 * user presses "use my location".
 *
 * When the permission has not been granted, the ladder's device rung simply
 * does not participate and the NETWORK rung answers instead — on the server,
 * from the visitor's own connection, with no prompt of any kind. The mandatory
 * picker that used to terminate this ladder is gone (#518, #519).
 *
 * ## One startup budget, not two waits in a row
 *
 * Both rungs are started together and share a single 1.5-second deadline
 * ({@link APPROXIMATE_BUDGET_MS}). #518 §3.3 forbids the alternative in those
 * words — "No encadenar primero los 10 segundos actuales de GPS y después una
 * llamada IP" — and chaining is exactly what a per-rung timeout produces.
 *
 * The deadline stops the app WAITING; it does not cancel anything. A fix or an
 * inference landing after it is still applied, provided nothing has been
 * committed in the meantime.
 *
 * ## A late answer cannot overwrite a newer choice, structurally
 *
 * Nothing here commits a selection from inside a promise. Both inference rungs
 * are REACT QUERY DATA, read by the ladder as inputs and ranked below every
 * explicit choice. So the shapes of the "respuesta tardía" failure are
 * unreachable rather than defended against:
 *
 *  - an answer arriving after the user picked a city loses to
 *    `sessionSelection`, because the ladder reads that rung first;
 *  - a stale device response for a PREVIOUS position lands in a different cache
 *    entry (its key holds the old grid square) and is never read;
 *  - a SECOND automatic answer loses to the first one, because the first is
 *    recorded (`autoScope`, by {@link observeInferredScope}) and the ladder
 *    reads that above both inference rungs. It becomes `upgrade` — an offer —
 *    instead.
 *
 * ## A geocoding failure never clears the scope
 *
 * The reverse geocode that turns a fix into "near Bucharest" is a SEPARATE
 * query from the fix itself, and its failure produces a selection with no
 * nearby label rather than no selection. The scope is the coordinates and the
 * radius; the label is decoration, and decoration failing must not un-scope a
 * search.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { type QueryClient, type QueryKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '@oxy.so/services';
import {
  KEY_COORD_DECIMALS,
  type ApproximateLocation,
  type GeoPlace,
  type LocationSelection,
} from '@homiio/shared-types';

import { reversePlace } from '@/services/geoService';
import { useLocationScopeStore } from '@/store/locationScopeStore';
import type { SavedSearch } from '@/store/savedSearchesStore';
import {
  primarySavedAreaOf,
  SAVED_SEARCHES_KEY,
  usePrimarySavedArea,
  type PrimarySavedArea,
} from './useSavedSearches';
import {
  resolveLocationScope,
  type DevicePositionState,
  type LocationScopeState,
} from './locationScopeLadder';
import {
  APPROXIMATE_BUDGET_MS,
  APPROXIMATE_LOCATION_QUERY_KEY,
  approximateStateOf,
  useApproximateLocation,
} from './useApproximateLocation';

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
  /** Never asked, and this read may not ask. NOT a denial — see `resolvePermission`. */
  | { readonly status: 'not_asked' }
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
async function resolvePermission(mayPrompt: boolean): Promise<'granted' | 'denied' | 'not_asked'> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === 'granted') return 'granted';
  if (!mayPrompt) {
    // "Never asked" is not "denied", and the difference is what the user is
    // told: calling an unasked permission a denial said "location is off" to
    // somebody who had never been offered it, and disabled the one row that
    // would have asked. A denial counts only when asking again cannot help — on
    // web a `denied` state is final (expo-location reports `canAskAgain: true`
    // there regardless), on native only once the OS says it will not ask.
    const final = current.status === 'denied' && (Platform.OS === 'web' || !current.canAskAgain);
    return final ? 'denied' : 'not_asked';
  }
  const requested = await Location.requestForegroundPermissionsAsync();
  return requested.status === 'granted' ? 'granted' : 'denied';
}

async function takeDeviceFix(mayPrompt: boolean): Promise<DeviceFixOutcome> {
  const permission = await resolvePermission(mayPrompt);
  if (permission === 'not_asked') return { status: 'not_asked' };
  if (permission === 'denied') return { status: 'denied' };

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
function deviceAreaKey(longitude: number, latitude: number): string {
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
  /**
   * Apply the precision upgrade on offer, if there is one.
   *
   * The one route from an inferred network area to the device's own position
   * WITHOUT the app having moved anybody: `upgrade` is computed by the ladder
   * and applied only here, by a press. A version that applied it automatically
   * is the city-jump #518 §3.3 forbids.
   */
  readonly applyUpgrade: () => void;
  /** Whether the OS prompt has already been shown on this device. */
  readonly permissionPromptShown: boolean;
}

/**
 * A one-shot deadline, as a boolean.
 *
 * `true` once `ms` have passed since the hook mounted. The clock is an external
 * source, so it is read with `useSyncExternalStore`: subscribing (at commit)
 * starts the timer and unsubscribing (unmount) clears it, so nothing keeps a
 * jest worker — or a backgrounded app — awake.
 *
 * It is a STATE and not a ref because the ladder has to re-run when it trips:
 * the whole point is that the surface moves from a skeleton to the destinations
 * board at the deadline, and a ref changes nothing on screen.
 */
function createDeadline(ms: number) {
  let elapsed = false;
  return {
    hasElapsed: () => elapsed,
    subscribe: (onElapsed: () => void) => {
      if (elapsed) return () => {};
      const timer = setTimeout(() => {
        elapsed = true;
        onElapsed();
      }, ms);
      return () => clearTimeout(timer);
    },
  };
}

function useDeadline(ms: number): boolean {
  const [deadline] = useState(() => createDeadline(ms));
  return useSyncExternalStore(deadline.subscribe, deadline.hasElapsed, deadline.hasElapsed);
}

/** The device fix's cache key. `deviceRequested` is in it — see the query. */
function deviceFixQueryKey(deviceRequested: boolean) {
  return ['locationScope', 'deviceFix', deviceRequested] as const;
}

/** What a query holds, read from a hook's result or straight out of the cache. */
interface QueryReading<T> {
  readonly data: T | undefined;
  readonly isPending: boolean;
  readonly isFetching: boolean;
}

/** The choices the ladder reads from the store. */
type ScopeChoices = Pick<
  ReturnType<typeof useLocationScopeStore.getState>,
  'explicitGlobal' | 'sessionSelection' | 'lastChosenArea' | 'deviceRequested' | 'autoScope'
>;

const pickChoices = (store: ScopeChoices): ScopeChoices => ({
  explicitGlobal: store.explicitGlobal,
  sessionSelection: store.sessionSelection,
  lastChosenArea: store.lastChosenArea,
  deviceRequested: store.deviceRequested,
  autoScope: store.autoScope,
});

/**
 * Everything the ladder reads, as plain values.
 *
 * Gathered by {@link useLocationScope} from its hooks to render, and by
 * {@link observeInferredScope} from the cache to commit — one derivation,
 * {@link scopeOf}, so the two cannot disagree about which rung is in force.
 */
interface ScopeSources {
  readonly choices: ScopeChoices;
  readonly savedArea: PrimarySavedArea;
  readonly fix: QueryReading<DeviceFixOutcome>;
  readonly approximate: QueryReading<ApproximateLocation>;
  /** Whether the shared startup deadline has passed. */
  readonly budgetElapsed: boolean;
}

/**
 * Whether an INFERENCE could still be used at all.
 *
 * False the moment any explicit rung supplies an area, which is what keeps
 * the network lookup from running for somebody who has already said where
 * they are looking — a request whose answer the ladder would discard.
 *
 * A saved area still LOADING counts as one. Treating "still loading" as
 * "absent" produces exactly the late-answer failure this file's header claims
 * is unreachable: the ladder would fall to an inferred rung, resolve Home to
 * it, and then jump to the saved area a moment later when the request lands —
 * a scope changing under the user with no action from them.
 */
function inferenceUsable(choices: ScopeChoices, savedArea: PrimarySavedArea): boolean {
  return (
    !choices.explicitGlobal &&
    !choices.sessionSelection &&
    !savedArea.pending &&
    !savedArea.selection &&
    !choices.lastChosenArea
  );
}

/**
 * Whether the device rung runs: when there is nothing above it to use, or when
 * the user asked for it.
 *
 * Gating on the higher rungs is not an optimisation: taking a position for a
 * scope that will be outranked is a location read the user did not ask for and
 * would not benefit from.
 */
function deviceNeeded(choices: ScopeChoices, savedArea: PrimarySavedArea): boolean {
  return choices.deviceRequested || inferenceUsable(choices, savedArea);
}

/**
 * Whether the network lookup runs. Still enabled once an inferred scope is
 * committed: it IS the committed scope's source, and disabling it would drop
 * the cache entry the ladder is reading from.
 */
function approximateEnabled(choices: ScopeChoices, savedArea: PrimarySavedArea): boolean {
  return inferenceUsable(choices, savedArea) || choices.autoScope?.source === 'ip';
}

/** What the device rung knows, before the startup budget is applied. */
function deviceStateOf({ choices, savedArea, fix }: ScopeSources): DevicePositionState {
  // `resolving` while the rung ABOVE is still loading, so the ladder reports
  // `resolving` rather than falling through. Reporting `idle` here would flash
  // the destinations board for the half-second the saved-search request takes,
  // for a user who has already chosen an area.
  if (savedArea.pending) return { status: 'resolving' };
  if (!deviceNeeded(choices, savedArea)) return { status: 'idle' };
  if (fix.isPending || fix.isFetching) return { status: 'resolving' };
  const outcome = fix.data;
  if (!outcome) {
    // The query is enabled, settled, and produced nothing — the only way that
    // happens is a rejection, which `takeDeviceFix` does not throw but a
    // cancelled query can produce. Treated as unavailable, never as denied:
    // telling somebody their permission was refused when it was not is worse
    // than telling them we could not get a fix.
    return { status: 'failed', reason: 'position_unavailable' };
  }
  if (outcome.status === 'not_asked') return { status: 'idle' };
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
}

/** The scope, from everything the ladder reads. */
function scopeOf(sources: ScopeSources): LocationScopeState {
  const { choices, savedArea, approximate, budgetElapsed } = sources;
  const device = deviceStateOf(sources);
  return resolveLocationScope({
    explicitGlobal: choices.explicitGlobal,
    sessionSelection: choices.sessionSelection,
    savedAreaSelection: savedArea.selection,
    lastChosenSelection: choices.lastChosenArea,
    // After the deadline a still-unanswered device stops reporting `resolving`,
    // so the ladder moves on to the network answer or to discovery instead of
    // holding a skeleton for the ten seconds `getCurrentPositionAsync` may take
    // indoors. Reported as `idle` — "this rung has nothing to say" — rather
    // than as a failure, because it has not failed and may yet answer.
    //
    // NOT applied when the user PRESSED the button: they asked, they are
    // watching a spinner they started, and a deadline that quietly gave up on
    // them would be the button doing nothing.
    device:
      !choices.deviceRequested && budgetElapsed && device.status === 'resolving'
        ? { status: 'idle' }
        : device,
    approximate: approximateStateOf({
      enabled: approximateEnabled(choices, savedArea),
      isPending: approximate.isPending,
      elapsedBudget: budgetElapsed,
      data: approximate.data,
    }),
    committedAuto: choices.autoScope,
    deviceRequested: choices.deviceRequested,
  });
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
 * yet: see `inferenceUsable`.
 */

export function useLocationScope(): LocationScope {
  const queryClient = useQueryClient();
  const choices = useLocationScopeStore(useShallow(pickChoices));
  const permissionPromptShown = useLocationScopeStore((s) => s.permissionPromptShown);
  const savedArea = usePrimarySavedArea();
  const { deviceRequested } = choices;

  const fixQuery = useQuery({
    // `deviceRequested` is part of the key so that pressing the button after a
    // denial re-runs the read instead of serving the cached denial forever.
    queryKey: deviceFixQueryKey(deviceRequested),
    queryFn: () => takeDeviceFix(deviceRequested),
    enabled: deviceNeeded(choices, savedArea),
    staleTime: DEVICE_FIX_MAX_AGE_MS,
    gcTime: DEVICE_FIX_MAX_AGE_MS,
    retry: false,
  });

  const outcome = fixQuery.data;
  const fix: Extract<DeviceFixOutcome, { status: 'granted' }> | null =
    outcome !== undefined && outcome.status === 'granted' ? outcome : null;

  const areaQuery = useQuery({
    // Keyed by the GRID SQUARE, never the exact position — see `deviceAreaKey`.
    queryKey: [
      'locationScope',
      'deviceArea',
      fix ? deviceAreaKey(fix.longitude, fix.latitude) : 'none',
    ] as const,
    // Only ever invoked with `fix` present (`enabled` below), so the fallbacks
    // are unreachable; they exist because the queryFn is typed independently of
    // `enabled` and a non-null assertion is not allowed here.
    queryFn: () => reversePlace(fix?.longitude ?? 0, fix?.latitude ?? 0),
    enabled: fix !== null,
    staleTime: DEVICE_AREA_STALE_MS,
    retry: false,
  });

  // ONE clock for both rungs. See the header: chaining two timeouts is the
  // failure mode, not a slow first one.
  const budgetElapsed = useDeadline(APPROXIMATE_BUDGET_MS);

  const approximateQuery = useApproximateLocation({
    enabled: approximateEnabled(choices, savedArea),
  });

  const state = useMemo(
    () =>
      scopeOf({
        choices,
        savedArea,
        fix: {
          data: fixQuery.data,
          isPending: fixQuery.isPending,
          isFetching: fixQuery.isFetching,
        },
        approximate: {
          data: approximateQuery.data,
          isPending: approximateQuery.isPending,
          isFetching: approximateQuery.isFetching,
        },
        budgetElapsed,
      }),
    [
      choices,
      savedArea,
      fixQuery.data,
      fixQuery.isPending,
      fixQuery.isFetching,
      approximateQuery.data,
      approximateQuery.isPending,
      approximateQuery.isFetching,
      budgetElapsed,
    ],
  );

  const choose = useCallback((selection: LocationSelection) => {
    useLocationScopeStore.getState().choose(selection);
  }, []);

  const exploreGlobal = useCallback(() => {
    useLocationScopeStore.getState().exploreGlobal();
  }, []);

  const useCurrentLocation = useCallback(() => {
    const store = useLocationScopeStore.getState();
    const alreadyRequested = store.deviceRequested;
    store.requestDevice();
    store.markPermissionPromptShown();
    // A second press after a failed fix is a RETRY. The key has not changed, so
    // without a reset the cached failure would answer it and nothing would run.
    if (alreadyRequested) {
      void queryClient.resetQueries({ queryKey: deviceFixQueryKey(true) });
    }
  }, [queryClient]);

  /**
   * Take the precision upgrade the ladder is offering.
   *
   * Expressed as `choose`, not as a second commit path: applying it makes the
   * device position an EXPLICIT selection, which is what it now is — the user
   * pressed a button naming it. That also clears `autoScope`, so the offer
   * disappears rather than lingering beside the area it produced.
   */
  const upgrade = state.upgrade;
  const applyUpgrade = useCallback(() => {
    if (!upgrade) return;
    useLocationScopeStore.getState().choose(upgrade.selection);
  }, [upgrade]);

  return {
    ...state,
    nearbyPlace: state.source === 'device' ? (areaQuery.data ?? null) : null,
    choose,
    exploreGlobal,
    useCurrentLocation,
    applyUpgrade,
    permissionPromptShown,
  };
}

/** A query's state as the cache holds it. No entry yet reads as not answered. */
function cachedReading<T>(queryClient: QueryClient, queryKey: QueryKey): QueryReading<T> {
  const state = queryClient.getQueryState<T>(queryKey);
  return {
    data: state?.data,
    isPending: state === undefined || state.status === 'pending',
    isFetching: state?.fetchStatus === 'fetching',
  };
}

/**
 * Record the FIRST inferred scope of the session, where the answers land.
 *
 * "The first inference in force" is HISTORY, not something derivable from the
 * current inputs, so it is written down (`commitAutoScope`) the moment the
 * ladder first resolves to the device or the network. That moment is always one
 * of the ladder's sources changing — the device fix or the network answer
 * landing, the saved-area query settling, a choice in the store, a sign-in or
 * sign-out — so this subscribes to those sources and runs the same
 * {@link scopeOf} the hook renders from, reading the queries out of the cache.
 * Nothing renders, so nothing commits from an effect.
 *
 * The QueryCache is subscribed to rather than a `QueryObserver` per query: an
 * observer is a CONSUMER of its query, and would keep a device fix alive past
 * the five-minute `gcTime` ADR 0002 §8.3 gives it. Every cache event is read,
 * not only the three keys, because the check is cheap and a key list would be
 * one more thing to keep in step with the ladder.
 *
 * The startup deadline is not read. It decides when a surface stops WAITING —
 * moving a rung between `resolving` and `idle` or `unavailable` — never which
 * answer is in force.
 *
 * `deviceRequested` is excluded: a scope the user ASKED for is not an inference
 * the app needs to protect them from, and recording it would make the next press
 * of the button a no-op.
 *
 * Wired once by the root layout, at module scope, for the app's QueryClient.
 * Returns the unsubscribe.
 */
export function observeInferredScope(queryClient: QueryClient): () => void {
  const commit = (): void => {
    const store = useLocationScopeStore.getState();
    // `commitAutoScope` would ignore a second call anyway; returning first keeps
    // every cache event after the commit to two reads.
    if (store.deviceRequested || store.autoScope) return;
    const { source, selection } = scopeOf({
      choices: store,
      savedArea: primarySavedAreaOf(
        // The session `usePrimarySavedArea` reads through `useOxy`, read here
        // through the SDK's out-of-render surface for it.
        useAuthStore.getState().isAuthenticated,
        cachedReading<SavedSearch[]>(queryClient, SAVED_SEARCHES_KEY),
      ),
      fix: cachedReading(queryClient, deviceFixQueryKey(false)),
      approximate: cachedReading(queryClient, APPROXIMATE_LOCATION_QUERY_KEY),
      budgetElapsed: false,
    });
    if ((source === 'device' || source === 'ip') && selection) {
      store.commitAutoScope({ source, selection });
    }
  };
  const unsubscribes = [
    queryClient.getQueryCache().subscribe(commit),
    useLocationScopeStore.subscribe(commit),
    useAuthStore.subscribe(commit),
  ];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
