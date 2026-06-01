/**
 * Self-contained HTML document for the embedded map.
 *
 * Rendered inside a `react-native-webview` on native and an `<iframe>` on
 * web, it boots a MapLibre GL JS map against OpenFreeMap tiles (both free,
 * no API key) and talks to the React host over `postMessage`.
 *
 * The host → document command protocol mirrors `OutboundMapMessage` in
 * `Map.tsx`; the document → host events mirror `MapEvent`. Keep the two in
 * sync when either side changes.
 */

import type {
  ClusterOptions,
  LonLat,
  MarkerStyle,
} from './mapTypes';

/** MapLibre GL JS — drop-in OSS fork of mapbox-gl, served keyless from unpkg. */
const MAPLIBRE_VERSION = '4.7.1';
const MAPLIBRE_JS_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_CSS_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;

/** Free, keyless OpenStreetMap-based vector style (positron/bright are alternates). */
export const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Attribution markup for the compact `AttributionControl`. Exported so the web
 * map (`Map.web.tsx`, which drives maplibre-gl directly without this HTML
 * document) renders the exact same OSM/OpenFreeMap credit.
 */
export const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>';

export interface MapDocumentOptions {
  center: LonLat;
  zoom: number;
  styleURL: string;
  markerStyle: Required<MarkerStyle>;
  cluster: Required<ClusterOptions>;
  enableAddressLookup: boolean;
}

/** CSS class applied to the Airbnb-style price bubble (shared web + native). */
export const PRICE_PILL_CLASS = 'homiio-price-pill';
/** Modifier toggled on the pill when its marker is the selected/highlighted one. */
export const PRICE_PILL_SELECTED_CLASS = 'is-selected';

/**
 * Pill-marker stylesheet. The Airbnb-style price bubble is a real DOM node
 * anchored by a MapLibre `Marker` so we get a rounded-pill shape, soft
 * shadow, and crisp typography that GL circle/symbol layers can't produce.
 *
 * Exported so the web map (`Map.web.tsx`) can inject the identical rules into
 * the document head — the bubbles look the same whether they live inside the
 * native WebView document or directly in the web app's DOM.
 */
export const PRICE_PILL_CSS = `
  .${PRICE_PILL_CLASS} {
    background: #ffffff;
    color: #1a1a1a;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 12px;
    border-radius: 9999px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06);
    white-space: nowrap;
    cursor: pointer;
    transition: transform 120ms ease-out, background 120ms ease-out, color 120ms ease-out;
    user-select: none;
    line-height: 18px;
  }
  .${PRICE_PILL_CLASS}:hover { transform: scale(1.05); }
  .${PRICE_PILL_CLASS}.${PRICE_PILL_SELECTED_CLASS} {
    background: #1a1a1a;
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28), 0 0 0 2px #ffffff;
  }`;

/** Native HTML document stylesheet: full-bleed container reset + the shared pill rules. */
const MARKER_STYLES = `
  html,body,#map{height:100%;margin:0;padding:0}
  #map{position:absolute;inset:0}
${PRICE_PILL_CSS}`;

/**
 * Map bootstrap script. MapLibre is API-compatible with mapbox-gl, so the
 * marker/cluster/source/camera logic is unchanged from the previous Mapbox
 * implementation — only the global (`maplibregl`) and the keyless style URL
 * differ.
 */
