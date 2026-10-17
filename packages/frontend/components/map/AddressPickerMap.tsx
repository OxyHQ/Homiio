/**
 * A map to pick an address on: a tap drops the pin and looks up the address
 * under it, which the screen applies to its form.
 *
 * The pin and the camera follow `value`, the point the FORM holds — so the
 * inline map and the full-screen one show the same pin, and a point the form
 * gets another way (an address typed and geocoded, "use my location") is
 * framed without the screen commanding the map.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  MapView,
  Markers,
  type GeoCoordinate,
  type MapCameraTarget,
  type MapMarkerData,
  type MapPressEvent,
} from '@goway.to/maps';
import type { GeocodedAddress } from '@homiio/shared-types';

import { ADDRESS_ZOOM, DEVICE_ZOOM, HOMIIO_OPENING_VIEW } from './mapDefaults';
import { lookupAddress } from './lookupAddress';
import { useOpeningFix } from './useOpeningFix';

const PIN_ID = 'picked';

export interface AddressPickerMapProps {
  /** The point the form holds: the pin, framed whenever it changes. */
  value: GeoCoordinate | null;
  /** A tap found an address; the screen applies both to its form. */
  onAddressSelect: (address: GeocodedAddress, coordinate: GeoCoordinate) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const sameCoordinate = (a: GeoCoordinate | null, b: GeoCoordinate | null): boolean =>
  a === b || (!!a && !!b && a.latitude === b.latitude && a.longitude === b.longitude);

export function AddressPickerMap({ value, onAddressSelect, style, testID }: AddressPickerMapProps) {
  const openingFix = useOpeningFix();

  // The tap, drawn at once while its address is looked up. A new `value` (the
  // lookup applied, or an address typed) takes the pin back.
  const [tapped, setTapped] = useState<GeoCoordinate | null>(null);
  const [previousValue, setPreviousValue] = useState(value);
  if (!sameCoordinate(previousValue, value)) {
    setPreviousValue(value);
    setTapped(null);
  }
  const pin = tapped ?? value;

  const markers = useMemo<MapMarkerData[]>(
    () => (pin ? [{ id: PIN_ID, coordinate: pin }] : []),
    [pin],
  );

  // Only the latest tap's address is applied: a slow lookup for an earlier tap
  // must not overwrite the one the reader made after it.
  const latestTap = useRef<GeoCoordinate | null>(null);
  const handlePress = useCallback(
    ({ coordinate }: MapPressEvent) => {
      latestTap.current = coordinate;
      setTapped(coordinate);
      void lookupAddress(coordinate).then((address) => {
        if (address && latestTap.current === coordinate) onAddressSelect(address, coordinate);
      });
    },
    [onAddressSelect],
  );

  const camera: MapCameraTarget | undefined = value
    ? { center: value, zoom: ADDRESS_ZOOM }
    : openingFix
      ? { center: openingFix, zoom: DEVICE_ZOOM }
      : undefined;

  return (
    <MapView
      style={style}
      initialViewState={value ? { ...value, zoom: ADDRESS_ZOOM } : HOMIIO_OPENING_VIEW}
      camera={camera}
      onPress={handlePress}
      testID={testID}
    >
      <Markers data={markers} selectedId={PIN_ID} />
    </MapView>
  );
}
