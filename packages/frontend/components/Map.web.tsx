/**
 * Web implementation of the shared {@link Map} component.
 *
 * The native build (`Map.tsx`) renders MapLibre inside a `react-native-webview`
 * driven by the self-contained HTML document in `mapDocument.ts`. On the web we
 * skip the iframe/WebView + external-CDN + postMessage bridge entirely and drive
 * `maplibre-gl` **directly** against a real DOM `<div>`: it's the same GL engine,
 * but loaded from the bundle (keyless OpenFreeMap tiles, no unpkg, no sandbox).
 *
 * This file is resolved by Metro/Expo only for `Platform.OS === 'web'`, so the
 * `maplibre-gl` import never reaches the native bundle. The component preserves
 * the exact public surface of `Map.tsx` — identical {@link MapProps} and the
 * {@link MapApi} imperative ref — so every call site keeps working unchanged.
 */
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { View, type ViewStyle, Text } from 'react-native';
import * as maplibregl from 'maplibre-gl';
import type {
  GeoJSONSource,
  MapLayerMouseEvent,
  MapMouseEvent,
  MapOptions,
  Marker,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Point } from 'geojson';
import * as Location from 'expo-location';

import { useMapState } from '@/context/MapStateContext';
import { api, type ApiResponse } from '@/utils/api';
import {
  ATTRIBUTION,
  DEFAULT_STYLE_URL,
  PRICE_PILL_CLASS,
  PRICE_PILL_CSS,
  PRICE_PILL_SELECTED_CLASS,
} from './mapDocument';
import { colors } from '@/styles/colors';
import type {
  AddressData,
  ClusterLeaf,
  ClusterOptions,
  LonLat,
  MapApi,
  MarkerInput,
  MarkerStyle,
} from './mapTypes';

// Re-export the public map types so existing call sites can keep importing
// them from the component entry point (e.g. `import { MapApi } from '@/components/Map'`).
export type {
  AddressData,
  ClusterOptions,
  LonLat,
  MapApi,
  MarkerInput,
  MarkerStyle,
} from './mapTypes';

/** Convert [latitude, longitude] to GeoJSON [longitude, latitude]. */
export const latLngToLonLat = (lat: number, lng: number): LonLat => [lng, lat];

export interface MapProps {
  style?: ViewStyle | Record<string, unknown>;
  /** Initial map center coordinates in [longitude, latitude] format (GeoJSON standard).
   *  NOTE: This is [longitude, latitude], NOT [latitude, longitude]!
   *  Example: [2.2149101, 41.5425579] for Barcelona
   *  Use latLngToLonLat(lat, lng) helper if you have lat/lng format
   */
  initialCoordinates?: LonLat;
  initialZoom?: number;
  styleURL?: string;
  startFromCurrentLocation?: boolean;
  markers?: MarkerInput[];
  cluster?: ClusterOptions;
  markerStyle?: MarkerStyle;
  screenId?: string;
  enableAddressLookup?: boolean;
  showAddressInstructions?: boolean;
  onMapPress?: (e: { lngLat: LonLat }) => void;
  onAddressSelect?: (address: AddressData, coordinates: LonLat) => void;
  onAddressLookupStart?: () => void;
  onAddressLookupEnd?: () => void;
  onRegionChange?: (e: { center: LonLat; zoom: number; bearing: number; pitch: number; bounds: { west: number; south: number; east: number; north: number }; isFinal?: boolean }) => void;
  onMarkerPress?: (e: { id: string; lngLat: LonLat }) => void;
  onClusterPress?: (e: { leaves: ClusterLeaf[] }) => void;
}

const DEFAULT_CENTER: LonLat = [2.16538, 41.38723];
const DEFAULT_ZOOM = 12;

const SOURCE_ID = 'markers';
const CLUSTER_LAYER_ID = 'clusters';
const CLUSTER_COUNT_LAYER_ID = 'cluster-count';
const ADDRESS_MARKER_COLOR = '#007AFF';

