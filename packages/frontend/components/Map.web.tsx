/**
 * Web implementation of the shared {@link Map} component.
 *
 * The native build (`Map.tsx`) renders MapLibre inside a `react-native-webview`
 * driven by the self-contained HTML document in `mapDocument.ts`. On the web we
 * skip the iframe/WebView + external-CDN + postMessage bridge entirely and drive
 * `maplibre-gl` **directly** against a real DOM `<div>`: it's the same GL engine,
 * but loaded from the bundle (keyless OpenFreeMap tiles, no unpkg, no sandbox).
 * Its worker is the one file the bundle cannot carry — see {@link WORKER_URL}.
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
import { createPortal } from 'react-dom';
import { View, type ViewStyle, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as maplibregl from 'maplibre-gl';
import type {
  GeoJSONSource,
  MapMouseEvent,
  MapOptions,
  Marker,
  StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Point } from 'geojson';
import * as Location from 'expo-location';
import { MapClusterMarker, MapPriceMarker } from '@oxy.so/bloom/map-marker';

import { useMapState } from '@/context/MapStateContext';
import { boundsCenter } from '@homiio/shared-types';
import { isDegenerateBounds, toCameraBounds } from './mapCamera';
import { api, type ApiResponse } from '@/utils/api';
import { ATTRIBUTION } from './mapDocument';
import {
  clusterOverlayState,
  collectOverlays,
  overlaySignature,
  pointOverlayState,
  type OverlayItem,
} from './mapOverlays';
import {
  DEFAULT_STYLE_URL,
  fetchSanitizedMapStyle,
  installMissingImageFallback,
} from './mapStyle';
import { colors } from '@/styles/colors';
import { PROGRAMMATIC_MOVE, moveSourceOf } from './mapTypes';
import type {
  GeocodedAddress,
  ClusterLeaf,
  ClusterOptions,
  LonLat,
  MapApi,
  MapMoveSource,
  MarkerInput,
} from './mapTypes';

// Re-export the public map types so existing call sites can keep importing
// them from the component entry point (e.g. `import { MapApi } from '@/components/Map'`).
export type {
  GeocodedAddress,
  ClusterOptions,
  LonLat,
  MapApi,
  MarkerInput,
} from './mapTypes';

/**
 * Where MapLibre's worker is served from, on this origin.
 *
 * maplibre-gl 6 is ESM-only and starts its worker BY URL, derived from
 * `import.meta.url` — which inside a Metro bundle is not the package's
 * directory, so without this the worker never starts and no tile ever renders.
 * `scripts/vendor-maplibre-worker.js` (run from `metro.config.js`) copies the
 * worker modules of the installed package to exactly this path, and keying it
 * on `getVersion()` keeps the worker and this bundle on the same release.
 */
const WORKER_URL = `/vendor/maplibre-gl/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`;
if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl(new URL(WORKER_URL, window.location.origin).href);
}

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
  screenId?: string;
  enableAddressLookup?: boolean;
  showAddressInstructions?: boolean;
  onMapPress?: (e: { lngLat: LonLat }) => void;
  onAddressSelect?: (address: GeocodedAddress, coordinates: LonLat) => void;
  onAddressLookupStart?: () => void;
  onAddressLookupEnd?: () => void;
  onRegionChange?: (e: { center: LonLat; zoom: number; bearing: number; pitch: number; bounds: { west: number; south: number; east: number; north: number }; isFinal?: boolean; source: MapMoveSource }) => void;
  onMarkerPress?: (e: { id: string; lngLat: LonLat }) => void;
  onClusterPress?: (e: { leaves: ClusterLeaf[] }) => void;
}

const DEFAULT_CENTER: LonLat = [2.16538, 41.38723];
const DEFAULT_ZOOM = 12;

const SOURCE_ID = 'markers';
/**
 * An invisible layer over the marker source. It draws nothing — the pills and
 * cluster bubbles are Bloom components in DOM markers — but MapLibre only loads
 * the tiles of a source some layer uses, and `querySourceFeatures` reads those
 * tiles, so without it there would be no features to draw from.
 */
const SOURCE_ANCHOR_LAYER_ID = 'markers-anchor';
const ADDRESS_MARKER_COLOR = '#007AFF';

/** Throttle window (ms) for streaming intermediate region updates while panning. */
const REGION_EMIT_THROTTLE_MS = 100;
/** Camera ease duration (ms) for `navigateToLocation`. */
/**
 * Zoom used when a box is degenerate and there is nothing to fit.
 *
 * City-ish rather than street-level: the caller asked to frame an AREA, so
 * dropping to the max zoom a zero-area fit would produce is the one answer that
 * is certainly wrong.
 */
