/**
 * The native map document loads MapLibre from a CDN, at a version and with
 * hashes written as literals in `mapDocument.ts`. Nothing ties those literals
 * to the `maplibre-gl` the app installs — and for as long as nothing did, the
 * document stayed on 4.7.1 while every dependency audit looked only at
 * `package.json`. This is the tie.
 *
 * The CDN serves the npm tarball's files byte-for-byte, so the installed
 * package is the reference for each hash: a hash that does not match the
 * installed file would not match the CDN's either, and the WebView would load
 * no map at all.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { GOWAY_ANCHOR_LAYER_ID } from '@/components/gowayMap';
import { MAPLIBRE_INTEGRITY, MAPLIBRE_VERSION, buildMapDocument } from '@/components/mapDocument';

const packageJsonPath = require.resolve('maplibre-gl/package.json');
const installed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
const distDir = join(dirname(packageJsonPath), 'dist');

const sha384 = (bytes: Buffer): string =>
  `sha384-${createHash('sha384').update(bytes).digest('base64')}`;

const document = buildMapDocument({
  center: [2.1686, 41.3874],
  zoom: 12,
  style: 'https://goway.example/map/goway-light.json',
  anchorLayerId: GOWAY_ANCHOR_LAYER_ID,
  cluster: { enabled: true, radius: 50, maxZoom: 14 },
  paint: {
    surface: '#fff',
    border: '#e5e5e5',
    label: '#111',
    activeFill: '#111',
    activeLabel: '#fff',
    visitedFill: '#f5f5f5',
    visitedLabel: '#737373',
    ring: '#2563eb',
  },
  clusterLabel: 'Map cluster: %COUNT%',
  enableAddressLookup: false,
});

describe('the native map document', () => {
  it('loads the MapLibre version the app installs', () => {
    expect(MAPLIBRE_VERSION).toBe(installed.version);
  });

  it.each(Object.entries(MAPLIBRE_INTEGRITY))('pins %s to the installed bytes', (file, hash) => {
    expect(hash).toBe(sha384(readFileSync(join(distDir, file))));
  });

  it('puts every hash in the document it builds', () => {
    // A hash that is declared but never emitted checks nothing.
    for (const [file, hash] of Object.entries(MAPLIBRE_INTEGRITY)) {
      expect(document).toContain(`https://unpkg.com/maplibre-gl@${installed.version}/dist/${file}`);
      expect(document).toContain(hash);
    }
  });

  it('imports MapLibre as a module, since 6.x publishes no UMD bundle', () => {
    expect(document).toContain('<script type="module">import * as maplibregl from');
    expect(document).not.toMatch(/maplibre-gl\.js["']/);
  });

  it('declares the import map before the module that relies on it', () => {
    // An import map that appears after the first module script is ignored.
    const importMap = document.indexOf('<script type="importmap">');
    const moduleScript = document.indexOf('<script type="module">');
    expect(importMap).toBeGreaterThan(-1);
    expect(importMap).toBeLessThan(moduleScript);
  });

  it('inserts Homiio\u2019s layer at GoWay\u2019s anchor, not on top of the style', () => {
    // The anchor is a NAME GoWay publishes. The alternative an app without one
    // has to write is a scan for the first `symbol` layer, which silently picks
    // a different layer the next time the cartography moves.
    expect(document).toContain(JSON.stringify(GOWAY_ANCHOR_LAYER_ID));
    expect(document).toContain("map.addLayer({id:'markers-anchor'");
    expect(document).toContain('}, before);');
  });

  it('puts the marker source back when the style is swapped', () => {
    // `setStyle` replaces the whole style and takes every source and layer this
    // document added with it. Without a re-install bound to `styledata`, a
    // theme change leaves the map with no marker source, `querySourceFeatures`
    // returns nothing and every property pin disappears \u2014 no error anywhere.
    expect(document).toContain("map.on('styledata', ensureMarkers)");
    expect(document).toContain("map.on('idle', ensureMarkers)");
    expect(document).toContain("m.type==='setStyle'");
  });

  it('names no basemap vendor of its own', () => {
    // Everything a basemap needs \u2014 tiles, sprite, glyphs, attribution \u2014 is a
    // property of GoWay's style document now. A host named here would be a
    // second copy of a decision GoWay already made, and the one that rots.
    for (const host of ['tiles.openfreemap.org', 'openmaptiles.org', 'openstreetmap.org']) {
      expect(document).not.toContain(host);
    }
    expect(document).not.toContain('customAttribution');
  });
});

describe('the native WebView that hosts it', () => {
  it('gives the document a real origin, which a module worker needs', () => {
    // Without `baseUrl` the document is `about:blank`, an opaque origin, and
    // maplibre-gl 6's module worker cannot start there: no tile, no `ready`,
    // and no error anywhere.
    const nativeMap = readFileSync(join(__dirname, '..', 'components', 'Map.tsx'), 'utf8');
    expect(nativeMap).toContain('source={{ html, baseUrl: MAP_DOCUMENT_BASE_URL }}');
  });
});
