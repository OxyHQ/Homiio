// Map.tsx — Expo (web/android/iOS) using Mapbox GL JS inside WebView/iframe
import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Platform, View, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';

type LonLat = [number, number];

type MapEvent =
    | { type: 'ready' }
    | { type: 'mapClick'; lngLat: LonLat }
    | { type: 'markerClick'; id: string; lngLat: LonLat }
    | { type: 'markerHover'; id: string; lngLat: LonLat; point: { x: number; y: number } }
    | { type: 'markerLeave' }
    | { type: 'userClick'; coordinates: LonLat }
    | { type: 'region'; center: LonLat; zoom: number; bearing: number; pitch: number };

export interface MarkerInput {
    id: string;
    coordinates: LonLat;
    priceLabel: string; // e.g. "€950"
    color?: string;     // circle color at low zooms
    size?: number;      // circle radius (px) at low zooms
}

export interface ClusterOptions {
    enabled?: boolean;
    radius?: number;
    maxZoom?: number;
    color?: string;
    textColor?: string;
}

export interface MarkerStyle {
    color?: string;
    size?: number;
    strokeColor?: string;
    strokeWidth?: number;
    chipZoomThreshold?: number; // zoom where chips appear
    chipBg?: string;
    chipText?: string;
    chipBorder?: string;
    chipPaddingH?: number; // px
    chipPaddingV?: number; // px
    chipFontSize?: number; // px
    onMarkerZoom?: number; // zoom level when pressing a marker
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
    onMapPress?: (e: { lngLat: LonLat }) => void;
    onRegionChange?: (e: { center: LonLat; zoom: number; bearing: number; pitch: number }) => void;
    onMarkerPress?: (e: { id: string; lngLat: LonLat }) => void;
    // Web-only tooltip renderer on hover:
    renderMarkerHover?: (payload: { id: string; lngLat: LonLat }) => React.ReactNode;
}

const DEFAULT_CENTER: LonLat = [-3.7038, 40.4168]; // Madrid fallback
const DEFAULT_ZOOM = 12;
const DEFAULT_STYLE = 'mapbox://styles/mapbox/streets-v12';
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

