/**
 * The map's markers: which pills and cluster bubbles exist, where they sit and
 * what state they draw in.
 *
 * The rule with teeth is ADR 0003's. MapLibre hands source features back with
 * tile-quantised geometry, so a pin drawn from it would sit a few metres from
 * the coordinate the API published — a precision nobody chose. The fixtures
 * below give each tile feature geometry that DIFFERS from the published input,
 * so a pin drawn from the tile would fail rather than coincide.
 */
import { buildMapDocument, resolveMapMarkerPaint } from '@/components/mapDocument';
import {
  clusterOverlayState,
  collectOverlays,
  overlaySignature,
  pointOverlayState,
  type SourceFeatureLike,
} from '@/components/mapOverlays';
import type { MarkerInput } from '@/components/mapTypes';

const published: MarkerInput[] = [
  { id: 'a', coordinates: [2.17, 41.38], priceLabel: '1.200 €' },
  { id: 'b', coordinates: [2.18, 41.39], priceLabel: '950 €' },
];
const inputs = new Map(published.map((marker) => [marker.id, marker]));

const point = (id: string, coordinates: [number, number]): SourceFeatureLike => ({
  properties: { id, price: 'tile price' },
  geometry: { type: 'Point', coordinates },
});

const cluster = (clusterId: number, count: number): SourceFeatureLike => ({
  properties: { cluster: true, cluster_id: clusterId, point_count: count },
  geometry: { type: 'Point', coordinates: [2.2, 41.4] },
});

describe('collectOverlays', () => {
  it('places a point at its PUBLISHED coordinates, not the tile geometry', () => {
    const [overlay] = collectOverlays([point('a', [2.170004, 41.379996])], inputs);
    expect(overlay).toEqual({
      kind: 'point',
      key: 'p:a',
      id: 'a',
      price: '1.200 €',
      coordinates: [2.17, 41.38],
    });
  });

  it('skips a tile point with no published input instead of drawing it from the tile', () => {
    expect(collectOverlays([point('ghost', [2, 41])], inputs)).toEqual([]);
  });

  it('draws each point and cluster once, though the source repeats them per tile', () => {
    const overlays = collectOverlays(
      [point('a', [0, 0]), cluster(7, 3), point('a', [0, 0]), cluster(7, 3), point('b', [0, 0])],
      inputs,
    );
    expect(overlays.map((overlay) => overlay.key)).toEqual(['p:a', 'c:7', 'p:b']);
  });

  it('draws a cluster at its centroid with its count', () => {
    expect(collectOverlays([cluster(7, 12)], inputs)).toEqual([
      { kind: 'cluster', key: 'c:7', clusterId: 7, count: 12, coordinates: [2.2, 41.4] },
    ]);
  });
});

describe('overlaySignature', () => {
  it('changes when a price, a count or a cluster membership changes, and not otherwise', () => {
    const base = collectOverlays([point('a', [0, 0]), cluster(7, 3)], inputs);
    const withLeaves = base.map((overlay) => ({ ...overlay, leafIds: null }));
    expect(overlaySignature(withLeaves)).toBe(overlaySignature(base.map((o) => ({ ...o, leafIds: null }))));
    expect(overlaySignature(collectOverlays([point('a', [0, 0]), cluster(7, 4)], inputs))).not.toBe(
      overlaySignature(base),
    );
    expect(
      overlaySignature(base.map((o) => ({ ...o, leafIds: o.kind === 'cluster' ? ['a', 'b', 'c'] : null }))),
    ).not.toBe(overlaySignature(withLeaves));
  });
});

describe('marker states', () => {
  it('draws the highlighted listing active, a pressed-before one visited', () => {
    const visited = new Set(['b']);
    expect(pointOverlayState('a', 'a', visited)).toBe('active');
    expect(pointOverlayState('b', 'a', visited)).toBe('visited');
    expect(pointOverlayState('b', 'b', visited)).toBe('active');
    expect(pointOverlayState('c', null, visited)).toBe('default');
  });

  it('draws a cluster active when the highlighted listing is inside it', () => {
    expect(clusterOverlayState(['a', 'b'], 'b')).toBe('active');
    expect(clusterOverlayState(['a', 'b'], 'c')).toBe('default');
    expect(clusterOverlayState(null, 'a')).toBe('default');
    expect(clusterOverlayState(['a'], null)).toBe('default');
  });
});

describe('the native document draws the same markers', () => {
  const paint = resolveMapMarkerPaint({
    isDark: false,
    colors: {
      card: '#ffffff',
      background: '#fafafa',
      backgroundSecondary: '#f5f5f5',
      border: '#e5e5e5',
      text: '#171717',
      textSecondary: '#737373',
      primary: '#2563eb',
    },
  });
  const document = buildMapDocument({
    center: [2.1686, 41.3874],
    zoom: 12,
    style: 'https://tiles.example/style.json',
    cluster: { enabled: true, radius: 40, maxZoom: 17 },
    enableAddressLookup: false,
    paint,
    clusterLabel: 'Map cluster: %COUNT%. Zoom in to see each pin.',
  });

  it('inverts the active pill, as Bloom does', () => {
    expect(paint.activeFill).toBe('#171717');
    expect(paint.activeLabel).toBe('#ffffff');
  });

  it('positions a pin from the published input, never the tile geometry', () => {
    expect(document).toContain('makeMarker(key, \'hm-pill\', input.coordinates');
    expect(document).toContain('entry.marker.setLngLat(input.coordinates)');
  });

  it('writes listing text with textContent, never as markup', () => {
    expect(document).not.toContain('innerHTML');
  });

  it('carries the translated cluster name and the paint', () => {
    expect(document).toContain('Map cluster: %COUNT%. Zoom in to see each pin.');
    expect(document).toContain('--hm-active-fill:#171717');
  });

  it('cannot be broken out of its style block by a theme colour', () => {
    const hostile = buildMapDocument({
      center: [0, 0],
      zoom: 1,
      style: 'https://tiles.example/style.json',
      cluster: { enabled: true, radius: 40, maxZoom: 17 },
      enableAddressLookup: false,
      paint: { ...paint, surface: 'red;}</style><script>alert(1)</script>' },
      clusterLabel: '%COUNT%',
    });
    expect(hostile).not.toContain('</style><script>alert(1)');
  });
});