/** Throttle window (ms) for streaming intermediate region updates while panning. */
const REGION_EMIT_THROTTLE_MS = 100;
/** Camera ease duration (ms) for `navigateToLocation`. */
const NAVIGATE_DURATION_MS = 500;
/** Lower zoom used when the device's location fix is coarse (> this accuracy, m). */
const COARSE_ACCURACY_M = 1000;
const COARSE_ZOOM = 10;
const FINE_ZOOM = 14;

/**
 * The forwardRef render function below is named `Map` (for a clean devtools
 * display name, matching `Map.tsx`), which shadows the global `Map` inside the
 * component scope. This module-scope alias + factory capture the JS built-in so
 * the per-marker bookkeeping map stays correctly typed and constructable.
 */
type MarkerMap = Map<string, Marker>;
const createMarkerMap = (): MarkerMap => new Map<string, Marker>();

// Address lookup function using backend API (Nominatim-backed, no API key).
const lookupAddressFromCoordinates = async (coordinates: LonLat): Promise<AddressData | null> => {
  try {
    const [longitude, latitude] = coordinates;
    const { data: result } = await api.get<ApiResponse<AddressData>>('/api/geocoding/reverse', {
      params: { longitude, latitude },
      requireAuth: false,
    });

    if (!result.success || !result.data) {
      return null;
    }

    return result.data;
  } catch {
    return null;
  }
};

/** Narrow a GeoJSON `Position` (number[]) to our `[lng, lat]` tuple. */
const toLonLat = (position: number[]): LonLat => [position[0] ?? 0, position[1] ?? 0];

/** Build the GeoJSON FeatureCollection the GL source consumes from marker inputs. */
const toFeatureCollection = (list: MarkerInput[]): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: list.map<Feature<Point>>((p) => ({
    type: 'Feature',
    id: p.id,
    geometry: { type: 'Point', coordinates: p.coordinates },
    properties: { id: String(p.id), price: String(p.priceLabel ?? '') },
  })),
});

/** Inject the shared price-pill stylesheet into <head> exactly once per document. */
const PILL_STYLE_ELEMENT_ID = 'homiio-map-pill-styles';
const ensurePillStyles = (): void => {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PILL_STYLE_ELEMENT_ID)) return;
  const styleEl = document.createElement('style');
  styleEl.id = PILL_STYLE_ELEMENT_ID;
  styleEl.textContent = PRICE_PILL_CSS;
  document.head.appendChild(styleEl);
};