const buildHTML = (
    token: string,
    center: LonLat,
    zoom: number,
    styleURL: string,
    initialData: any,
    markerStyle: Required<MarkerStyle>,
    clusterOpts: Required<ClusterOptions>
) => `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css" rel="stylesheet" />
<style>
  html,body,#map{height:100%;margin:0;padding:0}
  #map{position:absolute;inset:0}
  .price-chip{
    position: relative;
    display: inline-block;
    background: ${markerStyle.chipBg};
    color: ${markerStyle.chipText};
    border: 1px solid ${markerStyle.chipBorder};
    border-radius: 9999px;
    padding: ${markerStyle.chipPaddingV}px ${markerStyle.chipPaddingH}px;
    font: 600 ${markerStyle.chipFontSize}px/1 system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial, 'Noto Sans';
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    white-space: nowrap;
    user-select: none;
    pointer-events: auto;
  }
</style>
</head><body><div id="map"></div>
<script src="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js"></script>
<script>(function(){
  const isRN = !!window.ReactNativeWebView;
  const post = (msg)=>{const d=JSON.stringify(msg); if(isRN) window.ReactNativeWebView.postMessage(d); else window.parent&&window.parent.postMessage(d,'*');};
  mapboxgl.accessToken=${JSON.stringify(token)};
  const map=new mapboxgl.Map({container:'map',style:${JSON.stringify(styleURL)},center:${JSON.stringify(center)},zoom:${JSON.stringify(zoom)},attributionControl:true,hash:false});

  const toGeoJSON=(list)=>({type:'FeatureCollection',features:(Array.isArray(list)?list:[]).map(p=>({type:'Feature',geometry:{type:'Point',coordinates:p.coordinates},properties:{
    id:String(p.id), color:p.color||${JSON.stringify(markerStyle.color)}, size:(typeof p.size==='number'?p.size:${markerStyle.size}), price:String(p.priceLabel||'')
  }}))});

  const srcId='markers';
  const userSrc='user-location';
  const cluster=${String(clusterOpts.enabled)}, cRad=${clusterOpts.radius}, cMax=${clusterOpts.maxZoom};
  const cColor=${JSON.stringify(clusterOpts.color)}, cText=${JSON.stringify(clusterOpts.textColor)};
  const stroke=${JSON.stringify(markerStyle.strokeColor)}, strokeW=${markerStyle.strokeWidth};
  const chipZoom=${markerStyle.chipZoomThreshold};
  const markerZoom=${markerStyle.onMarkerZoom};

  let htmlMarkers = new Map(); // id -> mapboxgl.Marker

  function ensureSources(){
    if(!map.getSource(srcId)){
      map.addSource(srcId,{type:'geojson',data:toGeoJSON(${JSON.stringify(initialData)}),cluster:cluster,clusterRadius:cRad,clusterMaxZoom:cMax});
    }
    if(!map.getSource(userSrc)){
      map.addSource(userSrc,{type:'geojson',data:{"type":"FeatureCollection","features":[]}});
    }
  }

  function ensureLayers(){
    if(cluster && !map.getLayer('clusters')){
      map.addLayer({id:'clusters',type:'circle',source:srcId,filter:['has','point_count'],paint:{
        'circle-color':cColor,'circle-radius':['step',['get','point_count'],14,20,18,50,24],
        'circle-stroke-color':stroke,'circle-stroke-width':strokeW}});
      map.addLayer({id:'cluster-count',type:'symbol',source:srcId,filter:['has','point_count'],layout:{
        'text-field':['get','point_count_abbreviated'],'text-font':['Open Sans Bold','Arial Unicode MS Bold'],'text-size':12},paint:{'text-color':cText}});
      map.on('click','clusters',(e)=>{const f=map.queryRenderedFeatures(e.point,{layers:['clusters']})[0]; if(!f) return;
        const id=f.properties.cluster_id, s=map.getSource(srcId);
        s.getClusterExpansionZoom(id,(err,z)=>{ if(err) return; const [lng,lat]=f.geometry.coordinates; map.easeTo({center:[lng,lat],zoom:z});});});
      map.on('mouseenter','clusters',()=>map.getCanvas().style.cursor='pointer');
      map.on('mouseleave','clusters',()=>map.getCanvas().style.cursor='');
    }

    // Low-zoom circles for unclustered points (chips appear at higher zoom)
    if(!map.getLayer('unclustered-circle')){
      map.addLayer({id:'unclustered-circle',type:'circle',source:srcId,filter:['all',['!',['has','point_count']],['<',['zoom'],chipZoom]],paint:{
        'circle-color':['get','color'],'circle-radius':['get','size'],'circle-stroke-color':stroke,'circle-stroke-width':strokeW}});
      // Click on low-zoom circle -> zoom in + emit
      map.on('click','unclustered-circle',(e)=>{const f=e.features&&e.features[0]; if(!f) return;
        const coord=f.geometry.coordinates; map.easeTo({center:coord,zoom:Math.max(map.getZoom(),markerZoom)}); post({type:'markerClick',id:String(f.properties.id),lngLat:coord});});
      map.on('mouseenter','unclustered-circle',()=>map.getCanvas().style.cursor='pointer');
      map.on('mouseleave','unclustered-circle',()=>map.getCanvas().style.cursor='');
    }

    // User location (blue dot + halo)
    if(!map.getLayer('user-dot')){
      map.addLayer({id:'user-dot',type:'circle',source:userSrc,paint:{
        'circle-color':'#2563EB','circle-radius':6,'circle-stroke-color':'#FFFFFF','circle-stroke-width':2}});
      map.on('click','user-dot',(e)=>{const f=e.features&&e.features[0]; if(!f) return;
        const coord=f.geometry.coordinates; map.easeTo({center:coord,zoom:Math.max(map.getZoom(),15)}); post({type:'userClick',coordinates:coord});});
      map.on('mouseenter','user-dot',()=>map.getCanvas().style.cursor='pointer');
      map.on('mouseleave','user-dot',()=>map.getCanvas().style.cursor='');
    }
    if(!map.getLayer('user-halo')){
      map.addLayer({id:'user-halo',type:'circle',source:userSrc,paint:{
        'circle-color':'#60A5FA','circle-radius':12,'circle-opacity':0.25,'circle-stroke-width':0}});
      map.on('click','user-halo',(e)=>{const f=e.features&&e.features[0]; if(!f) return;
        const coord=f.geometry.coordinates; map.easeTo({center:coord,zoom:Math.max(map.getZoom(),15)}); post({type:'userClick',coordinates:coord});});
    }
  }

  function clearHtmlMarkers(){
    htmlMarkers.forEach(m => m.remove());
    htmlMarkers.clear();
  }

  function buildChip(text){
    const el = document.createElement('div');
    el.className = 'price-chip';
    el.textContent = text || '';
    return el;
  }

  function rebuildHtmlMarkers(){
    clearHtmlMarkers();
    const src = map.getSource(srcId);
    if(!src) return;
    const data = src._data || src._options?.data; // internal access to current data
    const features = (data && data.features) || [];
    for(const f of features){
      const id = String(f.properties.id);
      const chip = buildChip(f.properties.price || '');
      chip.addEventListener('mouseenter', (evt)=> {
        const rect = map.getCanvas().getBoundingClientRect();
        const x = (evt.clientX - rect.left);
        const y = (evt.clientY - rect.top);
        post({ type:'markerHover', id, lngLat: f.geometry.coordinates, point:{ x, y } });
      });
      chip.addEventListener('mouseleave', ()=> post({ type:'markerLeave' }));
      chip.addEventListener('click', ()=> {
        const coord = f.geometry.coordinates;
        map.easeTo({ center: coord, zoom: Math.max(map.getZoom(), markerZoom) });
        post({ type:'markerClick', id, lngLat: coord });
      });

      const marker = new mapboxgl.Marker({ element: chip, anchor: 'bottom' }).setLngLat(f.geometry.coordinates).addTo(map);
      htmlMarkers.set(id, marker);
    }
    updateChipVisibility();
  }

  function updateChipVisibility(){
    const show = map.getZoom() >= chipZoom;
    htmlMarkers.forEach((marker) => {
      const el = marker.getElement();
      el.style.display = show ? 'inline-block' : 'none';
    });
  }

  map.on('load', () => {
    ensureSources();
    ensureLayers();
    rebuildHtmlMarkers();
    post({ type:'ready' });
  });

  map.on('click', (e) => post({ type:'mapClick', lngLat:[e.lngLat.lng, e.lngLat.lat] }));

  // Region emit: continuous (throttled) + final on end
  let last = 0;
  const emit = (force=false) => {
    const now = Date.now();
    if (!force && now - last < 100) return;
    last = now;
    const c = map.getCenter();
    post({ type:'region', center:[c.lng,c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
  };
  ['move','zoom','rotate','pitch'].forEach(ev => map.on(ev, () => { emit(false); updateChipVisibility(); }));
  ['moveend','zoomend','rotateend','pitchend'].forEach(ev => map.on(ev, () => { emit(true); updateChipVisibility(); }));

  // Host -> iframe messages
  const handle=(raw)=>{ try{
    const m = JSON.parse(raw.data || raw);
    if(!m || typeof m !== 'object') return;
    if(m.type==='setView' && Array.isArray(m.center) && typeof m.zoom==='number'){
      map.easeTo({ center: m.center, zoom: m.zoom, duration: m.duration || 500 });
    }
    if(m.type==='setData'){
      const s = map.getSource(srcId);
      s && s.setData(toGeoJSON(m.features || []));
      rebuildHtmlMarkers();
    }
    if(m.type==='setUserLocation' && Array.isArray(m.coordinates)){
      const s = map.getSource(userSrc);
      s && s.setData({ type:'FeatureCollection', features:[{ type:'Feature', geometry:{ type:'Point', coordinates:m.coordinates }, properties:{} }] });
    }
  } catch{} };
  if(isRN) document.addEventListener('message',handle); else window.addEventListener('message',(e)=>handle(e));
})();</script></body></html>`;

