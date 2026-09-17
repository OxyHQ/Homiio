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

import type { StyleSpecification } from 'maplibre-gl';
import type { ClusterOptions, LonLat } from './mapTypes';

/**
 * MapLibre GL JS — drop-in OSS fork of mapbox-gl, served keyless from unpkg.
 *
 * This document cannot import from the app bundle, so it loads its OWN copy of
 * MapLibre, and that copy's version is not the one in `package.json` unless
 * something makes it so: 4.7.1 stayed pinned here through every audit of the
 * npm dependency. `__tests__/mapDocument.test.ts` pins both — this version to
 * the installed package, and each hash below to the installed file's bytes —
 * so upgrading `maplibre-gl` fails the suite until this block is updated too.
 *
 * maplibre-gl 6 is ESM-only: the document imports `maplibre-gl.mjs` from a
 * module script, and that module imports `./maplibre-gl-shared.mjs`.
 */
export const MAPLIBRE_VERSION = '6.10.0';
const MAPLIBRE_DIST_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist`;

/**
 * Subresource-integrity hashes (sha384) of the CDN files the document loads,
 * keyed by their path under `dist/`. The stylesheet carries its hash on the
 * `<link>`; the two modules carry theirs in the import map's `integrity` table,
 * the only place a module imported BY another module can be given one.
 *
 * Browsers without import-map integrity (Chromium < 127, Safari < 18) ignore
 * that table and load the modules unchecked, as every version did before. The
 * worker MapLibre starts from `maplibre-gl-worker.mjs` has no integrity check
 * anywhere: a worker does not inherit the document's import map.
 */
export const MAPLIBRE_INTEGRITY = {
  'maplibre-gl.mjs': 'sha384-2g0hrGNSeleJsCzq4bdDa1QEBwj09vTce/Hf9TbggAsMv37hy9xmKfJfCfOojhyx',
  'maplibre-gl-shared.mjs': 'sha384-jw07Ono+c6G30wWc0ndm4f9k5wolLAdoHS5hC/WiNNVmg8Sfk4cJKfVGefVigjwA',
  'maplibre-gl.css': 'sha384-Q5Blg3vUVAlUKqIPJYz7wGnz40Vwrx4pVuFVicI73+8c/26Zr5hhckfuIiIUflLE',
} as const;

const MAPLIBRE_JS_URL = `${MAPLIBRE_DIST_URL}/maplibre-gl.mjs`;
const MAPLIBRE_SHARED_URL = `${MAPLIBRE_DIST_URL}/maplibre-gl-shared.mjs`;
const MAPLIBRE_CSS_URL = `${MAPLIBRE_DIST_URL}/maplibre-gl.css`;

const IMPORT_MAP = JSON.stringify({
  imports: {},
  integrity: {
    [MAPLIBRE_JS_URL]: MAPLIBRE_INTEGRITY['maplibre-gl.mjs'],
    [MAPLIBRE_SHARED_URL]: MAPLIBRE_INTEGRITY['maplibre-gl-shared.mjs'],
  },
});

/**
 * The origin the native WebView gives this document (`source.baseUrl`).
 *
 * Without a base URL react-native-webview loads the HTML as `about:blank`, an
 * OPAQUE origin, and an opaque-origin document cannot start a MODULE worker —
 * not even from a Blob it created itself. maplibre-gl 4 ran a classic Blob
 * worker, so that never mattered; maplibre-gl 6's worker is an ES module, and
 * in an opaque document it fails with no console error: the map never loads a
 * tile and never posts `ready`. (Measured in Chromium, the engine of Android's
 * WebView: a `type: 'module'` Blob worker errors from `about:blank` and starts
 * from an http(s) origin.)
 *
 * `.invalid` is reserved (RFC 2606) and can never resolve, so the document gets
 * a real, secure origin that is nobody's site: no cookies, storage or
 * permissions of a real host come with it, and nothing is fetched from it.
 */
export const MAP_DOCUMENT_BASE_URL = 'https://map.homiio.invalid/';

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
  /**
   * MapLibre style for the document. Normally a sanitized {@link
   * StyleSpecification} object (hardened by `sanitizeMapStyle` so the OpenFreeMap
   * liberty layers can't throw on null-numeric tile properties); falls back to
   * the bare style URL string when the host couldn't fetch/sanitize it.
   */
  style: string | StyleSpecification;
  cluster: Required<ClusterOptions>;
  enableAddressLookup: boolean;
  /** The marker colours the document opens with; `setPaint` replaces them live. */
  paint: MapMarkerPaint;
  /**
   * A cluster bubble's accessible name, translated by the host, with
   * {@link CLUSTER_COUNT_TOKEN} where the count goes.
   */
  clusterLabel: string;
}

/** Stands for the count in {@link MapDocumentOptions.clusterLabel}. */
export const CLUSTER_COUNT_TOKEN = '%COUNT%';

/**
 * The colours of the native pills and cluster bubbles.
 *
 * The web map mounts Bloom's `MapPriceMarker` and `MapClusterMarker` directly.
 * This document is a WebView program and cannot render a React component, so
 * it draws the same geometry from CSS (below) and takes its colours from the
 * host's Bloom theme. Bloom resolves its own marker paint from neutral ramps it
 * does not export (`map-marker/shared.ts`), so these are the nearest theme
 * roles rather than the identical stops — close in both modes, not exact.
 */
export interface MapMarkerPaint {
  surface: string;
  border: string;
  label: string;
  activeFill: string;
  activeLabel: string;
  visitedFill: string;
  visitedLabel: string;
  ring: string;
}

/** The subset of Bloom's `Theme` the paint is read from. */
interface MarkerPaintTheme {
  isDark: boolean;
  colors: {
    card: string;
    background: string;
    backgroundSecondary: string;
    border: string;
    text: string;
    textSecondary: string;
    primary: string;
  };
}

export function resolveMapMarkerPaint(theme: MarkerPaintTheme): MapMarkerPaint {
  const { colors } = theme;
  return {
    surface: colors.card,
    border: colors.border,
    label: colors.text,
    // Bloom's active pill is inverted: the text colour as the fill.
    activeFill: colors.text,
    activeLabel: theme.isDark ? colors.background : colors.card,
    visitedFill: colors.backgroundSecondary,
    visitedLabel: colors.textSecondary,
    ring: colors.primary,
  };
}

/** The CSS custom property each paint role is published under. */
const PAINT_VARS: Record<keyof MapMarkerPaint, string> = {
  surface: '--hm-surface',
  border: '--hm-border',
  label: '--hm-label',
  activeFill: '--hm-active-fill',
  activeLabel: '--hm-active-label',
  visitedFill: '--hm-visited-fill',
  visitedLabel: '--hm-visited-label',
  ring: '--hm-ring',
};

/** Bloom's `shadow-s` and `shadow-m` box shadows (`design-tokens/shadows.ts`). */
const SHADOW_S = '0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.10)';
const SHADOW_M = '0 4px 12px rgb(0 0 0 / 0.08), 0 2px 6px rgb(0 0 0 / 0.12)';

/**
 * Bloom's map-marker geometry, in CSS: a 28px full pill with 10px sides and a
 * hairline, 13/18 semibold tabular text (`body-2-semibold`), `shadow-s` at rest
 * and `shadow-m` inverted when active; a 36px round bubble for a cluster that
 * widens for a longer count. The values are Bloom's; the paint is the host's.
 */
const MARKER_CSS = `
  .hm-marker{box-sizing:border-box;display:flex;align-items:center;justify-content:center;margin:0;
    font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:18px;
    font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;
    -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
    border:1px solid var(${PAINT_VARS.border});background:var(${PAINT_VARS.surface});
    color:var(${PAINT_VARS.label});box-shadow:${SHADOW_S};outline:none}
  .hm-marker:focus-visible{outline:2px solid var(${PAINT_VARS.ring});outline-offset:2px}
  .hm-pill{height:28px;padding:0 10px;border-radius:14px}
  .hm-cluster{min-width:36px;height:36px;padding:0 8px;border-radius:18px}
  .hm-marker.is-visited{background:var(${PAINT_VARS.visitedFill});color:var(${PAINT_VARS.visitedLabel})}
  .hm-marker.is-active{background:var(${PAINT_VARS.activeFill});border-color:var(${PAINT_VARS.activeFill});
    color:var(${PAINT_VARS.activeLabel});box-shadow:${SHADOW_M}}`;

const paintDeclarations = (paint: MapMarkerPaint): string =>
  (Object.keys(PAINT_VARS) as (keyof MapMarkerPaint)[])
    // A colour is theme data; strip anything that could close the rule or the tag.
    .map((role) => `${PAINT_VARS[role]}:${String(paint[role]).replace(/[;{}<>]/g, '')}`)
    .join(';');

/** Native HTML document stylesheet: full-bleed container reset + the marker rules. */
const documentStyles = (paint: MapMarkerPaint): string => `
  :root{${paintDeclarations(paint)}}
  html,body,#map{height:100%;margin:0;padding:0}
  #map{position:absolute;inset:0}