const MapComponent = React.forwardRef<MapApi, MapProps>(function Map(props, ref) {
  const {
    style,
    initialCoordinates = DEFAULT_CENTER,
    initialZoom = DEFAULT_ZOOM,
    styleURL = DEFAULT_STYLE_URL,
    startFromCurrentLocation = true,
    markers = [],
    cluster,
    // The Airbnb-style pill uses a fixed palette baked into the shared
    // stylesheet (see mapTypes.ts: `chipBg`/`chipText` are deprecated no-ops),
    // so `markerStyle` is accepted for API parity but intentionally unused.
    markerStyle: _markerStyle,
    screenId,
    enableAddressLookup = false,
    showAddressInstructions = false,
    onMapPress,
    onAddressSelect,
    onAddressLookupStart: _onAddressLookupStart,
    onAddressLookupEnd: _onAddressLookupEnd,
    onRegionChange,
    onMarkerPress,
    onClusterPress,
  } = props;

  const { getMapState, setMapState } = useMapState();

  const [showInstructions, setShowInstructions] = useState(
    enableAddressLookup && showAddressInstructions,
  );

  // Get saved map state if screenId is provided.
  const savedState = screenId ? getMapState(screenId) : null;

  // Freeze the initial camera so re-renders never recreate the map.
  const initialCenterRef = useRef<LonLat>(savedState?.center ?? initialCoordinates);
  const initialZoomRef = useRef<number>(savedState?.zoom ?? initialZoom);

  const clusterFinal = useMemo<Required<ClusterOptions>>(() => ({
    enabled: cluster?.enabled ?? true,
    radius: cluster?.radius ?? 40,
    maxZoom: cluster?.maxZoom ?? 17,
    color: cluster?.color ?? colors.info,
    textColor: cluster?.textColor ?? colors.white,
  }), [cluster]);

  // Imperative handles to the live maplibre instance + per-marker DOM bubbles.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pillMarkersRef = useRef<MarkerMap>(createMarkerMap());
  const addressMarkerRef = useRef<Marker | null>(null);
  const highlightedIdRef = useRef<string | null>(null);
  const lastRegionEmitRef = useRef<number>(0);
  const loadedRef = useRef(false);

  // Keep the latest callbacks/markers in refs so the map's event listeners
  // (bound once at construction) always see current values without rebinding.
  const onMapPressRef = useRef(onMapPress);
  const onMarkerPressRef = useRef(onMarkerPress);
  const onClusterPressRef = useRef(onClusterPress);
  const onRegionChangeRef = useRef(onRegionChange);
  const onAddressSelectRef = useRef(onAddressSelect);
  const enableAddressLookupRef = useRef(enableAddressLookup);
  const screenIdRef = useRef(screenId);
  onMapPressRef.current = onMapPress;
  onMarkerPressRef.current = onMarkerPress;
  onClusterPressRef.current = onClusterPress;
  onRegionChangeRef.current = onRegionChange;
  onAddressSelectRef.current = onAddressSelect;
  enableAddressLookupRef.current = enableAddressLookup;
  screenIdRef.current = screenId;

  const setMapStateRef = useRef(setMapState);
  setMapStateRef.current = setMapState;

  // Mirror the latest markers/instructions into refs read by the construction
  // effect's listeners (the `load` and map-`click` handlers are bound once).
  const markersRef = useRef<MarkerInput[]>(markers);
  markersRef.current = markers;
  const showInstructionsRef = useRef(showInstructions);
  showInstructionsRef.current = showInstructions;

  // Reconcile DOM bubble markers against the source feature set: update existing
  // ones in place, add new ones, and reap markers that are gone — mirroring
  // `renderPillMarkers` in mapDocument.ts.
  const renderPillMarkers = useCallback((collection: FeatureCollection<Point>) => {
    const map = mapRef.current;
    if (!map) return;
    const pillMarkers = pillMarkersRef.current;
    const seen = new Set<string>();

    collection.features.forEach((feature) => {
      const id = String(feature.properties?.id ?? '');
      if (!id) return;
      seen.add(id);
      const coordinates = toLonLat(feature.geometry.coordinates);
      const price = String(feature.properties?.price ?? '');

      const existing = pillMarkers.get(id);
      if (existing) {
        existing.setLngLat(coordinates);
        const label = existing.getElement().firstChild;
        if (label instanceof HTMLElement && label.textContent !== price) {
          label.textContent = price;
        }
        return;
      }

      const wrapper = document.createElement('div');
      const pill = document.createElement('div');
      pill.className = PRICE_PILL_CLASS;
      pill.textContent = price;
      pill.addEventListener('click', (event) => {
        event.stopPropagation();
        onMarkerPressRef.current?.({ id, lngLat: coordinates });
      });
      wrapper.appendChild(pill);

      const marker = new maplibregl.Marker({ element: wrapper, anchor: 'center' })
        .setLngLat(coordinates)
        .addTo(map);
      pillMarkers.set(id, marker);
    });

    pillMarkers.forEach((marker, id) => {
      if (!seen.has(id)) {
        marker.remove();
        pillMarkers.delete(id);
      }
    });

    // Re-apply highlight if the highlighted id was removed and re-added.
    if (highlightedIdRef.current) {
      const target = pillMarkers.get(highlightedIdRef.current);
      const label = target?.getElement().firstChild;
      if (label instanceof HTMLElement) label.classList.add(PRICE_PILL_SELECTED_CLASS);
    }
  }, []);

  // Push a marker set into both the GL source (clusters) and the DOM bubbles.
  const setData = useCallback((features: MarkerInput[]) => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource<GeoJSONSource>(SOURCE_ID);
    if (!source) return;
    const collection = toFeatureCollection(features);
    source.setData(collection);
    renderPillMarkers(collection);
  }, [renderPillMarkers]);

  // Emit a region change, throttling the streaming (non-final) updates.
  const emitRegion = useCallback((isFinal: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    const now = Date.now();
    if (!isFinal && now - lastRegionEmitRef.current < REGION_EMIT_THROTTLE_MS) return;
    lastRegionEmitRef.current = now;

    const center = map.getCenter();
    const bounds = map.getBounds();
    const boundsPayload = {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    };
    const centerLonLat: LonLat = [center.lng, center.lat];

    if (screenIdRef.current) {
      setMapStateRef.current(screenIdRef.current, {
        center: centerLonLat,
        zoom: map.getZoom(),
        bounds: boundsPayload,
      });
    }

    onRegionChangeRef.current?.({
      center: centerLonLat,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      bounds: boundsPayload,
      isFinal,
    });
  }, []);

  // Construct the maplibre map once, against the real DOM container. The empty
  // dep array is the point: the instance is created a single time and lives for
  // the component's lifetime — live props are read through the refs above.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    // The pill-marker store is created once and never reassigned; capture it for
    // the cleanup so it doesn't read a possibly-changed ref at teardown time.
    const pillMarkers = pillMarkersRef.current;

    ensurePillStyles();

    const mapOptions: MapOptions = {
      container,
      style: styleURL,
      center: initialCenterRef.current,
      zoom: initialZoomRef.current,
      attributionControl: false,
    };
    const map = new maplibregl.Map(mapOptions);
    mapRef.current = map;

    map.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: ATTRIBUTION }),
    );

    const clusterEnabled = clusterFinal.enabled;

    map.on('load', () => {
      loadedRef.current = true;

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: toFeatureCollection([]),
        cluster: clusterEnabled,
        clusterRadius: clusterFinal.radius,
        clusterMaxZoom: clusterFinal.maxZoom,
        promoteId: 'id',
      });

      if (clusterEnabled) {
        map.addLayer({
          id: CLUSTER_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': clusterFinal.color,
            'circle-radius': ['step', ['get', 'point_count'], 16, 20, 18, 50, 22],
            'circle-stroke-color': colors.white,
            'circle-stroke-width': 2,
          },
        });
        map.addLayer({
          id: CLUSTER_COUNT_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 12,
          },
          paint: { 'text-color': clusterFinal.textColor },
        });

        map.on('click', CLUSTER_LAYER_ID, (event: MapLayerMouseEvent) => {
          const features = map.queryRenderedFeatures(event.point, { layers: [CLUSTER_LAYER_ID] });
          const feature = features[0];
          if (!feature) return;
          const clusterId = feature.properties?.cluster_id;
          const source = map.getSource<GeoJSONSource>(SOURCE_ID);
          if (typeof clusterId !== 'number' || !source) return;
          source.getClusterExpansionZoom(clusterId).then((zoom) => {
            const geometry = feature.geometry;
            if (geometry.type === 'Point') {
              map.easeTo({ center: toLonLat(geometry.coordinates), zoom });
            }
          }).catch(() => {
            // Cluster expansion is best-effort; ignore lookup failures.
          });

          const leaves: ClusterLeaf[] = features.map((f) => ({
            geometry: f.geometry.type === 'Point'
              ? { type: 'Point', coordinates: toLonLat(f.geometry.coordinates) }
              : undefined,
            properties: {
              id: String(f.properties?.id ?? ''),
              price: String(f.properties?.price ?? ''),
            },
          }));
          onClusterPressRef.current?.({ leaves });
        });

        map.on('mouseenter', CLUSTER_LAYER_ID, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', CLUSTER_LAYER_ID, () => {
          map.getCanvas().style.cursor = '';
        });
      }

      // Render any markers/state that arrived before `load` completed.
      const initialFeatures = savedState?.markers && savedState.markers.length > 0
        ? savedState.markers
        : markersRef.current;
      if (initialFeatures.length > 0) {
        const collection = toFeatureCollection(initialFeatures);
        map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(collection);
        renderPillMarkers(collection);
      }
    });

    map.on('click', (event: MapMouseEvent) => {
      const coordinates: LonLat = [event.lngLat.lng, event.lngLat.lat];

      if (enableAddressLookupRef.current && showInstructionsRef.current) {
        setShowInstructions(false);
      }
      onMapPressRef.current?.({ lngLat: coordinates });

      if (enableAddressLookupRef.current) {
        addressMarkerRef.current?.remove();
        addressMarkerRef.current = new maplibregl.Marker({ color: ADDRESS_MARKER_COLOR })
          .setLngLat(coordinates)
          .addTo(map);

        lookupAddressFromCoordinates(coordinates).then((address) => {
          if (address) onAddressSelectRef.current?.(address, coordinates);
        }).catch(() => {
          // Reverse geocoding is best-effort; ignore lookup failures.
        });
      }
    });

    const onMove = () => emitRegion(false);
    const onMoveEnd = () => emitRegion(true);
    (['move', 'zoom', 'rotate', 'pitch'] as const).forEach((ev) => map.on(ev, onMove));
    (['moveend', 'zoomend', 'rotateend', 'pitchend'] as const).forEach((ev) => map.on(ev, onMoveEnd));

    // Recompute size when the flex/grid parent resolves or resizes — the GL
    // canvas needs an explicit pixel size and the container starts at 0×0 until
    // RN-Web layout settles.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      pillMarkers.forEach((marker) => marker.remove());
      pillMarkers.clear();
      addressMarkerRef.current?.remove();
      addressMarkerRef.current = null;
      loadedRef.current = false;
      mapRef.current = null;
      map.remove();
    };
    // The map is intentionally created once; live values flow through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stream marker updates to the live map.
  useEffect(() => {
    setData(markers);
  }, [markers, setData]);

  // Persist markers to shared state for cross-screen restoration.
  useEffect(() => {
    if (!screenId || markers.length === 0) return;
    const current = getMapState(screenId);
    const currentMarkers = current?.markers ?? [];
    const changed = markers.length !== currentMarkers.length ||
      markers.some((marker, index) => {
        const prev = currentMarkers[index];
        return !prev ||
          marker.id !== prev.id ||
          marker.coordinates[0] !== prev.coordinates[0] ||
          marker.coordinates[1] !== prev.coordinates[1] ||
          marker.priceLabel !== prev.priceLabel;
      });
    if (changed) setMapState(screenId, { markers });
  }, [markers, screenId, getMapState, setMapState]);

  // Keep instructions visibility in sync with the address-lookup props.
  useEffect(() => {
    setShowInstructions(showAddressInstructions && enableAddressLookup);
  }, [showAddressInstructions, enableAddressLookup]);

  // Center on the device location once, only when no explicit initial center
  // and no restored state were provided (mirrors the native behaviour).
  const hasCenteredOnce = useRef(false);
  useEffect(() => {
    if (!startFromCurrentLocation || hasCenteredOnce.current || savedState) return;

    const hasSpecificInitialCoords =
      initialCoordinates[0] !== DEFAULT_CENTER[0] ||
      initialCoordinates[1] !== DEFAULT_CENTER[1];
    if (hasSpecificInitialCoords) return;

    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 10,
        });
        if (cancelled || hasCenteredOnce.current) return;
        const map = mapRef.current;
        if (!map) return;
        const accuracy = loc.coords.accuracy ?? null;
        const zoom = accuracy && accuracy > COARSE_ACCURACY_M
          ? Math.max(initialZoom, COARSE_ZOOM)
          : Math.max(initialZoom, FINE_ZOOM);
        map.easeTo({
          center: [loc.coords.longitude, loc.coords.latitude],
          zoom,
        });
        hasCenteredOnce.current = true;
      } catch {
        // Location is best-effort; the map keeps its initial camera.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [startFromCurrentLocation, savedState, initialCoordinates, initialZoom]);

  // Expose the imperative MapApi — identical to the native component.
  useImperativeHandle(ref, () => ({
    navigateToLocation: (center: LonLat, zoom: number = 15) => {
      mapRef.current?.easeTo({ center, zoom, duration: NAVIGATE_DURATION_MS });
    },
    highlightMarker: (id: string | null) => {
      const pillMarkers = pillMarkersRef.current;
      if (highlightedIdRef.current) {
        const prevLabel = pillMarkers.get(highlightedIdRef.current)?.getElement().firstChild;
        if (prevLabel instanceof HTMLElement) {
          prevLabel.classList.remove(PRICE_PILL_SELECTED_CLASS);
        }
      }
      if (id) {
        const nextLabel = pillMarkers.get(String(id))?.getElement().firstChild;
        if (nextLabel instanceof HTMLElement) {
          nextLabel.classList.add(PRICE_PILL_SELECTED_CLASS);
        }
        highlightedIdRef.current = String(id);
      } else {
        highlightedIdRef.current = null;
      }
    },
    lookupAddress: async (coordinates: LonLat) => lookupAddressFromCoordinates(coordinates),
  }), []);

  return (
    <View style={[rootStyle, style]}>
      {showInstructions && enableAddressLookup && (
        <View style={addressInstructionStyles.overlay}>
          <Text style={addressInstructionStyles.text}>
            Tap on the map to select a location
          </Text>
        </View>
      )}
      <div ref={containerRef} style={mapDivStyle} />
    </View>
  );
});

