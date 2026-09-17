/**
 * What the map draws over its canvas, decided without a map.
 *
 * Both adapters draw their markers as DOM nodes anchored by MapLibre `Marker`s:
 * the web one mounts Bloom's `MapPriceMarker` / `MapClusterMarker` into them,
 * the native WebView document (a template literal, see `mapDocument.ts`) builds
 * the same pills from CSS. Which pills and bubbles exist is read off the
 * clustered GeoJSON source — this module is that reading, kept pure so the
 * rules in it have tests.
 *
 * ## A pin sits where the API put it (ADR 0003)
 *
 * `querySourceFeatures` hands back tile geometry, which MapLibre has QUANTISED
 * to the tile grid. Drawing a pin from it would move a published coordinate by
 * a few metres in an arbitrary direction — neither the precision the API chose
 * nor an honest blur. A point's position is therefore always the
 * `MarkerInput.coordinates` it arrived with, looked up by id; the tile feature
 * only says THAT the point is currently unclustered. A cluster has no published
 * position of its own, so its centroid is the only place it can be drawn.
 */
import type { MapMarkerState } from '@oxy.so/bloom/map-marker';

import type { LonLat, MarkerInput } from './mapTypes';

/** The slice of a MapLibre source feature this module reads. */
export interface SourceFeatureLike {
  properties?: Record<string, unknown> | null;
  geometry: { type: string; coordinates?: unknown };
}

export type OverlayDescriptor =
  | { kind: 'point'; key: string; id: string; price: string; coordinates: LonLat }
  | {
      kind: 'cluster';
      key: string;
      clusterId: number;
      count: number;
      coordinates: LonLat;
    };

/** A descriptor bound to the DOM node its marker is mounted into. */
export type OverlayItem<E = HTMLElement> = OverlayDescriptor & {
  element: E;
  /** A cluster's member ids once resolved; `null` while unknown. Always `null` for a point. */
  leafIds: readonly string[] | null;
};

export const pointOverlayKey = (id: string): string => `p:${id}`;
export const clusterOverlayKey = (clusterId: number): string => `c:${clusterId}`;

const toLonLat = (value: unknown): LonLat | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lng, lat] = value;
  return typeof lng === 'number' && typeof lat === 'number' ? [lng, lat] : null;
};

/**
 * Turn the source's current features into one overlay per point or cluster.
 *
 * `querySourceFeatures` returns a feature once per TILE it appears in, so the
 * same point or cluster can arrive several times; the first one wins. A point
 * whose id is not in `inputs` is skipped rather than drawn from tile geometry
 * (see the module header).
 */
export function collectOverlays(
  features: readonly SourceFeatureLike[],
  inputs: ReadonlyMap<string, MarkerInput>,
): OverlayDescriptor[] {
  const seen = new Set<string>();
  const out: OverlayDescriptor[] = [];
  for (const feature of features) {
    const props = feature.properties ?? {};
    const clusterId = props.cluster_id;
    if (typeof clusterId === 'number') {
      const key = clusterOverlayKey(clusterId);
      const coordinates = toLonLat(feature.geometry.coordinates);
      const count = Number(props.point_count);
      if (seen.has(key) || !coordinates || !Number.isFinite(count)) continue;
      seen.add(key);
      out.push({ kind: 'cluster', key, clusterId, count, coordinates });
      continue;
    }
    const id = props.id == null ? '' : String(props.id);
    const input = id ? inputs.get(id) : undefined;
    const key = pointOverlayKey(id);
    if (!input || seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'point',
      key,
      id,
      price: input.priceLabel,
      coordinates: input.coordinates,
    });
  }
  return out;
}

/**
 * Whether two overlay sets draw the same thing.
 *
 * The web adapter re-reads the source on every rendered frame; this is what
 * keeps a pan from re-rendering React when nothing entered or left the view.
 */
export function overlaySignature(items: readonly (OverlayDescriptor & { leafIds?: readonly string[] | null })[]): string {
  return items
    .map((item) =>
      item.kind === 'point'
        ? `${item.key}|${item.price}`
        : `${item.key}|${item.count}|${item.leafIds ? item.leafIds.length : '-'}`,
    )
    .join('\n');
}

/**
 * A price pill's state: the highlighted listing is `active` (a pressed pin or a
 * hovered result card), one the reader has opened before is `visited`.
 */
export function pointOverlayState(
  id: string,
  activeId: string | null,
  visited: ReadonlySet<string>,
): MapMarkerState {
  if (activeId !== null && id === activeId) return 'active';
  return visited.has(id) ? 'visited' : 'default';
}

/**
 * A cluster is `active` when the highlighted listing is inside it — so hovering
 * a result card whose pin is clustered still shows the reader where it is.
 */
export function clusterOverlayState(
  leafIds: readonly string[] | null,
  activeId: string | null,
): MapMarkerState {
  return activeId !== null && leafIds !== null && leafIds.includes(activeId) ? 'active' : 'default';
}