const DEGENERATE_BOUNDS_ZOOM = 12;

/** Padding, in px, around a fitted box so markers are not flush to the edge. */
const FIT_BOUNDS_PADDING = 48;

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
interface OverlayMarker {
  marker: Marker;
  element: HTMLDivElement;
}
type OverlayMarkerMap = Map<string, OverlayMarker>;
const createOverlayMarkerMap = (): OverlayMarkerMap => new Map<string, OverlayMarker>();
type MarkerInputMap = Map<string, MarkerInput>;
const createMarkerInputMap = (list: readonly MarkerInput[]): MarkerInputMap =>
  new Map<string, MarkerInput>(list.map((marker) => [String(marker.id), marker]));
type ClusterLeafCache = Map<number, readonly string[]>;
const createClusterLeafCache = (): ClusterLeafCache => new Map<number, readonly string[]>();

// Address lookup function using backend API (Nominatim-backed, no API key).
const lookupAddressFromCoordinates = async (coordinates: LonLat): Promise<GeocodedAddress | null> => {
  try {
    const [longitude, latitude] = coordinates;
    const { data: result } = await api.get<ApiResponse<GeocodedAddress>>('/api/geocoding/reverse', {
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

const MapComponent = React.forwardRef<MapApi, MapProps>(function Map(props, ref) {
  const {
    style,
    initialCoordinates = DEFAULT_CENTER,
    initialZoom = DEFAULT_ZOOM,
    styleURL = DEFAULT_STYLE_URL,
    startFromCurrentLocation = true,
    markers = [],
    cluster,
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
  const { t } = useTranslation();

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
  }), [cluster]);

  // Imperative handles to the live maplibre instance + per-marker DOM bubbles.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayMarkersRef = useRef<OverlayMarkerMap>(createOverlayMarkerMap());
  /** The published marker inputs by id — the only source of a pin's position. */
  const markerInputsRef = useRef<MarkerInputMap>(createMarkerInputMap([]));
  /** Resolved cluster members, keyed by cluster id; reset with every data set. */
  const clusterLeavesRef = useRef<ClusterLeafCache>(createClusterLeafCache());
  const overlaySignatureRef = useRef('');
  const addressMarkerRef = useRef<Marker | null>(null);
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

  /**
   * The markers drawn over the canvas: one Bloom pill per unclustered point and
   * one Bloom bubble per cluster, each mounted (by portal, below) into the DOM
   * node of a MapLibre `Marker`.
   *
   * `highlightedId` is the one the results list or a pin press highlighted;
   * `visitedIds` are the pins pressed before in this map's lifetime, drawn
   * muted so the reader can see what they have already looked at.
   */
  const [overlays, setOverlays] = useState<OverlayItem<HTMLDivElement>[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set<string>());

  /**
   * Re-read the source and reconcile the DOM markers with it.
   *
   * Runs on every rendered frame, because clusters split and merge as the zoom
   * crosses a level and there is no event for that. It is cheap — a search page
   * is a few dozen features — and React only hears about it when the drawn set
   * actually changed (`overlaySignature`).
   */
  const syncOverlays = useCallback(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource<GeoJSONSource>(SOURCE_ID);
    if (!source) return;

    const descriptors = collectOverlays(
      map.querySourceFeatures(SOURCE_ID),
      markerInputsRef.current,
    );
    const overlayMarkers = overlayMarkersRef.current;
    const leafCache = clusterLeavesRef.current;
    const seen = new Set<string>();

    const items = descriptors.map<OverlayItem<HTMLDivElement>>((descriptor) => {
      seen.add(descriptor.key);
      let entry = overlayMarkers.get(descriptor.key);
      if (entry) {
        entry.marker.setLngLat(descriptor.coordinates);
      } else {
        const element = document.createElement('div');
        // A press on a pill is not a press on the map beneath it.
        element.addEventListener('click', (event) => event.stopPropagation());
        const marker = new maplibregl.Marker({ element, anchor: 'center' })
          .setLngLat(descriptor.coordinates)
          .addTo(map);
        entry = { marker, element };
        overlayMarkers.set(descriptor.key, entry);
      }

      if (descriptor.kind === 'point') {
        return { ...descriptor, element: entry.element, leafIds: null };
      }
      const leafIds = leafCache.get(descriptor.clusterId) ?? null;
      if (!leafIds) {
        const { clusterId } = descriptor;
        source
          .getClusterLeaves(clusterId, Infinity, 0)
          .then((leaves) => {
            // A data set replaced while this resolved has its own cache.
            if (clusterLeavesRef.current !== leafCache) return;
            leafCache.set(
              clusterId,
              leaves.map((leaf) => String(leaf.properties?.id ?? '')),
            );
            syncOverlaysRef.current();
          })
          .catch(() => {
            // Cluster ids go stale when the zoom changes; the next frame asks again.
          });
      }
      return { ...descriptor, element: entry.element, leafIds };
    });

    overlayMarkers.forEach((entry, key) => {
      if (!seen.has(key)) {
        entry.marker.remove();
        overlayMarkers.delete(key);
      }
    });

    const signature = overlaySignature(items);
    if (signature !== overlaySignatureRef.current) {
      overlaySignatureRef.current = signature;
      setOverlays(items);
    }
  }, []);
  const syncOverlaysRef = useRef(syncOverlays);
  syncOverlaysRef.current = syncOverlays;

  // Push a marker set into the clustered GL source; the frame it renders
  // re-reads the source and redraws the pills.
  const setData = useCallback((features: MarkerInput[]) => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource<GeoJSONSource>(SOURCE_ID);
    if (!source) return;
    markerInputsRef.current = createMarkerInputMap(features);
    clusterLeavesRef.current = createClusterLeafCache();
    source.setData(toFeatureCollection(features));
  }, []);

  // Emit a region change, throttling the streaming (non-final) updates.
  //
  // `event` is the MapLibre event that caused the move, taken as `unknown`
  // because the only thing read off it is the marker every camera command in
  // this file attaches — see `PROGRAMMATIC_MOVE`.
  const emitRegion = useCallback((isFinal: boolean, event?: unknown) => {
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
      source: moveSourceOf(event),
    });
  }, []);

  // Construct the maplibre map once, against the real DOM container. The empty
  // dep array is the point: the instance is created a single time and lives for
  // the component's lifetime — live props are read through the refs above.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    // The overlay-marker store is created once and never reassigned; capture it
    // for the cleanup so it doesn't read a possibly-changed ref at teardown time.
    const overlayMarkers = overlayMarkersRef.current;

    // The OpenFreeMap liberty style ships layer filters that throw on
    // null-numeric tile properties. Construct against the HARDENED style object
    // (sanitizeMapStyle) so no tile parse can throw; if the fetch fails, fall
    // back to the bare URL — the map must always render.
    let map: maplibregl.Map | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;

    const buildMap = (style: string | StyleSpecification) => {
      if (disposed || !containerRef.current || mapRef.current) return;
      const mapOptions: MapOptions = {
        container,
        style,
        center: initialCenterRef.current,
        zoom: initialZoomRef.current,
        attributionControl: false,
      };
      map = new maplibregl.Map(mapOptions);
      mapRef.current = map;

      // Supply a transparent placeholder for any sprite the style references but
      // doesn't ship (the liberty 'poi_*' layers request class names like
      // 'office' that aren't in the sprite) — silences the missing-image error.
      installMissingImageFallback(map);

      map.addControl(
        new maplibregl.AttributionControl({ compact: true, customAttribution: ATTRIBUTION }),
      );

      wireMap(map);
    };

    const wireMap = (map: maplibregl.Map) => {
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

        map.addLayer({
          id: SOURCE_ANCHOR_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          paint: { 'circle-radius': 0, 'circle-opacity': 0, 'circle-stroke-width': 0 },
        });

        // Render any markers/state that arrived before `load` completed.
        const initialFeatures = savedState?.markers && savedState.markers.length > 0
          ? savedState.markers
          : markersRef.current;
        setData(initialFeatures);
      });

      map.on('render', () => syncOverlaysRef.current());

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

      const onMove = (event: unknown) => emitRegion(false, event);
      const onMoveEnd = (event: unknown) => emitRegion(true, event);
      (['move', 'zoom', 'rotate', 'pitch'] as const).forEach((ev) => map.on(ev, onMove));
      (['moveend', 'zoomend', 'rotateend', 'pitchend'] as const).forEach((ev) => map.on(ev, onMoveEnd));

      // Recompute size when the flex/grid parent resolves or resizes — the GL
      // canvas needs an explicit pixel size and the container starts at 0×0 until
      // RN-Web layout settles.
      //
      // `resize` FIRES `movestart`/`move`/`moveend`, so it must be marked like
      // any other camera command: the first one lands as the split layout
      // settles, which is exactly the "a programmatic initial move must not show
      // the button" case.
      resizeObserver = new ResizeObserver(() => map.resize(PROGRAMMATIC_MOVE));
      resizeObserver.observe(container);
    };

    // Fetch + harden the style, then build. On failure, build against the raw
    // URL so the map still renders (worst case: the original noisy log returns).
    fetchSanitizedMapStyle(styleURL)
      .then((style) => buildMap(style))
      .catch(() => buildMap(styleURL));

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      overlayMarkers.forEach((entry) => entry.marker.remove());
      overlayMarkers.clear();
      addressMarkerRef.current?.remove();
      addressMarkerRef.current = null;
      loadedRef.current = false;
      mapRef.current = null;
      map?.remove();
      map = null;
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
        map.easeTo(
          { center: [loc.coords.longitude, loc.coords.latitude], zoom },
          PROGRAMMATIC_MOVE,
        );
        hasCenteredOnce.current = true;
      } catch {
        // Location is best-effort; the map keeps its initial camera.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [startFromCurrentLocation, savedState, initialCoordinates, initialZoom]);

  const handlePointPress = useCallback((id: string, coordinates: LonLat) => {
    setVisitedIds((previous) => {
      if (previous.has(id)) return previous;
      const next = new Set(previous);
      next.add(id);
      return next;
    });
    onMarkerPressRef.current?.({ id, lngLat: coordinates });
  }, []);

  const handleClusterPress = useCallback((clusterId: number, coordinates: LonLat) => {
    const map = mapRef.current;
    const source = map?.getSource<GeoJSONSource>(SOURCE_ID);
    if (!map || !source) return;
    source.getClusterExpansionZoom(clusterId).then((zoom) => {
      // Expanding a cluster is a press on a cluster, not a statement about
      // which area to search — so it must not arm the button.
      map.easeTo({ center: coordinates, zoom }, PROGRAMMATIC_MOVE);
    }).catch(() => {
      // Cluster expansion is best-effort; ignore lookup failures.
    });

    if (!onClusterPressRef.current) return;
    source.getClusterLeaves(clusterId, Infinity, 0).then((features) => {
      const inputs = markerInputsRef.current;
      const leaves = features.flatMap<ClusterLeaf>((feature) => {
        const input = inputs.get(String(feature.properties?.id ?? ''));
        // Positions come from the published input, never the tile geometry.
        return input
          ? [{
              geometry: { type: 'Point', coordinates: input.coordinates },
              properties: { id: String(input.id), price: input.priceLabel },
            }]
          : [];
      });
      onClusterPressRef.current?.({ leaves });
    }).catch(() => {
      // Stale cluster id after a zoom; nothing to report.
    });
  }, []);

  // Raise the highlighted pill (or the cluster holding it) above its
  // neighbours, which Bloom leaves to the app that positions it.
  useEffect(() => {
    overlays.forEach((item) => {
      const active = item.kind === 'point'
        ? item.id === highlightedId
        : clusterOverlayState(item.leafIds, highlightedId) === 'active';
      item.element.style.zIndex = active ? '2' : '';
    });
  }, [overlays, highlightedId]);

  // Expose the imperative MapApi — identical to the native component.
  useImperativeHandle(ref, () => ({
    navigateToLocation: (center: LonLat, zoom: number = 15) => {
      mapRef.current?.easeTo({ center, zoom, duration: NAVIGATE_DURATION_MS }, PROGRAMMATIC_MOVE);
    },
    fitBounds: (bounds, options) => {
      const map = mapRef.current;
      if (!map) return;
      // See `Map.tsx` — the same two decisions, taken from the same helpers, so
      // the two platforms cannot drift on either the wrap or the degenerate box.
      if (isDegenerateBounds(bounds)) {
        const centre = boundsCenter(bounds);
        map.easeTo(
          {
            center: [centre.longitude, centre.latitude],
            zoom: DEGENERATE_BOUNDS_ZOOM,
            duration: options?.duration ?? NAVIGATE_DURATION_MS,
          },
          PROGRAMMATIC_MOVE,
        );
        return;
      }
      map.fitBounds(
        toCameraBounds(bounds),
        {
          padding: options?.padding ?? FIT_BOUNDS_PADDING,
          duration: options?.duration ?? NAVIGATE_DURATION_MS,
        },
        PROGRAMMATIC_MOVE,
      );
    },
    highlightMarker: (id: string | null) => {
      setHighlightedId(id ? String(id) : null);
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
      {overlays.map((item) =>
        createPortal(
          item.kind === 'point' ? (
            <MapPriceMarker
              price={item.price}
              state={pointOverlayState(item.id, highlightedId, visitedIds)}
              onPress={() => handlePointPress(item.id, item.coordinates)}
              testID={`map-marker-${item.id}`}
            />
          ) : (
            <MapClusterMarker
              count={item.count}
              state={clusterOverlayState(item.leafIds, highlightedId)}
              onPress={() => handleClusterPress(item.clusterId, item.coordinates)}
              accessibilityLabel={t('map.clusterLabel', { count: item.count })}
              testID={`map-cluster-${item.clusterId}`}
            />
          ),
          item.element,
          item.key,
        ),
      )}
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