// Optimized memoization with custom comparison (mirrors Map.tsx exactly so the
// two platforms share identical re-render semantics). Named distinctly from the
// global `Map` so the marker-bookkeeping `Map<string, Marker>` resolves to the
// JS built-in rather than this component value.
const MemoizedMap = React.memo(MapComponent, (prevProps, nextProps) => {
  if (nextProps.screenId === 'create-property' || nextProps.screenId === 'create-property-fullscreen') {
    return (
      prevProps.screenId === nextProps.screenId &&
      prevProps.enableAddressLookup === nextProps.enableAddressLookup &&
      prevProps.showAddressInstructions === nextProps.showAddressInstructions &&
      prevProps.styleURL === nextProps.styleURL &&
      prevProps.initialZoom === nextProps.initialZoom &&
      prevProps.startFromCurrentLocation === nextProps.startFromCurrentLocation &&
      JSON.stringify(prevProps.markers) === JSON.stringify(nextProps.markers) &&
      JSON.stringify(prevProps.cluster) === JSON.stringify(nextProps.cluster) &&
      JSON.stringify(prevProps.markerStyle) === JSON.stringify(nextProps.markerStyle) &&
      JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style)
    );
  }

  if (nextProps.screenId === 'search' || nextProps.screenId === 'search-screen') {
    return (
      prevProps.screenId === nextProps.screenId &&
      prevProps.styleURL === nextProps.styleURL &&
      prevProps.initialZoom === nextProps.initialZoom &&
      prevProps.startFromCurrentLocation === nextProps.startFromCurrentLocation &&
      JSON.stringify(prevProps.cluster) === JSON.stringify(nextProps.cluster) &&
      JSON.stringify(prevProps.markerStyle) === JSON.stringify(nextProps.markerStyle) &&
      JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style) &&
      prevProps.onMapPress === nextProps.onMapPress &&
      prevProps.onMarkerPress === nextProps.onMarkerPress &&
      prevProps.onRegionChange === nextProps.onRegionChange
    );
  }

  return false;
});

// A flex:1, positioned, clipped wrapper so the absolutely-filled map <div>
// always resolves a real pixel box from its parent (explicit-height callers
// like the property detail, or absoluteFill panels like search results).
const rootStyle: ViewStyle = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
};

// DOM CSS for the maplibre container: fill the RN-Web wrapper exactly.
const mapDivStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: '100%',
  height: '100%',
};

// Styles for address instructions overlay (matches Map.tsx).
const addressInstructionStyles = {
  overlay: {
    position: 'absolute' as const,
    top: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    zIndex: 1000,
  },
  text: {
    color: colors.white,
    fontSize: 14,
    textAlign: 'center' as const,
    fontWeight: '500' as const,
  },
};

export default MemoizedMap;
