import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Platform, View, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';

type LonLat = [number, number];

type MapEvent =
    | { type: 'ready' }
    | { type: 'mapClick'; lngLat: LonLat }
    | { type: 'markerClick'; id: string; lngLat: LonLat }
    | { type: 'clusterClick'; leaves: GeoJSON.Feature[] }
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
}

export interface MapProps {
    style?: ViewStyle | any; initialCoordinates?: LonLat; initialZoom?: number;
    styleURL?: string; startFromCurrentLocation?: boolean; markers?: MarkerInput[];
    cluster?: ClusterOptions; markerStyle?: MarkerStyle;
    onMapPress?: (e: { lngLat: LonLat }) => void;
    onRegionChange?: (e: { center: LonLat; zoom: number; bearing: number; pitch: number; bounds: { west: number; south: number; east: number; north: number } }) => void;
    onMarkerPress?: (e: { id: string; lngLat: LonLat }) => void;
    onClusterPress?: (e: { leaves: any[] }) => void;
}

const DEFAULT_CENTER: LonLat = [2.16538, 41.38723];
const DEFAULT_ZOOM = 12;
const DEFAULT_STYLE = 'mapbox://styles/mapbox/streets-v12';
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

const buildHTML = (
    token: string,
    center: LonLat,
    zoom: number,
    styleURL: string,
    markerStyle: Required<MarkerStyle>,
    clusterOpts: Required<ClusterOptions>
) => `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css" rel="stylesheet" />
<style>
  html,body,#map{height:100%;margin:0;padding:0}
  #map{position:absolute;inset:0}
</style>
</head><body><div id="map"></div>
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

  // --- RESTORED THIS ENTIRE BLOCK ---
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
  
  // Continuous events for smooth updates
  ['move','zoom','rotate','pitch'].forEach(ev => map.on(ev, () => { emit(false); }));
  // End events for definitive state updates
  ['moveend','zoomend','rotateend','pitchend'].forEach(ev => map.on(ev, () => { emit(true); }));
  // --- END OF RESTORED BLOCK ---

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

const Map = React.forwardRef<MapApi, MapProps>(function Map(props, ref) {
    const {
        style, initialCoordinates = DEFAULT_CENTER, initialZoom = DEFAULT_ZOOM, styleURL = DEFAULT_STYLE,
        startFromCurrentLocation = true, markers = [], cluster, markerStyle,
        onMapPress, onRegionChange, onMarkerPress, onClusterPress,
    } = props;

    const [userCoord, setUserCoord] = useState<LonLat | null>(null);
    const [childReady, setChildReady] = useState(false);
    const pending = useRef<string[]>([]);

    const markerStyleFinal = useMemo<Required<MarkerStyle>>(() => ({
        chipBg: markerStyle?.chipBg ?? '#111827',
        chipText: markerStyle?.chipText ?? '#FFFFFF',
        onMarkerZoom: markerStyle?.onMarkerZoom ?? 15.5,
    }), [markerStyle]);

    const clusterFinal = useMemo<Required<ClusterOptions>>(() => ({
        enabled: cluster?.enabled ?? true,
        radius: cluster?.radius ?? 40,
        maxZoom: cluster?.maxZoom ?? 17,
        color: cluster?.color ?? '#3B82F6',
        textColor: cluster?.textColor ?? '#FFFFFF'
    }), [cluster]);

    useEffect(() => {
        if (!startFromCurrentLocation) return;
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') return;
                const loc = await Location.getCurrentPositionAsync({});
                setUserCoord([loc.coords.longitude, loc.coords.latitude]);
            } catch { }
        })();
    }, [startFromCurrentLocation]);

    const html = useMemo(
        () =>
            buildHTML(
                MAPBOX_TOKEN, initialCoordinates, initialZoom, styleURL,
                markerStyleFinal, clusterFinal
            ),
        [initialCoordinates, initialZoom, styleURL, markerStyleFinal, clusterFinal]
    );

    const webviewRef = useRef<any>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    const reallyPost = React.useCallback((str: string) => {
        if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage(str, '*');
        } else {
            webviewRef.current?.postMessage?.(str);
            webviewRef.current?.injectJavaScript?.(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(str)}})); true;`);
        }
    }, []);

    const post = React.useCallback((payload: any) => {
        const str = JSON.stringify(payload);
        if (childReady) reallyPost(str);
        else pending.current.push(str);
    }, [childReady, reallyPost]);

    const flushPending = React.useCallback(() => {
        while (pending.current.length) reallyPost(pending.current.shift() as string);
    }, [reallyPost]);

    useEffect(() => {
        post({ type: 'setData', features: markers });
    }, [markers, post]);

    const hasCenteredOnce = useRef(false);
    useEffect(() => {
        if (!userCoord) return;
        post({ type: 'setUserLocation', coordinates: userCoord });
        if (!hasCenteredOnce.current) {
            post({ type: 'setView', center: userCoord, zoom: Math.max(initialZoom, 14) });
            hasCenteredOnce.current = true;
        }
    }, [userCoord, post, initialZoom]);

    const handleMessage = (event: any) => {
        try {
            const msg = JSON.parse(event?.data || event?.nativeEvent?.data || '{}') as MapEvent;
            if (msg.type === 'ready') { setChildReady(true); flushPending(); return; }
            if (msg.type === 'mapClick') onMapPress?.(msg);
            if (msg.type === 'markerClick') onMarkerPress?.(msg);
            if (msg.type === 'clusterClick') onClusterPress?.(msg);
            if (msg.type === 'region') onRegionChange?.(msg);
        } catch { }
    };

    useEffect(() => {
        if (Platform.OS !== 'web') return;
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [onMapPress, onMarkerPress, onRegionChange, onClusterPress, flushPending]);

    const handleNativeMessage = (event: any) => handleMessage(event);

    React.useImperativeHandle(ref, () => ({
        navigateToLocation: (center: LonLat, zoom: number = 15) => {
            post({ type: 'setView', center, zoom, duration: 500 });
        },
        highlightMarker: (id: string | null) => {
            post({ type: 'highlightMarker', id: id });
        }
    }), [post]);

    if (Platform.OS === 'web') {
        return (
            <View style={{ flex: 1, ...style }}>
                <iframe
                    ref={iframeRef} title="mapbox-map" srcDoc={html}
                    style={{ border: '0', width: '100%', height: '100%' }}
                    sandbox="allow-scripts allow-same-origin" />
            </View>
        );
    }

    return (
        <View style={[{ flex: 1 }, style]}>
            <WebView
                ref={webviewRef} originWhitelist={['*']} source={{ html }} onMessage={handleNativeMessage}
                javaScriptEnabled domStorageEnabled allowFileAccess allowsInlineMediaPlayback
                setSupportMultipleWindows={false} injectedJavaScriptBeforeContentLoaded={`true;`} />
        </View>
    );
});

export default Map;