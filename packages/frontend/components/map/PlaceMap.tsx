/**
 * A map of one place: opened on it at street zoom, and — with `pin` — marked
 * by a pill that carries `label`. The reader can still pan and zoom.
 */
import { useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { MapView, Markers, type GeoCoordinate, type MapMarkerData } from '@goway.to/maps';

import { ADDRESS_ZOOM } from './mapDefaults';

export interface PlaceMapProps {
  coordinate: GeoCoordinate;
  /** Mark the place with a pin. */
  pin?: boolean;
  /** The pin's text; absent, a compact pin. */
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const PIN_ID = 'place';

export function PlaceMap({ coordinate, pin = false, label, style, testID }: PlaceMapProps) {
  const { latitude, longitude } = coordinate;
  const markers = useMemo<MapMarkerData[]>(
    () => (pin ? [{ id: PIN_ID, coordinate: { latitude, longitude }, label }] : []),
    [pin, latitude, longitude, label],
  );
  return (
    <MapView
      style={style}
      initialViewState={{ latitude, longitude, zoom: ADDRESS_ZOOM }}
      camera={{ center: { latitude, longitude }, zoom: ADDRESS_ZOOM }}
      testID={testID}
    >
      <Markers data={markers} />
    </MapView>
  );
}
