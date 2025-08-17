import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Platform, View, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { useMapState } from '@/context/MapStateContext';

type LonLat = [number, number];

export interface AddressData {
    street?: string;
    houseNumber?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    fullAddress?: string;
}

type MapEvent =
    | { type: 'ready' }
    | { type: 'mapClick'; lngLat: LonLat }
    | { type: 'markerClick'; id: string; lngLat: LonLat }
    | { type: 'clusterClick'; leaves: any[] }
    | { type: 'addressLookup'; address: AddressData; coordinates: LonLat }
    | {
        type: 'region';
        center: LonLat;
        zoom: number;
        bearing: number;
        pitch: number;
        bounds: { west: number; south: number; east: number; north: number };
    };

export interface MarkerInput {
    id: string;
    coordinates: LonLat;
    priceLabel: string;
}

export interface ClusterOptions {
    enabled?: boolean;
    radius?: number;
    maxZoom?: number;
    color?: string;
    textColor?: string;
}

export interface MarkerStyle {
    chipBg?: string;
    chipText?: string;
    onMarkerZoom?: number;
}

export interface MapApi {
    navigateToLocation: (center: LonLat, zoom?: number) => void;
    highlightMarker: (id: string | null) => void;
    lookupAddress: (coordinates: LonLat) => Promise<AddressData | null>;
}

export interface MapProps {
    style?: ViewStyle | any;
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
    onRegionChange?: (e: { center: LonLat; zoom: number; bearing: number; pitch: number; bounds: { west: number; south: number; east: number; north: number } }) => void;
    onMarkerPress?: (e: { id: string; lngLat: LonLat }) => void;
    onClusterPress?: (e: { leaves: any[] }) => void;
}

const DEFAULT_CENTER: LonLat = [2.16538, 41.38723];
const DEFAULT_ZOOM = 12;
const DEFAULT_STYLE = 'mapbox://styles/mapbox/streets-v12';
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