const Map = React.forwardRef<{ navigateToLocation: (center: LonLat, zoom?: number) => void }, MapProps>(function Map(props, ref) {
    const {
        style,
        initialCoordinates = DEFAULT_CENTER,
        initialZoom = DEFAULT_ZOOM,
        styleURL = DEFAULT_STYLE,
        startFromCurrentLocation = true,
        markers = [],
        cluster,
        markerStyle,
        onMapPress,
        onRegionChange,
        onMarkerPress,
        renderMarkerHover,
    } = props;

    const [userCoord, setUserCoord] = useState<LonLat | null>(null);
    const [childReady, setChildReady] = useState(false);
    const pending = useRef<string[]>([]);
    const [hoverInfo, setHoverInfo] = useState<{ id: string; lngLat: LonLat; x: number; y: number } | null>(null);

    const markerStyleFinal = useMemo<Required<MarkerStyle>>(() => ({
        color: markerStyle?.color ?? '#111827',
        size: markerStyle?.size ?? 14,
        strokeColor: markerStyle?.strokeColor ?? '#FFFFFF',
        strokeWidth: markerStyle?.strokeWidth ?? 2,
        chipZoomThreshold: markerStyle?.chipZoomThreshold ?? 13,
        chipBg: markerStyle?.chipBg ?? '#111827',
        chipText: markerStyle?.chipText ?? '#FFFFFF',
        chipBorder: markerStyle?.chipBorder ?? 'rgba(0,0,0,0.15)',
        chipPaddingH: markerStyle?.chipPaddingH ?? 8,
        chipPaddingV: markerStyle?.chipPaddingV ?? 4,
        chipFontSize: markerStyle?.chipFontSize ?? 12,
        onMarkerZoom: markerStyle?.onMarkerZoom ?? 15.5,
    }), [markerStyle]);

    const clusterFinal = useMemo<Required<ClusterOptions>>(() => ({
        enabled: cluster?.enabled ?? true,
        radius: cluster?.radius ?? 60,
        maxZoom: cluster?.maxZoom ?? 14,
        color: cluster?.color ?? '#3B82F6',
        textColor: cluster?.textColor ?? '#FFFFFF'
    }), [cluster]);

    // Get user position once
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

    // Build static HTML once (do NOT depend on markers to avoid iframe reload)
    const html = useMemo(
        () =>
            buildHTML(
                MAPBOX_TOKEN,
                initialCoordinates,
                initialZoom,
                styleURL,
        /* initialData */[],
                markerStyleFinal,
                clusterFinal
            ),
        [initialCoordinates, initialZoom, styleURL, markerStyleFinal, clusterFinal]
    );

    const webviewRef = useRef<any>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const reallyPost = React.useCallback((str: string) => {
        if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage(str, '*');
        } else {
            webviewRef.current?.postMessage?.(str);
            webviewRef.current?.injectJavaScript?.(
                `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(str)}})); true;`
            );
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

    // Push markers whenever they change (queued until ready)
    useEffect(() => {
        post({ type: 'setData', features: markers });
    }, [markers, post]);

    // Push user location when known; also center view the first time
    const hasCenteredOnce = useRef(false);
    useEffect(() => {
        if (!userCoord) return;
        post({ type: 'setUserLocation', coordinates: userCoord });
        if (!hasCenteredOnce.current) {
            post({ type: 'setView', center: userCoord, zoom: Math.max(initialZoom, 14) });
            hasCenteredOnce.current = true;
        }
    }, [userCoord, post, initialZoom]);

    // Web messages (including ready + hover)
    useEffect(() => {
        if (Platform.OS !== 'web') return;
        const handler = (e: MessageEvent) => {
            if (typeof e.data !== 'string') return;
            try {
                const msg = JSON.parse(e.data) as MapEvent;
                if (msg.type === 'ready') { setChildReady(true); flushPending(); return; }
                if (msg.type === 'mapClick') onMapPress?.({ lngLat: msg.lngLat });
                if (msg.type === 'markerClick') onMarkerPress?.({ id: (msg as any).id, lngLat: msg.lngLat });
                if (msg.type === 'markerHover') {
                    const rect = containerRef.current?.getBoundingClientRect();
                    const x = (rect?.left ?? 0) + msg.point.x;
                    const y = (rect?.top ?? 0) + msg.point.y;
                    setHoverInfo({ id: (msg as any).id, lngLat: msg.lngLat, x, y });
                }
                if (msg.type === 'markerLeave') setHoverInfo(null);
                if (msg.type === 'region') onRegionChange?.({ center: msg.center, zoom: msg.zoom, bearing: msg.bearing, pitch: msg.pitch });
            } catch { }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [onMapPress, onMarkerPress, onRegionChange, flushPending]);

    // Native messages (including ready)
    const handleNativeMessage = (event: any) => {
        try {
            const msg = JSON.parse(event?.nativeEvent?.data || '{}') as MapEvent;
            if (msg.type === 'ready') { setChildReady(true); flushPending(); return; }
            if (msg.type === 'mapClick') onMapPress?.({ lngLat: msg.lngLat });
            if (msg.type === 'markerClick') onMarkerPress?.({ id: (msg as any).id, lngLat: msg.lngLat });
            if (msg.type === 'region') onRegionChange?.({ center: msg.center, zoom: msg.zoom, bearing: msg.bearing, pitch: msg.pitch });
        } catch { }
    };

    React.useImperativeHandle(ref, () => ({
        navigateToLocation: (center: LonLat, zoom: number = 15) => {
            post({ type: 'setView', center, zoom, duration: 500 });
        }
    }), [post]);

    if (Platform.OS === 'web') {
        return (
            <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', ...(style || {}) }}>
                <iframe
                    ref={iframeRef}
                    title="mapbox-map"
                    srcDoc={html}
                    style={{ border: '0', width: '100%', height: '100%' }}
                    sandbox="allow-scripts allow-same-origin"
                />
                {hoverInfo && renderMarkerHover && (
                    <div
                        style={{
                            position: 'fixed',
                            left: hoverInfo.x,
                            top: hoverInfo.y,
                            transform: 'translate(8px, -50%)',
                            pointerEvents: 'none',
                            zIndex: 10,
                        }}
                    >
                        {renderMarkerHover({ id: hoverInfo.id, lngLat: hoverInfo.lngLat })}
                    </div>
                )}
            </div>
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
            />
        </View>
    );
});

export default Map;
