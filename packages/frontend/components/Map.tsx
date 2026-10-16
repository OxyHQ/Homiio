import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { View, type ViewStyle, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { StyleSpecification } from 'maplibre-gl';
import * as Location from 'expo-location';
import { useMapState } from '@/context/MapStateContext';
import { api, type ApiResponse } from '@/utils/api';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@oxy.so/bloom/theme';
import {
  CLUSTER_COUNT_TOKEN,
  MAP_DOCUMENT_BASE_URL,
  buildMapDocument,
  resolveMapMarkerPaint,
} from './mapDocument';
import { boundsCenter } from '@homiio/shared-types';
import { isDegenerateBounds, toCameraBounds } from './mapCamera';
import { DEFAULT_STYLE_URL, fetchSanitizedMapStyle } from './mapStyle';
import { colors } from '@/styles/colors';
import type {
  GeocodedAddress,
  ClusterLeaf,
  ClusterOptions,
  LonLat,
  MapApi,
  MapEvent,
  MapMoveSource,
  MarkerInput,
  OutboundMapMessage,
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
  onRegionChange?: (e: {
    center: LonLat;
    zoom: number;
    bearing: number;
    pitch: number;
    bounds: { west: number; south: number; east: number; north: number };
    isFinal?: boolean;
    source: MapMoveSource;
  }) => void;
  onMarkerPress?: (e: { id: string; lngLat: LonLat }) => void;
  onClusterPress?: (e: { leaves: ClusterLeaf[] }) => void;
}

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

/** Camera animation for a fit, matching `navigateToLocation`'s ease. */
const FIT_BOUNDS_DURATION_MS = 500;

const DEFAULT_CENTER: LonLat = [2.16538, 41.38723];
const DEFAULT_ZOOM = 12;

// Address lookup function using backend API (Nominatim-backed, no API key).
const lookupAddressFromCoordinates = async (
  coordinates: LonLat,
): Promise<GeocodedAddress | null> => {
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

  // The hint shows while address lookup asks for it, until the first tap on the
  // map dismisses it. Turning either prop off and on again brings it back.
  const [instructionsDismissed, setInstructionsDismissed] = useState(false);
  const instructionsKey = `${enableAddressLookup}|${showAddressInstructions}`;
  const [prevInstructionsKey, setPrevInstructionsKey] = useState(instructionsKey);
  if (instructionsKey !== prevInstructionsKey) {
    setPrevInstructionsKey(instructionsKey);
    setInstructionsDismissed(false);
  }
  const showInstructions = enableAddressLookup && showAddressInstructions && !instructionsDismissed;

  /**
   * Messages sent before the document has said `ready` wait here. Readiness is
   * a ref, written by the `ready` message and the WebView's detach, because it
   * gates the bridge — not anything drawn.
   */
  const pending = useRef<string[]>([]);
  const readyRef = useRef(false);
  const hasCenteredOnce = useRef(false);

  // The OpenFreeMap liberty style ships layer filters that throw on null-numeric
  // tile properties (`Expected value to be of type number, but found null`). We
  // fetch + harden it (sanitizeMapStyle) once per URL and feed the WebView
  // document the patched style OBJECT, so the WebView builds the map ONCE
  // against the hardened style (no reload). The WebView mounts once the query
  // settles; on failure it settles to the raw URL so the map always renders
  // (worst case: the original noisy log returns, but it's the same map).
  const styleQuery = useQuery<string | StyleSpecification>({
    queryKey: ['mapStyle', styleURL],
    queryFn: () => fetchSanitizedMapStyle(styleURL).catch(() => styleURL),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const styleSettled = !styleQuery.isPending;
  const resolvedStyle = styleQuery.data ?? styleURL;

  // Get saved map state if screenId is provided
  const savedState = screenId ? getMapState(screenId) : null;

  // Freeze initial center/zoom for HTML to prevent iframe reloads
  const initialCenterRef = useRef<LonLat>(savedState?.center || initialCoordinates);
  const initialZoomRef = useRef<number>(savedState?.zoom || initialZoom);

  // Memoize cluster configuration
  const clusterFinal = useMemo<Required<ClusterOptions>>(
    () => ({
      enabled: cluster?.enabled ?? true,
      radius: cluster?.radius ?? 40,
      maxZoom: cluster?.maxZoom ?? 17,
    }),
    [cluster],
  );

  // The document draws Bloom's marker geometry in CSS; its colours come from the
  // Bloom theme. The document opens with the paint of its first render and a
  // theme change is sent as `setPaint`, so switching theme does not reload the
  // map.
  const theme = useTheme();
  const paint = useMemo(() => resolveMapMarkerPaint(theme), [theme]);
  const initialPaintRef = useRef(paint);
  const { t } = useTranslation();
  const clusterLabel = t('map.clusterLabel', { count: CLUSTER_COUNT_TOKEN });

  // Generate HTML once with frozen initial coordinates to prevent iframe reloads
  const html = useMemo(
    () =>
      buildMapDocument({
        center: initialCenterRef.current,
        zoom: initialZoomRef.current,
        style: resolvedStyle,
        cluster: clusterFinal,
        paint: initialPaintRef.current,
        clusterLabel,
        enableAddressLookup,
      }),
    [resolvedStyle, clusterFinal, enableAddressLookup, clusterLabel],
  );

  const webviewRef = useRef<WebView | null>(null);

  const reallyPost = useCallback((str: string) => {
    webviewRef.current?.postMessage?.(str);
    webviewRef.current?.injectJavaScript?.(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(str)}})); true;`,
    );
  }, []);

  const post = useCallback(
    (payload: OutboundMapMessage) => {
      const str = JSON.stringify(payload);
      if (readyRef.current) {
        reallyPost(str);
      } else {
        pending.current.push(str);
      }
    },
    [reallyPost],
  );

  /**
   * The WebView IS the map instance, so its attach/detach is the map's
   * lifecycle: on detach the document is gone, and a new one (a new style URL
   * remounts it) must say `ready` again before anything is posted to it.
   */
  const attachWebView = useCallback((view: WebView | null) => {
    webviewRef.current = view;
    return () => {
      webviewRef.current = null;
      readyRef.current = false;
    };
  }, []);

  /*
   * The two effects left in this file push PROPS into the WebView document.
   * The document is an imperative MapLibre instance behind a postMessage
   * bridge: there is no declarative binding for its source data or its paint,
   * and no event in this component coincides with a new marker set or a theme
   * change — both simply arrive on a re-render. A native map component with
   * declarative `markers` / paint props (a MapLibre React Native map rather than
   * a WebView document) is what would retire them. `post` queues until the
   * document is ready, so neither has to wait for readiness itself.
   */
  useEffect(() => {
    if (paint === initialPaintRef.current) return;
    post({ type: 'setPaint', paint });
  }, [paint, post]);

  // The marker set drawn is also the one kept for this screen's next mount.
  useEffect(() => {
    post({ type: 'setData', features: markers });
    if (screenId && markers.length > 0) setMapState(screenId, { markers });
  }, [markers, post, screenId, setMapState]);

  /**
   * The user's own position, ONLY when permission has already been granted.
   *
   * This used to call `requestForegroundPermissionsAsync` in an effect, which
   * meant opening Explore without initial coordinates showed the OS location
   * prompt — a prompt nobody asked for, on a screen whose job is to show homes.
   * Both #518 and #519 name this exact call site ("Suprimir los permisos
   * solicitados por montaje"; "No hay permisos solicitados automáticamente
   * desde Home, mapa u otros montajes de descubrimiento").
   *
   * It now READS the permission and stops when it is not granted. Asking is a
   * separate, explicit action the user takes ("use my location" in the search
   * bar's panel), routed through `useLocationScope` — the one place in the app
   * allowed to prompt. It runs when the document reports `ready`, the moment
   * there is a map to show the position on.
   */
  const showDevicePosition = async () => {
    if (!startFromCurrentLocation) return;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;

      // Get location with high accuracy and fresh data
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 10000,
        distanceInterval: 10,
      });
      const userCoord: LonLat = [loc.coords.longitude, loc.coords.latitude];
      const locationAccuracy = loc.coords.accuracy || null;

      post({ type: 'setUserLocation', coordinates: userCoord });

      // Only auto-center on user location if no specific initialCoordinates were provided
      const hasSpecificInitialCoords =
        initialCoordinates !== DEFAULT_CENTER &&
        (initialCoordinates[0] !== DEFAULT_CENTER[0] ||
          initialCoordinates[1] !== DEFAULT_CENTER[1]);

      if (!hasCenteredOnce.current && !savedState && !hasSpecificInitialCoords) {
        // If location accuracy is poor, use a lower zoom level to show a wider area
        const zoomLevel =
          locationAccuracy && locationAccuracy > 1000
            ? Math.max(initialZoom, 10) // Lower zoom for poor accuracy
            : Math.max(initialZoom, 14); // Higher zoom for good accuracy

        post({ type: 'setView', center: userCoord, zoom: zoomLevel });
        hasCenteredOnce.current = true;
      }
    } catch {
      // Silently handle location errors
    }
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data || '{}') as MapEvent;

      if (msg.type === 'ready') {
        readyRef.current = true;
        while (pending.current.length) {
          reallyPost(pending.current.shift() as string);
        }

        // Restore saved markers while this mount has none of its own yet. The
        // document already opened at the saved camera (`initialCenterRef`).
        if (markers.length === 0 && savedState?.markers?.length) {
          post({ type: 'setData', features: savedState.markers });
        }

        void showDevicePosition();
        return;
      }

      if (msg.type === 'mapClick') {
        // Hide instructions when user clicks on map (for address lookup)
        if (enableAddressLookup) setInstructionsDismissed(true);
        onMapPress?.(msg);
      }
      if (msg.type === 'markerClick') onMarkerPress?.(msg);
      if (msg.type === 'clusterClick') onClusterPress?.(msg);
      if (msg.type === 'addressLookup' && onAddressSelect) {
        onAddressSelect(msg.address, msg.coordinates);
      }
      if (msg.type === 'requestAddressLookup' && onAddressSelect) {
        // Handle address lookup request using the TypeScript function
        lookupAddressFromCoordinates(msg.coordinates)
          .then((address) => {
            if (address) {
              onAddressSelect(address, msg.coordinates);
            }
          })
          .catch(() => {
            // Silently handle address lookup errors
          });
      }
      if (msg.type === 'region') {
        if (screenId) {
          setMapState(screenId, {
            center: msg.center,
            zoom: msg.zoom,
            bounds: msg.bounds,
          });
        }
        // The document is the ONLY producer of this message and it always
        // stamps a source (`buildMapDocument`, pinned by
        // `__tests__/mapMoveSource.test.ts`). Normalising anyway means a
        // payload this host cannot read is treated as "the app moved the
        // camera" — the reading that changes nothing — rather than arming a
        // button off a message that arrived malformed.
        onRegionChange?.({ ...msg, source: msg.source === 'user' ? 'user' : 'programmatic' });
      }
    } catch {
      // Silently handle message parsing errors
    }
  };

  // Expose map API
  React.useImperativeHandle(
    ref,
    () => ({
      navigateToLocation: (center: LonLat, zoom: number = 15) => {
        post({ type: 'setView', center, zoom, duration: 500 });
      },
      fitBounds: (bounds, options) => {
        // A degenerate box asks MapLibre to fit an infinitely small region, which
        // pins the zoom to its maximum — a city with a point-like extent would
        // open at building level. Framing its centre at a sane zoom is the honest
        // answer, and the decision is named in `mapCamera` rather than inlined.
        if (isDegenerateBounds(bounds)) {
          const centre = boundsCenter(bounds);
          post({
            type: 'setView',
            center: [centre.longitude, centre.latitude],
            zoom: DEGENERATE_BOUNDS_ZOOM,
            duration: options?.duration ?? FIT_BOUNDS_DURATION_MS,
          });
          return;
        }
        // Padding and duration are sent EXPLICITLY rather than left to the
        // document's own fallbacks. The document is a template literal with no
        // type checking and no tests, so a default living only there is a second
        // copy of a number the web host already owns — and the two would drift
        // silently, giving the same box a different frame per platform.
        post({
          type: 'fitBounds',
          bounds: toCameraBounds(bounds),
          padding: options?.padding ?? FIT_BOUNDS_PADDING,
          duration: options?.duration ?? FIT_BOUNDS_DURATION_MS,
        });
      },
      highlightMarker: (id: string | null) => {
        post({ type: 'highlightMarker', id });
      },
      lookupAddress: async (coordinates: LonLat) => {
        return await lookupAddressFromCoordinates(coordinates);
      },
    }),
    [post],
  );

  // Web resolves `Map.web.tsx` instead of this file, so this is the native map.
  return (
    <View style={[{ flex: 1 }, style]}>
      {showInstructions && (
        <View style={addressInstructionStyles.overlay}>
          <Text style={addressInstructionStyles.text}>Tap on the map to select a location</Text>
        </View>
      )}
      {/* Mount once the hardened style has settled so the WebView builds a
          single document against the sanitized style (no reload). */}
      {styleSettled ? (
        <WebView
          ref={attachWebView}
          originWhitelist={['*']}
          source={{ html, baseUrl: MAP_DOCUMENT_BASE_URL }}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          injectedJavaScriptBeforeContentLoaded={`true;`}
        />
      ) : null}
    </View>
  );
});

// Optimized memoization with custom comparison
const Map = React.memo(MapComponent, (prevProps, nextProps) => {
  // For create property screens, ignore coordinate changes to prevent reloads
  if (
    nextProps.screenId === 'create-property' ||
    nextProps.screenId === 'create-property-fullscreen'
  ) {
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

  // For search screens, allow re-renders for marker updates
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
      // Note: We allow marker changes to trigger re-renders for search screens
    );
  }

  // For other screens, allow normal re-renders
  return false;
});

// Styles for address instructions overlay
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

export default Map;