// Address lookup function using Mapbox Geocoding API
const lookupAddressFromCoordinates = async (coordinates: LonLat): Promise<AddressData | null> => {
    try {
        const [lng, lat] = coordinates;
        const response = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address,poi&limit=1`
        );

        if (!response.ok) {
            throw new Error('Failed to fetch address');
        }

        const data = await response.json();
        const feature = data.features?.[0];

        if (!feature) {
            return null;
        }

        const context = feature.context || [];
        const addressComponents = {
            street: feature.text || '',
            houseNumber: feature.address || '',
            city: context.find((c: any) => c.id.startsWith('place'))?.text || '',
            state: context.find((c: any) => c.id.startsWith('region'))?.text || '',
            country: context.find((c: any) => c.id.startsWith('country'))?.text || '',
            postalCode: context.find((c: any) => c.id.startsWith('postcode'))?.text || '',
            fullAddress: feature.place_name || '',
        };

        return addressComponents;
    } catch (error) {
        console.error('Address lookup failed:', error);
        return null;
    }
};

const buildHTML = (
    token: string,
    center: LonLat,
    zoom: number,
    styleURL: string,
    markerStyle: Required<MarkerStyle>,
    clusterOpts: Required<ClusterOptions>,
    enableAddressLookup: boolean
) => `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css" rel="stylesheet" />
<style>
  html,body,#map{height:100%;margin:0;padding:0}
  #map{position:absolute;inset:0}
</style>
</head><body>
  <div id="map"></div>
<script src="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js"></script>
<script>(function(){
  const isRN = !!window.ReactNativeWebView;
  const post = (msg)=>{const d=JSON.stringify(msg); if(isRN) window.ReactNativeWebView.postMessage(d); else window.parent&&window.parent.postMessage(d,'*');};
  mapboxgl.accessToken=${JSON.stringify(token)};
  const map=new mapboxgl.Map({container:'map',style:${JSON.stringify(styleURL)},center:${JSON.stringify(center)},zoom:${JSON.stringify(zoom)},attributionControl:true,hash:false});

  const toGeoJSON=(list)=>({type:'FeatureCollection',features:(Array.isArray(list)?list:[]).map(p=>({
    type:'Feature', id: p.id, geometry:{type:'Point',coordinates:p.coordinates},
    properties:{ id: String(p.id), price: String(p.priceLabel||'') }
  }))});

  const srcId='markers';
  const cluster=${String(clusterOpts.enabled)}, cRad=${clusterOpts.radius}, cMax=${clusterOpts.maxZoom};
  const cColor=${JSON.stringify(clusterOpts.color)}, cText=${JSON.stringify(clusterOpts.textColor)};
  const chipBg=${JSON.stringify(markerStyle.chipBg)}, chipText=${JSON.stringify(markerStyle.chipText)};
  let highlightedFeatureId = null;
  let selectedMarker = null;
  
  map.on('load', () => {
    map.addSource(srcId, {
        type:'geojson', data:toGeoJSON([]), cluster:cluster, clusterRadius:cRad, clusterMaxZoom:cMax, promoteId: 'id'
    });
    
    if(cluster){
      map.addLayer({id:'clusters',type:'circle',source:srcId,filter:['has','point_count'],paint:{
        'circle-color':cColor,'circle-radius':['step',['get','point_count'],16,20,18,50,22],
        'circle-stroke-color':'#FFFFFF','circle-stroke-width':2}});
      map.addLayer({id:'cluster-count',type:'symbol',source:srcId,filter:['has','point_count'],layout:{
        'text-field':['get','point_count_abbreviated'],'text-font':['Open Sans Bold'],'text-size':12},paint:{'text-color':cText}});
    }

    map.addLayer({
        id: 'unclustered-point-bg', type: 'circle', source: srcId, filter: ['!', ['has', 'point_count']],
        paint: {
            'circle-color': chipBg, 'circle-radius': 18,
            'circle-stroke-width': ['case', ['boolean', ['feature-state', 'highlighted'], false], 3, 1],
            'circle-stroke-color': ['case', ['boolean', ['feature-state', 'highlighted'], false], '#007AFF', '#FFFFFF']
        }
    });

    map.addLayer({
        id: 'unclustered-point-text', type: 'symbol', source: srcId, filter: ['!', ['has', 'point_count']],
        layout: { 'text-field': ['get', 'price'], 'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-allow-overlap': true },
        paint: { 'text-color': chipText }
    });

    map.on('click','clusters',(e)=>{
      const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
      if (!features.length) return;
      const clusterId = features[0].properties.cluster_id;
      map.getSource(srcId).getClusterExpansionZoom(clusterId,(err,z)=>{ if(err) return; map.easeTo({center: features[0].geometry.coordinates, zoom:z}); });
    });

    map.on('click', 'unclustered-point-bg', (e) => {
        if (!e.features || !e.features.length) return;
        post({ type: 'markerClick', id: e.features[0].properties.id, lngLat: e.features[0].geometry.coordinates });
    });

    map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'unclustered-point-bg', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'unclustered-point-bg', () => { map.getCanvas().style.cursor = ''; });

    post({ type:'ready' });
  });

  map.on('click', (e) => {
    const coordinates = e.lngLat.toArray();
    post({ type: 'mapClick', lngLat: coordinates });
    
    if (${enableAddressLookup}) {
      if (selectedMarker) {
        selectedMarker.remove();
      }
      
      selectedMarker = new mapboxgl.Marker({ color: '#007AFF' })
        .setLngLat(coordinates)
        .addTo(map);
      
      fetch(\`https://api.mapbox.com/geocoding/v5/mapbox.places/\${coordinates[0]},\${coordinates[1]}.json?access_token=${MAPBOX_TOKEN}&types=address,poi&limit=1\`)
        .then(response => response.json())
        .then(data => {
          const feature = data.features?.[0];
          if (feature) {
            const context = feature.context || [];
            const address = {
              street: feature.text || '',
              houseNumber: feature.address || '',
              city: context.find(c => c.id.startsWith('place'))?.text || '',
              state: context.find(c => c.id.startsWith('region'))?.text || '',
              country: context.find(c => c.id.startsWith('country'))?.text || '',
              postalCode: context.find(c => c.id.startsWith('postcode'))?.text || '',
              fullAddress: feature.place_name || '',
            };
            post({ type: 'addressLookup', address: address, coordinates: coordinates });
          }
        })
        .catch(error => {
          console.error('Address lookup failed:', error);
        });
    }
  });

  let last = 0;
  const emit = (force=false) => {
    const now = Date.now();
    if (!force && now - last < 100) return;
    last = now;
    const c = map.getCenter();
    const b = map.getBounds();
    const boundsPayload = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    post({ type:'region', center:[c.lng,c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), bounds: boundsPayload });
  };
  
  ['move','zoom','rotate','pitch'].forEach(ev => map.on(ev, () => { emit(false); }));
  ['moveend','zoomend','rotateend','pitchend'].forEach(ev => map.on(ev, () => { emit(true); }));

  const handle=(raw)=>{ try{
    const m = JSON.parse(raw.data || raw);
    if(!m || typeof m !== 'object') return;
    if(m.type==='setView'){ map.easeTo({ center: m.center, zoom: m.zoom, duration: m.duration || 500 }); }
    if(m.type==='setData'){ const s = map.getSource(srcId); if (s) s.setData(toGeoJSON(m.features || [])); }
    if(m.type==='highlightMarker'){
        if (highlightedFeatureId) {
            map.setFeatureState({ source: srcId, id: highlightedFeatureId }, { highlighted: false });
        }
        if (m.id) {
            map.setFeatureState({ source: srcId, id: m.id }, { highlighted: true });
            highlightedFeatureId = m.id;
        } else {
            highlightedFeatureId = null;
        }
    }
  } catch{} };
  if(isRN) document.addEventListener('message',handle); else window.addEventListener('message',(e)=>handle(e));
})();</script></body></html>`;

const MapComponent = React.forwardRef<MapApi, MapProps>(function Map(props, ref) {
    const {
        style,
        initialCoordinates = DEFAULT_CENTER,
        initialZoom = DEFAULT_ZOOM,
        styleURL = DEFAULT_STYLE,
        startFromCurrentLocation = true,
        markers = [],
        cluster,
        markerStyle,
        screenId,
        enableAddressLookup = false,
        showAddressInstructions = false,
        onMapPress,
        onAddressSelect,
        onAddressLookupStart,
        onAddressLookupEnd,
        onRegionChange,
        onMarkerPress,
        onClusterPress,
    } = props;

    const { getMapState, setMapState } = useMapState();

    const [userCoord, setUserCoord] = useState<LonLat | null>(null);
    const [childReady, setChildReady] = useState(false);
    const pending = useRef<string[]>([]);
    const mapInitialized = useRef(false);

    // Get saved map state if screenId is provided
    const savedState = screenId ? getMapState(screenId) : null;
    const effectiveCoordinates = savedState?.center || initialCoordinates;
    const effectiveZoom = savedState?.zoom || initialZoom;

    // Memoize marker style configuration
    const markerStyleFinal = useMemo<Required<MarkerStyle>>(() => ({
        chipBg: markerStyle?.chipBg ?? '#111827',
        chipText: markerStyle?.chipText ?? '#FFFFFF',
        onMarkerZoom: markerStyle?.onMarkerZoom ?? 15.5,
    }), [markerStyle]);

    // Memoize cluster configuration
    const clusterFinal = useMemo<Required<ClusterOptions>>(() => ({
        enabled: cluster?.enabled ?? true,
        radius: cluster?.radius ?? 40,
        maxZoom: cluster?.maxZoom ?? 17,
        color: cluster?.color ?? '#3B82F6',
        textColor: cluster?.textColor ?? '#FFFFFF'
    }), [cluster]);

    // Get user location
    useEffect(() => {
        if (!startFromCurrentLocation) return;

        const getUserLocation = async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') return;
                const loc = await Location.getCurrentPositionAsync({});
                setUserCoord([loc.coords.longitude, loc.coords.latitude]);
            } catch (error) {
                console.warn('Failed to get user location:', error);
            }
        };

        getUserLocation();
    }, [startFromCurrentLocation]);

    // Generate HTML once with default coordinates to prevent iframe reloads
    const html = useMemo(
        () => buildHTML(
            MAPBOX_TOKEN,
            DEFAULT_CENTER, // Always use default center for HTML generation
            DEFAULT_ZOOM,   // Always use default zoom for HTML generation
            styleURL,
            markerStyleFinal,
            clusterFinal,
            enableAddressLookup
        ),
        [styleURL, markerStyleFinal, clusterFinal, enableAddressLookup] // Only regenerate when these change
    );

    const webviewRef = useRef<any>(null);
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

    const post = useCallback((payload: any) => {
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
        console.log('Map marker update effect - childReady:', childReady, 'mapInitialized:', mapInitialized.current, 'markers length:', markers.length);
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
                console.log('Sending markers to map (with screenId):', markers.length);
                post({ type: 'setData', features: markers });
            }
        } else if (childReady && mapInitialized.current) {
            // If no screenId, always update markers
            console.log('Sending markers to map (no screenId):', markers.length);
            post({ type: 'setData', features: markers });
        }
    }, [markers, childReady, post, screenId, getMapState]);

    // Send markers when map becomes initialized
    useEffect(() => {
        if (childReady && mapInitialized.current && markers.length > 0) {
            console.log('Map initialized, sending initial markers:', markers.length);
            post({ type: 'setData', features: markers });
        }
    }, [childReady, mapInitialized.current, markers, post]);

    // Fallback: Send markers after a delay if map doesn't initialize
    useEffect(() => {
        if (childReady && !mapInitialized.current && markers.length > 0) {
            const timeoutId = setTimeout(() => {
                console.log('Fallback: Sending markers after delay:', markers.length);
                mapInitialized.current = true; // Force initialization
                post({ type: 'setData', features: markers });
            }, 2000); // 2 second delay

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
    useEffect(() => {
        if (!userCoord) return;

        post({ type: 'setUserLocation', coordinates: userCoord });

        if (!hasCenteredOnce.current && !savedState) {
            post({ type: 'setView', center: userCoord, zoom: Math.max(initialZoom, 14) });
            hasCenteredOnce.current = true;
        }
    }, [userCoord, post, initialZoom, savedState]);

    // Memoize message handler
    const handleMessage = useCallback((event: any) => {
        try {
            console.log('Map message received:', event?.data || event?.nativeEvent?.data);
            const msg = JSON.parse(event?.data || event?.nativeEvent?.data || '{}') as MapEvent;
            console.log('Parsed map message:', msg);

            if (msg.type === 'ready') {
                console.log('Map ready event received!');
                setChildReady(true);
                mapInitialized.current = true;
                flushPending();

                // Always set the correct initial view since HTML uses default coordinates
                if (savedState) {
                    post({ type: 'setView', center: savedState.center, zoom: savedState.zoom, duration: 0 });
                } else {
                    post({ type: 'setView', center: effectiveCoordinates, zoom: effectiveZoom, duration: 0 });
                }

                // Restore saved markers
                if (savedState?.markers && savedState.markers.length > 0) {
                    post({ type: 'setData', features: savedState.markers });
                }

                return;
            }

            if (msg.type === 'mapClick') onMapPress?.(msg);
            if (msg.type === 'markerClick') onMarkerPress?.(msg);
            if (msg.type === 'clusterClick') onClusterPress?.(msg);
            if (msg.type === 'addressLookup' && onAddressSelect) {
                onAddressSelect(msg.address, msg.coordinates);
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
        } catch (error) {
            console.warn('Error handling map message:', error);
        }
    }, [onMapPress, onMarkerPress, onClusterPress, onAddressSelect, onRegionChange, screenId, setMapState, flushPending, post, savedState, effectiveCoordinates, effectiveZoom]);

    // Set up message listeners
    useEffect(() => {
        if (Platform.OS !== 'web') return;

        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
            mapInitialized.current = false;
        };
    }, [handleMessage]);

    const handleNativeMessage = useCallback((event: any) => handleMessage(event), [handleMessage]);

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
                <iframe
                    ref={iframeRef}
                    title="mapbox-map"
                    srcDoc={html}
                    style={{ border: '0', width: '100%', height: '100%' }}
                    sandbox="allow-scripts allow-same-origin"
                    onLoad={() => {
                        mapInitialized.current = false;
                    }}
                />
            </View>
        );
    }

    return (
        <View style={[{ flex: 1 }, style]}>
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
                onUnload={() => {
                    mapInitialized.current = false;
                }}
            />
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
    if (nextProps.screenId === 'search') {
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

export default Map;