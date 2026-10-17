/**
 * The explore map: the results as Bloom price pins, clustered, with the
 * selected result — or the card under the pointer — drawn active and never
 * folded into a cluster.
 *
 * The hovered card is read here, from the store, so a hover re-renders this
 * map and not the list beside it.
 */
import { useCallback, type Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  DefaultMapMarker,
  MapView,
  Markers,
  type MapCameraChange,
  type MapCameraTarget,
  type MapInitialViewState,
  type MapMarkerData,
  type MapMarkerItem,
  type MapViewRef,
} from '@goway.to/maps';
import { MapClusterMarker } from '@oxy.so/bloom/map-marker';

import { useExploreViewStore } from '@/store/exploreViewStore';

export interface ResultsMapProps {
  ref?: Ref<MapViewRef>;
  markers: readonly MapMarkerData[];
  /** The result the reader picked (a pin or a card). */
  selectedId: string | null;
  initialViewState?: MapInitialViewState;
  camera?: MapCameraTarget;
  onCameraChanged: (change: MapCameraChange) => void;
  onMarkerPress: (marker: MapMarkerData) => void;
  style?: StyleProp<ViewStyle>;
}

export function ResultsMap({
  ref,
  markers,
  selectedId,
  initialViewState,
  camera,
  onCameraChanged,
  onMarkerPress,
  style,
}: ResultsMapProps) {
  const { t } = useTranslation();
  const hoveredId = useExploreViewStore((s) => s.hoveredResultId);

  // The default pins, with the cluster bubble read out in the reader's language.
  const renderMarker = useCallback(
    (item: MapMarkerItem, press: () => void) =>
      item.kind === 'cluster' ? (
        <MapClusterMarker
          count={item.cluster.count}
          state={item.state}
          onPress={press}
          accessibilityLabel={t('map.clusterLabel', { count: item.cluster.count })}
          testID={`map-cluster-${item.cluster.id}`}
        />
      ) : (
        <DefaultMapMarker item={item} onPress={press} />
      ),
    [t],
  );

  return (
    <MapView
      ref={ref}
      style={style}
      initialViewState={initialViewState}
      camera={camera}
      onCameraChanged={onCameraChanged}
    >
      <Markers
        data={markers}
        selectedId={hoveredId ?? selectedId}
        cluster
        onPress={onMarkerPress}
        renderMarker={renderMarker}
      />
    </MapView>
  );
}
