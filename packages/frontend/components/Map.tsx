import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Platform, View, ViewStyle, Text } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { StyleSpecification } from 'maplibre-gl';
import * as Location from 'expo-location';
import { useMapState } from '@/context/MapStateContext';
import { api, type ApiResponse } from '@/utils/api';
import { buildMapDocument } from './mapDocument';
import { DEFAULT_STYLE_URL, fetchSanitizedMapStyle } from './mapStyle';
import { colors } from '@/styles/colors';
import type {
  AddressData,
  ClusterLeaf,
  ClusterOptions,
  LonLat,
  MapApi,
  MapEvent,
  MarkerInput,
  MarkerStyle,
  OutboundMapMessage,
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

const MapComponent = React.forwardRef<MapApi, MapProps>(function Map(props, ref) {
  const {
    style,
    initialCoordinates = DEFAULT_CENTER,
    initialZoom = DEFAULT_ZOOM,
    styleURL = DEFAULT_STYLE_URL,
    startFromCurrentLocation = true,
    markers = [],
    cluster,
    markerStyle,
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

  const [userCoord, setUserCoord] = useState<LonLat | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [childReady, setChildReady] = useState(false);
  const [showInstructions, setShowInstructions] = useState(enableAddressLookup && showAddressInstructions);
  const pending = useRef<string[]>([]);
  const mapInitialized = useRef(false);

  // The OpenFreeMap liberty style ships layer filters that throw on null-numeric
  // tile properties (`Expected value to be of type number, but found null`). We
  // fetch + harden it (sanitizeMapStyle) once and feed the WebView document the
  // patched style OBJECT, so the WebView builds the map ONCE against the hardened
  // style (no reload). `styleSettled` gates the WebView mount until the fetch
  // resolves; on failure it settles to the raw URL so the map always renders
  // (worst case: the original noisy log returns, but it's the same map).
  const [resolvedStyle, setResolvedStyle] = useState<string | StyleSpecification>(styleURL);
  const [styleSettled, setStyleSettled] = useState(false);

  // Get saved map state if screenId is provided
  const savedState = screenId ? getMapState(screenId) : null;

  // Freeze initial center/zoom for HTML to prevent iframe reloads
  const initialCenterRef = useRef<LonLat>(savedState?.center || initialCoordinates);
  const initialZoomRef = useRef<number>(savedState?.zoom || initialZoom);

  // Memoize marker style configuration
  const markerStyleFinal = useMemo<Required<MarkerStyle>>(() => ({
    chipBg: markerStyle?.chipBg ?? colors.COLOR_BLACK_LIGHT_1,
    chipText: markerStyle?.chipText ?? colors.white,
    onMarkerZoom: markerStyle?.onMarkerZoom ?? 15.5,
  }), [markerStyle]);

  // Memoize cluster configuration
  const clusterFinal = useMemo<Required<ClusterOptions>>(() => ({
    enabled: cluster?.enabled ?? true,
    radius: cluster?.radius ?? 40,
    maxZoom: cluster?.maxZoom ?? 17,
    color: cluster?.color ?? colors.info,
    textColor: cluster?.textColor ?? colors.white
  }), [cluster]);

  // Fetch + sanitize the style once per URL, then mount the WebView with it.
  // Settling to the raw URL on failure guarantees the map still renders.
  useEffect(() => {
    let cancelled = false;
    setStyleSettled(false);
    fetchSanitizedMapStyle(styleURL)
      .then((style) => {
        if (cancelled) return;
        setResolvedStyle(style);
      })
      .catch(() => {
        if (cancelled) return;
        // Network/parse failure: fall back to the raw URL so the document still
        // builds. No throw — the map must not fail to mount.
        setResolvedStyle(styleURL);
      })
      .finally(() => {
        if (!cancelled) setStyleSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [styleURL]);

  // Get user location
  useEffect(() => {
    if (!startFromCurrentLocation) return;

    const getUserLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          return;
        }

        // Get location with high accuracy and fresh data
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 10,
        });

        setLocationAccuracy(loc.coords.accuracy || null);
        setUserCoord([loc.coords.longitude, loc.coords.latitude]);
      } catch {
        // Silently handle location errors
      }
    };

    getUserLocation();
  }, [startFromCurrentLocation]);

  // Generate HTML once with frozen initial coordinates to prevent iframe reloads
  const html = useMemo(
    () => buildMapDocument({
      center: initialCenterRef.current,
      zoom: initialZoomRef.current,
      style: resolvedStyle,
      markerStyle: markerStyleFinal,
      cluster: clusterFinal,
      enableAddressLookup,
    }),
    [resolvedStyle, markerStyleFinal, clusterFinal, enableAddressLookup]
  );

  const webviewRef = useRef<WebView | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Memoize post function
  const reallyPost = useCallback((str: string) => {
    if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(str, '*');
    } else {
      webviewRef.current?.postMessage?.(str);
      webviewRef.current?.injectJavaScript?.(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(str)}})); true;`);
    }
  }, []);

  const post = useCallback((payload: OutboundMapMessage) => {
    const str = JSON.stringify(payload);
    if (childReady) {
      reallyPost(str);
    } else {
      pending.current.push(str);
    }
  }, [childReady, reallyPost]);

  const flushPending = useCallback(() => {
    while (pending.current.length) {
      reallyPost(pending.current.shift() as string);
    }
  }, [reallyPost]);

  // Handle marker updates efficiently
  useEffect(() => {
    if (childReady && mapInitialized.current && screenId) {
      // Only update markers if they've actually changed
      const currentState = getMapState(screenId);
      const currentMarkers = currentState?.markers || [];

      const markersChanged = markers.length !== currentMarkers.length ||
        markers.some((marker, index) => {
          const current = currentMarkers[index];
          return !current ||
            marker.id !== current.id ||
            marker.coordinates[0] !== current.coordinates[0] ||
            marker.coordinates[1] !== current.coordinates[1] ||
            marker.priceLabel !== current.priceLabel;
        });

      if (markersChanged) {
        post({ type: 'setData', features: markers });
      }
    } else if (childReady && mapInitialized.current) {
      // If no screenId, always update markers
      post({ type: 'setData', features: markers });
    }
  }, [markers, childReady, post, screenId, getMapState]);

  // Send markers when map becomes initialized
  useEffect(() => {
    if (childReady && mapInitialized.current && markers.length > 0) {
      post({ type: 'setData', features: markers });
    }
  }, [childReady, markers, post]);

  // Fallback: Send markers after a delay if map doesn't initialize
  useEffect(() => {
    if (childReady && !mapInitialized.current && markers.length > 0) {
      const timeoutId = setTimeout(() => {
        mapInitialized.current = true; // Force initialization
        post({ type: 'setData', features: markers });
      }, 2000);

      return () => clearTimeout(timeoutId);
    }
  }, [childReady, markers, post]);

  // Save markers to state
  useEffect(() => {
    if (screenId && markers.length > 0) {
      const currentState = getMapState(screenId);
      const currentMarkers = currentState?.markers || [];

      const markersChanged = markers.length !== currentMarkers.length ||
        markers.some((marker, index) => {
          const current = currentMarkers[index];
          return !current ||
            marker.id !== current.id ||
            marker.coordinates[0] !== current.coordinates[0] ||
            marker.coordinates[1] !== current.coordinates[1] ||
            marker.priceLabel !== current.priceLabel;
        });

      if (markersChanged) {
        setMapState(screenId, { markers });
      }
    }
  }, [markers, screenId, setMapState, getMapState]);

  // Handle user location centering
  const hasCenteredOnce = useRef(false);

  // Initialize instructions visibility based on address lookup mode
  useEffect(() => {
    if (showAddressInstructions && enableAddressLookup) {
      setShowInstructions(true);
    } else {
      setShowInstructions(false);
    }
  }, [showAddressInstructions, enableAddressLookup]);

  useEffect(() => {
    if (!userCoord) return;

    post({ type: 'setUserLocation', coordinates: userCoord });

    // Only auto-center on user location if no specific initialCoordinates were provided
    const hasSpecificInitialCoords = initialCoordinates !== DEFAULT_CENTER &&
      (initialCoordinates[0] !== DEFAULT_CENTER[0] ||
        initialCoordinates[1] !== DEFAULT_CENTER[1]);

    if (!hasCenteredOnce.current && !savedState && !hasSpecificInitialCoords) {
      // If location accuracy is poor, use a lower zoom level to show a wider area
      const zoomLevel = locationAccuracy && locationAccuracy > 1000
        ? Math.max(initialZoom, 10) // Lower zoom for poor accuracy
        : Math.max(initialZoom, 14); // Higher zoom for good accuracy

      post({ type: 'setView', center: userCoord, zoom: zoomLevel });
      hasCenteredOnce.current = true;
    }
  }, [userCoord, post, initialZoom, savedState, locationAccuracy, initialCoordinates]);

  // Memoize message handler
  const handleMessage = useCallback((event: MessageEvent | WebViewMessageEvent) => {
    try {
      const rawData =
        'data' in event && typeof event.data === 'string'
          ? event.data
          : 'nativeEvent' in event
            ? event.nativeEvent.data
            : undefined;
      const msg = JSON.parse(rawData || '{}') as MapEvent;

      if (msg.type === 'ready') {
        setChildReady(true);
        mapInitialized.current = true;
        flushPending();

        // Set the view if we have saved state (otherwise HTML already has correct coordinates)
        if (savedState) {
          post({ type: 'setView', center: savedState.center, zoom: savedState.zoom, duration: 0 });
        }

        // Restore saved markers
        if (savedState?.markers && savedState.markers.length > 0) {
          post({ type: 'setData', features: savedState.markers });
        }

        return;
      }

      if (msg.type === 'mapClick') {
        // Hide instructions when user clicks on map (for address lookup)
        if (enableAddressLookup && showInstructions) {
          setShowInstructions(false);
        }
        onMapPress?.(msg);
      }
      if (msg.type === 'markerClick') onMarkerPress?.(msg);
      if (msg.type === 'clusterClick') onClusterPress?.(msg);
      if (msg.type === 'addressLookup' && onAddressSelect) {
        onAddressSelect(msg.address, msg.coordinates);
      }
      if (msg.type === 'requestAddressLookup' && onAddressSelect) {
        // Handle address lookup request using the TypeScript function
        lookupAddressFromCoordinates(msg.coordinates).then(address => {
          if (address) {
            onAddressSelect(address, msg.coordinates);
          }
        }).catch(() => {
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
        onRegionChange?.(msg);
      }
    } catch {
      // Silently handle message parsing errors
    }
  }, [onMapPress, onMarkerPress, onClusterPress, onAddressSelect, onRegionChange, screenId, setMapState, flushPending, post, savedState, enableAddressLookup, showInstructions]);

  // Set up message listeners
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      mapInitialized.current = false;
    };
  }, [handleMessage]);

  const handleNativeMessage = useCallback((event: WebViewMessageEvent) => handleMessage(event), [handleMessage]);

  // Expose map API
  React.useImperativeHandle(ref, () => ({
    navigateToLocation: (center: LonLat, zoom: number = 15) => {
      post({ type: 'setView', center, zoom, duration: 500 });
    },
    highlightMarker: (id: string | null) => {
      post({ type: 'highlightMarker', id });
    },
    lookupAddress: async (coordinates: LonLat) => {
      return await lookupAddressFromCoordinates(coordinates);
    }
  }), [post]);

  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, ...style }}>
        {showInstructions && enableAddressLookup && (
          <View style={addressInstructionStyles.overlay}>
            <Text style={addressInstructionStyles.text}>
              Tap on the map to select a location
            </Text>
          </View>
        )}
        {/* Mount once the hardened style has settled so the document builds a
            single time against the sanitized style (no reload). */}
        {styleSettled ? (
          <iframe
            ref={iframeRef}
            title="map"
            srcDoc={html}
            style={{ border: '0', width: '100%', height: '100%' }}
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => {
              mapInitialized.current = false;
            }}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={[{ flex: 1 }, style]}>
      {showInstructions && enableAddressLookup && (
        <View style={addressInstructionStyles.overlay}>
          <Text style={addressInstructionStyles.text}>
            Tap on the map to select a location
          </Text>
        </View>
      )}
      {/* Mount once the hardened style has settled so the WebView builds a
          single document against the sanitized style (no reload). */}
      {styleSettled ? (
        <WebView
          ref={webviewRef}
          originWhitelist={['*']}
          source={{ html }}
          onMessage={handleNativeMessage}
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

  // For search screens, allow re-renders for marker updates
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
  }
};

export default Map;
