/**
 * The app-wide scope, read for a "where?" control: the statement it shows and
 * the rows its panel offers. The words and states themselves are decided by the
 * pure functions in `./scopeWhere`; this only gathers their inputs.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDistance, locationKey, type LocationSelection } from '@homiio/shared-types';

import { DEVICE_SCOPE_RADIUS_METERS, type LocationScope } from '@/hooks/useLocationScope';
import { useLocationScopeStore } from '@/store/locationScopeStore';
import { useFormatting } from '@/utils/format';

import {
  deviceOptionDescription,
  deviceOptionState,
  geolocationSupported,
  scopeStatement,
  type DeviceOptionState,
  type ScopeStatement,
} from './scopeWhere';

export interface ScopeWhere {
  readonly statement: ScopeStatement;
  readonly device: { readonly state: DeviceOptionState; readonly description?: string };
  /**
   * The last area chosen on this device, when it is not the area `current`
   * already names — offering the area in force as a "way back" is a row that
   * goes nowhere.
   */
  readonly lastArea: LocationSelection | null;
  readonly geolocationSupported: boolean;
  /** The device radius, formatted ("25 km"). */
  readonly radius: string;
}

export function useScopeWhere(scope: LocationScope, current: LocationSelection | null): ScopeWhere {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const lastChosenArea = useLocationScopeStore((s) => s.lastChosenArea);
  const supported = geolocationSupported();

  const { selection, isGlobal, resolution, nearbyPlace, source, deviceIssue } = scope;

  return useMemo(() => {
    const formatDistanceValue = (metres: number): string => formatDistance(metres, locale);
    const radius = formatDistanceValue(DEVICE_SCOPE_RADIUS_METERS);
    const state = deviceOptionState({ source, resolution, deviceIssue, geolocationSupported: supported });
    const lastArea =
      lastChosenArea && (!current || locationKey(current) !== locationKey(lastChosenArea))
        ? lastChosenArea
        : null;
    return {
      statement: scopeStatement({
        selection,
        isGlobal,
        resolution,
        nearbyPlace,
        // The NETWORK case only — a device fix already describes its own radius.
        inferredFromNetwork: source === 'ip',
        t,
        formatDistanceValue,
      }),
      device: { state, description: deviceOptionDescription(state, t, radius) },
      lastArea,
      geolocationSupported: supported,
      radius,
    };
  }, [selection, isGlobal, resolution, nearbyPlace, source, deviceIssue, supported, lastChosenArea, current, locale, t]);
}