${MARKER_CSS}`;

/**
 * Map bootstrap script. MapLibre is API-compatible with mapbox-gl, so the
 * source/camera logic is unchanged from the previous Mapbox implementation —
 * only the global (`maplibregl`) and the keyless style URL differ.
 *
 * Markers mirror `Map.web.tsx` and `mapOverlays.ts`: the clustered source is
 * read on every rendered frame, each unclustered point becomes a pill placed
 * at its PUBLISHED coordinates (never the tile-quantised geometry — ADR 0003),
 * and each cluster becomes a count bubble.
 */
const buildScript = (options: MapDocumentOptions): string => {
  const { center, zoom, style, cluster, enableAddressLookup, clusterLabel } = options;
  return `(function(){
  const isRN = !!window.ReactNativeWebView;
  const post = (msg)=>{const d=JSON.stringify(msg); if(isRN) window.ReactNativeWebView.postMessage(d); else window.parent&&window.parent.postMessage(d,'*');};
  const map=new maplibregl.Map({container:'map',style:${JSON.stringify(style)},center:${JSON.stringify(center)},zoom:${JSON.stringify(zoom)},attributionControl:false,hash:false});
  map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:${JSON.stringify(ATTRIBUTION)}}));

  // The OpenFreeMap liberty poi layers set icon-image to the OSM feature
  // class/subclass (e.g. office); many such names have no image in the sprite,
  // so MapLibre logs a missing-image error and fires styleimagemissing. Supply a
  // 1x1 transparent placeholder for any missing id (idempotent) so no POI class
  // can request a non-existent sprite image. Mirrors installMissingImageFallback
  // in mapStyle.ts for the native WebView document. A resolver, not a
  // styleimagemissing listener: since maplibre-gl 6 that event is notify-only.
  map.setMissingStyleImageResolver((missingId) => {
    if (!missingId || map.hasImage(missingId)) return;
    map.addImage(missingId, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
  });

  const toGeoJSON=(list)=>({type:'FeatureCollection',features:(Array.isArray(list)?list:[]).map(p=>({
    type:'Feature', id: p.id, geometry:{type:'Point',coordinates:p.coordinates},
    properties:{ id: String(p.id), price: String(p.priceLabel||'') }
  }))});

  const srcId='markers';
  // Mirrors mapTypes.PROGRAMMATIC_MOVE. See the note in emit() below.
  const PROGRAMMATIC_MOVE = { homiioProgrammatic: true };
  const cluster=${String(cluster.enabled)}, cRad=${cluster.radius}, cMax=${cluster.maxZoom};
  const clusterLabel=${JSON.stringify(clusterLabel)};
  const COUNT_TOKEN=${JSON.stringify(CLUSTER_COUNT_TOKEN)};
  const PAINT_VARS=${JSON.stringify(PAINT_VARS)};
  let highlightedId = null;
  const visitedIds = new Set();
  let selectedMarker = null;
  let loaded = false;

  // Published marker inputs by id: the only source of a pin's position.
  let inputs = new Map();
  // Resolved cluster members by cluster id; replaced with every data set.
  let leafCache = new Map();
  // DOM markers keyed 'p:<id>' or 'c:<clusterId>'.
  const overlays = new Map();

  const makeMarker = (key, className, coordinates, onPress) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'hm-marker ' + className;
    el.addEventListener('click', (event) => { event.stopPropagation(); onPress(); });
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coordinates).addTo(map);
    const entry = { marker: marker, el: el, kind: className, id: null, clusterId: null };
    overlays.set(key, entry);
    return entry;
  };

  const paintStates = () => {
    overlays.forEach((entry) => {
      let active = false;
      let visited = false;
      if (entry.kind === 'hm-pill') {
        active = highlightedId !== null && entry.id === highlightedId;
        visited = !active && visitedIds.has(entry.id);
      } else {
        const leaves = leafCache.get(entry.clusterId);
        active = highlightedId !== null && !!leaves && leaves.indexOf(highlightedId) !== -1;
      }
      entry.el.classList.toggle('is-active', active);
      entry.el.classList.toggle('is-visited', visited);
      entry.el.setAttribute('aria-pressed', active ? 'true' : 'false');
      entry.el.style.zIndex = active ? '2' : '';
    });
  };

  const expandCluster = (clusterId, coordinates) => {
    const s = map.getSource(srcId);
    if (!s) return;
    s.getClusterExpansionZoom(clusterId).then((z)=>{ map.easeTo({center: coordinates, zoom:z}, PROGRAMMATIC_MOVE); }).catch(()=>{});
    s.getClusterLeaves(clusterId, Infinity, 0).then((features) => {
      const leaves = [];
      features.forEach((f) => {
        const input = inputs.get(String(f.properties && f.properties.id));
        if (input) leaves.push({ geometry: { type: 'Point', coordinates: input.coordinates }, properties: { id: String(input.id), price: String(input.priceLabel || '') } });
      });
      post({ type: 'clusterClick', leaves: leaves });
    }).catch(()=>{});
  };

  const syncOverlays = () => {
    if (!loaded) return;
    const s = map.getSource(srcId);
    if (!s) return;
    const seen = new Set();
    map.querySourceFeatures(srcId).forEach((feature) => {
      const props = feature.properties || {};
      if (typeof props.cluster_id === 'number') {
        const clusterId = props.cluster_id;
        const key = 'c:' + clusterId;
        const coordinates = feature.geometry && feature.geometry.coordinates;
        if (seen.has(key) || !coordinates) return;
        seen.add(key);
        let entry = overlays.get(key);
        if (!entry) {
          entry = makeMarker(key, 'hm-cluster', coordinates, () => expandCluster(clusterId, coordinates));
          entry.clusterId = clusterId;
        } else {
          entry.marker.setLngLat(coordinates);
        }
        const count = String(props.point_count);
        if (entry.el.textContent !== count) entry.el.textContent = count;
        entry.el.setAttribute('aria-label', clusterLabel.split(COUNT_TOKEN).join(count));
        if (!leafCache.has(clusterId)) {
          const cache = leafCache;
          cache.set(clusterId, null);
          s.getClusterLeaves(clusterId, Infinity, 0).then((leaves) => {
            if (cache !== leafCache) return;
            cache.set(clusterId, leaves.map((l) => String(l.properties && l.properties.id)));
            paintStates();
          }).catch(() => { cache.delete(clusterId); });
        }
        return;
      }
      const id = String(props.id);
      const input = inputs.get(id);
      const key = 'p:' + id;
      if (!input || seen.has(key)) return;
      seen.add(key);
      let entry = overlays.get(key);
      if (!entry) {
        entry = makeMarker(key, 'hm-pill', input.coordinates, () => {
          visitedIds.add(id);
          post({ type: 'markerClick', id: id, lngLat: input.coordinates });
        });
        entry.id = id;
      } else {
        entry.marker.setLngLat(input.coordinates);
      }
      const price = String(input.priceLabel || '');
      if (entry.el.textContent !== price) entry.el.textContent = price;
      entry.el.setAttribute('aria-label', price);
    });

    overlays.forEach((entry, key) => {
      if (!seen.has(key)) {
        entry.marker.remove();
        overlays.delete(key);
      }
    });
    paintStates();
  };

  map.on('load', () => {
    map.addSource(srcId, {
        type:'geojson', data:toGeoJSON([]), cluster:cluster, clusterRadius:cRad, clusterMaxZoom:cMax, promoteId: 'id'
    });
    // Draws nothing: MapLibre loads a source's tiles only when a layer uses it,
    // and the markers are read from those tiles.
    map.addLayer({id:'markers-anchor',type:'circle',source:srcId,paint:{'circle-radius':0,'circle-opacity':0,'circle-stroke-width':0}});
    loaded = true;

    post({ type:'ready' });
  });

  map.on('render', syncOverlays);

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
  const emit = (force, ev) => {
    const now = Date.now();
    if (!force && now - last < 100) return;
    last = now;
    const c = map.getCenter();
    const b = map.getBounds();
    const boundsPayload = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    // Every camera command this document issues carries PROGRAMMATIC_MOVE, and
    // maplibre merges that object into the events it fires for the command. So
    // an unmarked event is a gesture. The key must stay identical to
    // mapTypes.PROGRAMMATIC_MOVE - the host cannot import into this template
    // literal, so the agreement is pinned by a test that reads this string.
    const source = (ev && ev.homiioProgrammatic === true) ? 'programmatic' : 'user';
    post({ type:'region', center:[c.lng,c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), bounds: boundsPayload, isFinal: force, source: source });
  };

  ['move','zoom','rotate','pitch'].forEach(ev => map.on(ev, (e) => { emit(false, e); }));
  ['moveend','zoomend','rotateend','pitchend'].forEach(ev => map.on(ev, (e) => { emit(true, e); }));

  const handle=(raw)=>{ try{
    const m = JSON.parse(raw.data || raw);
    if(!m || typeof m !== 'object') return;
    if(m.type==='setView'){
      if (m.duration === 0) {
        map.jumpTo({ center: m.center, zoom: m.zoom }, PROGRAMMATIC_MOVE);
      } else {
        map.easeTo({ center: m.center, zoom: m.zoom, duration: m.duration || 500 }, PROGRAMMATIC_MOVE);
      }
    }
    if(m.type==='fitBounds'){
      // bounds arrives already in MapLibre corner form, with a wrapping box's
      // east edge carried past 180 by mapCamera.toCameraBounds. No geography is
      // done here on purpose: this document is a template literal, not a
      // module, so it cannot be unit-tested and must not be where a rule lives.
      // (No backticks in this comment either — one would end the literal.)
      map.fitBounds(m.bounds, {
        padding: typeof m.padding === 'number' ? m.padding : 48,
        duration: typeof m.duration === 'number' ? m.duration : 500,
      }, PROGRAMMATIC_MOVE);
    }
    if(m.type==='setData'){
      const s = map.getSource(srcId);
      if (s) {
        const list = Array.isArray(m.features) ? m.features : [];
        inputs = new Map(list.map((p) => [String(p.id), p]));
        leafCache = new Map();
        s.setData(toGeoJSON(list));
        // The next rendered frame re-reads the source and redraws the markers.
        map.triggerRepaint();
      }
    }
    if(m.type==='highlightMarker'){
      highlightedId = m.id ? String(m.id) : null;
      paintStates();
    }
    if(m.type==='setPaint' && m.paint && typeof m.paint === 'object'){
      Object.keys(PAINT_VARS).forEach((role) => {
        const value = m.paint[role];
        if (typeof value === 'string') document.documentElement.style.setProperty(PAINT_VARS[role], value);
      });
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
<link href="${MAPLIBRE_CSS_URL}" rel="stylesheet" integrity="${MAPLIBRE_INTEGRITY['maplibre-gl.css']}" crossorigin="anonymous" />
<style>${documentStyles(options.paint)}</style>
<script type="importmap">${IMPORT_MAP}</script>
</head><body>
  <div id="map"></div>
<script type="module">import * as maplibregl from ${JSON.stringify(MAPLIBRE_JS_URL)};
${buildScript(options)}</script></body></html>`;
