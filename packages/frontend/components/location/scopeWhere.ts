/**
 * What a "where?" control SAYS about the app-wide scope (#353), as pure functions.
 *
 * There is no separate scope strip any more. The area is stated by the control
 * that changes it — the first segment of the search bar on Home, its compact
 * trigger on a phone, the area chip on the eviction board — and the choices the
 * strip used to carry ("use my location", "explore everywhere", the reason
 * location is off) are rows in that control's panel. These functions decide the
 * words and the row states, so every surface states one area the same way and
 * the rules below are assertions rather than render details.
 *
 * ## The rules, from ADR 0002
 *
 *  - **Never a silent empty.** With no area the control reads "Choose an area",
 *    in its placeholder style; while the device answers it reads "Finding where
 *    you are…". Neither is a value, so neither can be mistaken for one.
 *  - **"Everywhere" only when somebody chose it.** `isGlobal` is the one input
 *    that produces it; `selection === null` alone produces the prompt.
 *  - **Nothing invented.** A device scope says "Near {place}" only when a reverse
 *    geocode supplied the place, and "Near you" otherwise — the radius is real
 *    either way.
 */

import { Platform } from 'react-native';

import type {
  GeoPlace,
  LocationFailureReason,
  LocationResolution,
  LocationSelection,
} from '@homiio/shared-types';

import { locationDisplayLabel, type SearchQuery } from '@/components/search/types';
import type { LocationScopeSource } from '@/hooks/locationScopeLadder';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The one phrase naming a committed scope.
 *
 * Exported for the test: "a device scope with no reverse-geocoded place says
 * 'Near you', never a borrowed city name" is the assertion that keeps this
 * surface from inventing a place, and it is worth pinning directly.
 */
export function describeScope(input: {
  selection: LocationSelection | null;
  /** The user chose "everywhere". Without it, "nothing chosen" reads as a choice. */
  isGlobal?: boolean;
  nearbyPlace?: GeoPlace | null;
  t: Translate;
  formatDistanceValue: (metres: number) => string;
}): string {
  const { selection, isGlobal = false, nearbyPlace, t, formatDistanceValue } = input;
  if (!selection) return t(isGlobal ? 'location.scope.everywhere' : 'location.scope.chooseArea');

  if (selection.kind === 'current_location') {
    const distance = formatDistanceValue(selection.radiusMeters);
    // `nearbyPlace.label.primary` is the geocoder's own string, used verbatim.
    // No re-casing, no comma splitting — ADR 0002 §9.4.
    return nearbyPlace
      ? t('location.scope.nearPlace', { place: nearbyPlace.label.primary, distance })
      : t('location.scope.nearYou', { distance });
  }

  return locationDisplayLabel(selection, t);
}

/**
 * What a "where?" control shows: a VALUE when an area is in force, otherwise a
 * PLACEHOLDER that is a prompt or a progress line — never an empty field.
 */
export interface ScopeStatement {
  /** The committed area ("Near Madrid · 25 km", "Everywhere"), or `null`. */
  readonly value: string | null;
  /** Shown while `value` is null: "Choose an area" or "Finding where you are…". */
  readonly placeholder: string;
}

export function scopeStatement(input: {
  selection: LocationSelection | null;
  isGlobal: boolean;
  resolution: LocationResolution;
  nearbyPlace?: GeoPlace | null;
  t: Translate;
  formatDistanceValue: (metres: number) => string;
}): ScopeStatement {
  const { selection, isGlobal, resolution, t } = input;
  const placeholder =
    resolution.status === 'resolving' ? t('location.scope.resolving') : t('location.scope.chooseArea');
  if (!selection && !isGlobal) return { value: null, placeholder };
  return { value: describeScope(input), placeholder };
}

/**
 * The query a search bound to the app-wide scope runs, or `null` when it must
 * ask for an area first.
 *
 * The location is the SCOPE's, never whatever the draft carried: the bar states
 * the scope, so running anything else would search an area the bar does not
 * name. And no area chosen is `null`, not a location-less query — that query is
 * the worldwide feed, reachable only through "Explore everywhere".
 */
export function scopedSearchQuery(
  query: SearchQuery,
  scope: { readonly selection: LocationSelection | null; readonly isGlobal: boolean },
): SearchQuery | null {
  if (scope.isGlobal) return { ...query, location: null };
  if (!scope.selection) return null;
  return { ...query, location: scope.selection };
}

/**
 * The "use my current location" row.
 *
 *  - `hidden` — this platform has no geolocation, or the scope already IS the
 *    device (the control's value says so).
 *  - `ready` — pressable.
 *  - `locating` — a fix is being taken; disabled, "Finding where you are…".
 *  - `denied` — permission is off; disabled, with the reason. Pressing again
 *    cannot help: the answer is cached and the OS will not prompt twice.
 *  - `retry` — the fix failed for another reason; pressable, it asks again.
 */
export type DeviceOptionState = 'hidden' | 'ready' | 'locating' | 'denied' | 'retry';

export function deviceOptionState(input: {
  source: LocationScopeSource | null;
  resolution: LocationResolution;
  deviceIssue: LocationFailureReason | null;
  geolocationSupported: boolean;
}): DeviceOptionState {
  if (!input.geolocationSupported || input.source === 'device') return 'hidden';
  if (input.deviceIssue === 'permission_denied') return 'denied';
  if (input.resolution.status === 'resolving') return 'locating';
  if (input.deviceIssue !== null) return 'retry';
  return 'ready';
}

/** The one-line description under the device row, per state. */
export function deviceOptionDescription(
  state: DeviceOptionState,
  t: Translate,
  radius: string,
): string | undefined {
  switch (state) {
    case 'ready':
      return t('location.scope.useCurrentHint', { distance: radius });
    case 'locating':
      return t('location.scope.resolving');
    case 'denied':
      return t('location.scope.locationOff');
    case 'retry':
      return t('location.scope.positionRetry');
    case 'hidden':
      return undefined;
  }
}

/**
 * Whether this runtime can take a position at all.
 *
 * Native always can (expo-location asks the OS). A browser without the
 * Geolocation API — or a non-secure context that strips it — cannot, and a row
 * that can only ever fail is not offered.
 */
export function geolocationSupported(): boolean {
  if (Platform.OS !== 'web') return true;
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}