const buildScript = (options: MapDocumentOptions): string => {
  const { center, zoom, styleURL, cluster, enableAddressLookup } = options;
  return `(function(){
  const isRN = !!window.ReactNativeWebView;
  const post = (msg)=>{const d=JSON.stringify(msg); if(isRN) window.ReactNativeWebView.postMessage(d); else window.parent&&window.parent.postMessage(d,'*');};
  const map=new maplibregl.Map({container:'map',style:${JSON.stringify(styleURL)},center:${JSON.stringify(center)},zoom:${JSON.stringify(zoom)},attributionControl:false,hash:false});
  map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:${JSON.stringify(ATTRIBUTION)}}));

  const toGeoJSON=(list)=>({type:'FeatureCollection',features:(Array.isArray(list)?list:[]).map(p=>({
    type:'Feature', id: p.id, geometry:{type:'Point',coordinates:p.coordinates},
    properties:{ id: String(p.id), price: String(p.priceLabel||'') }
  }))});

  const srcId='markers';
  const cluster=${String(cluster.enabled)}, cRad=${cluster.radius}, cMax=${cluster.maxZoom};
  const cColor=${JSON.stringify(cluster.color)}, cText=${JSON.stringify(cluster.textColor)};
  let highlightedFeatureId = null;
  let selectedMarker = null;

  // Track DOM Marker instances keyed by feature id so we can:
  // (a) remove the ones that no longer exist after a setData,
  // (b) update existing ones in place rather than churning markers.
  const pillMarkers = new Map();

  const renderPillMarkers = (featureCollection) => {
    const seenIds = new Set();
    (featureCollection.features || []).forEach((feature) => {
      const id = feature.properties.id;
      seenIds.add(id);

      const existing = pillMarkers.get(id);
      if (existing) {
        existing.setLngLat(feature.geometry.coordinates);
        const label = existing.getElement().firstChild;
        if (label && label.textContent !== feature.properties.price) {
          label.textContent = feature.properties.price;
        }
        return;
      }

      const wrapper = document.createElement('div');
      const pill = document.createElement('div');
      pill.className = 'homiio-price-pill';
      pill.textContent = feature.properties.price || '';
      pill.addEventListener('click', (event) => {
        event.stopPropagation();
        post({ type: 'markerClick', id: id, lngLat: feature.geometry.coordinates });
      });
      wrapper.appendChild(pill);

      const marker = new maplibregl.Marker({ element: wrapper, anchor: 'center' })
        .setLngLat(feature.geometry.coordinates)
        .addTo(map);
      pillMarkers.set(id, marker);
    });

    // Reap markers that are no longer in the source.
    pillMarkers.forEach((marker, id) => {
      if (!seenIds.has(id)) {
        marker.remove();
        pillMarkers.delete(id);
      }
    });

    // Re-apply highlight after re-render in case the highlighted id
    // was removed and added back in the same setData call.
    if (highlightedFeatureId) {
      const target = pillMarkers.get(String(highlightedFeatureId));
      if (target) {
        target.getElement().firstChild.classList.add('is-selected');
      }
    }
  };

  map.on('load', () => {
    map.addSource(srcId, {
        type:'geojson', data:toGeoJSON([]), cluster:cluster, clusterRadius:cRad, clusterMaxZoom:cMax, promoteId: 'id'
    });

    if(cluster){
      map.addLayer({id:'clusters',type:'circle',source:srcId,filter:['has','point_count'],paint:{
        'circle-color':cColor,'circle-radius':['step',['get','point_count'],16,20,18,50,22],
        'circle-stroke-color':'#FFFFFF','circle-stroke-width':2}});
      map.addLayer({id:'cluster-count',type:'symbol',source:srcId,filter:['has','point_count'],layout:{
        'text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Bold'],'text-size':12},paint:{'text-color':cText}});
    }

    map.on('click','clusters',(e)=>{
      const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
      if (!features.length) return;
      const clusterId = features[0].properties.cluster_id;
      map.getSource(srcId).getClusterExpansionZoom(clusterId).then((z)=>{ map.easeTo({center: features[0].geometry.coordinates, zoom:z}); }).catch(()=>{});
    });

    map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

    post({ type:'ready' });
  });

  map.on('click', (e) => {
    const coordinates = e.lngLat.toArray();
    post({ type: 'mapClick', lngLat: coordinates });

    if (${enableAddressLookup}) {
      if (selectedMarker) {
        selectedMarker.remove();
      }

      selectedMarker = new maplibregl.Marker({ color: '#007AFF' })
        .setLngLat(coordinates)
        .addTo(map);

      // Request address lookup from the React Native side
      post({ type: 'requestAddressLookup', coordinates: coordinates });
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
    post({ type:'region', center:[c.lng,c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), bounds: boundsPayload, isFinal: force });
  };

  ['move','zoom','rotate','pitch'].forEach(ev => map.on(ev, () => { emit(false); }));
  ['moveend','zoomend','rotateend','pitchend'].forEach(ev => map.on(ev, () => { emit(true); }));

  const handle=(raw)=>{ try{
    const m = JSON.parse(raw.data || raw);
    if(!m || typeof m !== 'object') return;
    if(m.type==='setView'){
      if (m.duration === 0) {
        map.jumpTo({ center: m.center, zoom: m.zoom });
      } else {
        map.easeTo({ center: m.center, zoom: m.zoom, duration: m.duration || 500 });
      }
    }
    if(m.type==='setData'){
      const s = map.getSource(srcId);
      if (s) {
        const geoJSON = toGeoJSON(m.features || []);
        s.setData(geoJSON);
        // The clustered points render as GL circles via the layer above, but
        // the unclustered ones are bubble DOM markers — keep those in sync
        // with the new feature set on every update.
        renderPillMarkers({ features: (m.features || []).map(p => ({
          properties: { id: String(p.id), price: String(p.priceLabel || '') },
          geometry: { coordinates: p.coordinates }
        })) });
      }
    }
    if(m.type==='highlightMarker'){
        if (highlightedFeatureId) {
            const prev = pillMarkers.get(String(highlightedFeatureId));
            if (prev) prev.getElement().firstChild.classList.remove('is-selected');
        }
        if (m.id) {
            const next = pillMarkers.get(String(m.id));
            if (next) next.getElement().firstChild.classList.add('is-selected');
            highlightedFeatureId = m.id;
        } else {
            highlightedFeatureId = null;
        }
    }
  } catch(err){ console.error('[Map] message handler failed', err); } };
  if(isRN) document.addEventListener('message',handle); else window.addEventListener('message',(e)=>handle(e));
})();`;
};

/** Build the full map HTML document for the given options. */
export const buildMapDocument = (options: MapDocumentOptions): string =>
  `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="${MAPLIBRE_CSS_URL}" rel="stylesheet" />
<style>${MARKER_STYLES}</style>
</head><body>
  <div id="map"></div>
<script src="${MAPLIBRE_JS_URL}"></script>
<script>${buildScript(options)}</script></body></html>`;
