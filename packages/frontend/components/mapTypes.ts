import type { GeoBounds, GeocodedAddress } from '@homiio/shared-types';

import type { CameraBounds } from './mapCamera';

/**
 * Shared map types used by `Map.tsx` (the React host) and `mapDocument.ts`
 * (the embedded HTML/GL document). Splitting them out keeps the document
 * builder decoupled from the component and avoids a circular import.
 */

/**
 * Coordinate type: [longitude, latitude] following the GeoJSON standard.
 * NOTE: this is the OPPOSITE of the common [latitude, longitude] format.
 */
export type LonLat = [number, number];

/**
 * Re-exported so map consumers have one import site for the map's own types.
 *
 * The DECLARATION lives in `@homiio/shared-types` and used to be duplicated
 * here, minus `coordinates` and `bbox` — so the backend sent a bounding box
 * this copy could not represent and no typechecker could see the loss
 * (ADR 0002 §9.2). This is the same type, not a second one.
 */
export type { GeocodedAddress } from '@homiio/shared-types';

/**
 * Who moved the camera.
 *
 * The distinction has to travel WITH the event because nothing downstream can
 * recover it: a viewport that arrived because the app framed a city and one the
 * user dragged there are the same four numbers. Without it, opening a search
 * arms "Search this area" against the area the search is already showing — the
 * button appears, unprompted, over results that already answer it.
 */
export type MapMoveSource = 'user' | 'programmatic';

/**
 * The marker every camera COMMAND carries, merged into the events MapLibre
 * fires for it (`easeTo`/`fitBounds`/`jumpTo`/`resize` all take `eventData`).
 *
 * Marking the commands rather than sniffing for a DOM `originalEvent` is the
 * safer direction of failure: an unmarked command reads as a user gesture, so a
 * camera call somebody forgets to mark shows a button that need not be there,
 * while the alternative — treating anything unrecognised as programmatic —
 * hides the button for good and looks like the feature was never built.
 */
export const PROGRAMMATIC_MOVE = { homiioProgrammatic: true } as const;

/** Read {@link PROGRAMMATIC_MOVE} back off an event of unknown shape. */
export function moveSourceOf(event: unknown): MapMoveSource {
  const marked = event as { homiioProgrammatic?: unknown } | null | undefined;
  return marked?.homiioProgrammatic === true ? 'programmatic' : 'user';
}

/** A clustered marker leaf as emitted by the document (GeoJSON-style feature). */
export interface ClusterLeaf {
  geometry?: { type: 'Point'; coordinates: LonLat };
  properties: { id: string; price: string };
}

export interface MarkerInput {
  id: string;
  coordinates: LonLat;
  priceLabel: string;
}

/** Events the embedded document posts up to the React host. */
export type MapEvent =
  | { type: 'ready' }
  | { type: 'mapClick'; lngLat: LonLat }
  | { type: 'markerClick'; id: string; lngLat: LonLat }
  | { type: 'clusterClick'; leaves: ClusterLeaf[] }
  | { type: 'addressLookup'; address: GeocodedAddress; coordinates: LonLat }
  | { type: 'requestAddressLookup'; coordinates: LonLat }
  | {
      type: 'region';
      center: LonLat;
      zoom: number;
      bearing: number;
      pitch: number;
      bounds: { west: number; south: number; east: number; north: number };
      isFinal?: boolean; // true when a move/zoom gesture ends
      /**
       * Whether a person moved the camera or the app did. Required, so a new
       * map adapter cannot omit it and leave every consumer guessing.
       */
      source: MapMoveSource;
    };

/** Commands the host sends down into the embedded document. */
export type OutboundMapMessage =
  | { type: 'setData'; features: MarkerInput[] }
  | { type: 'setView'; center: LonLat; zoom: number; duration?: number }
  /**
   * Frame an AREA rather than a point.
   *
   * `bounds` is already in MapLibre's `[[west, south], [east, north]]` corner
   * form and has already been carried past 180 when it wraps — see
   * `mapCamera.toCameraBounds`. The document does no geography of its own,
   * deliberately: the wrap is the kind of thing that must be decided once, and
   * the document is the one place a second copy could not be unit-tested.
   */
  | { type: 'fitBounds'; bounds: CameraBounds; padding?: number; duration?: number }
  | { type: 'setUserLocation'; coordinates: LonLat }
  | { type: 'highlightMarker'; id: string | null };

export interface ClusterOptions {
  enabled?: boolean;
  radius?: number;
  maxZoom?: number;
  color?: string;
  textColor?: string;
}

export interface MarkerStyle {
  /**
   * @deprecated The Airbnb-style price pill uses a fixed light-on-dark
   * palette baked into the marker stylesheet. Kept on the interface so
   * existing callers don't fail typecheck, but the values are no longer
   * applied. Restyle the pill in `mapDocument.ts` directly instead.
   */
  chipBg?: string;
  /**
   * @deprecated See `chipBg`.
   */
  chipText?: string;
  /** Zoom level the camera eases to when a marker is selected. */
  onMarkerZoom?: number;
}

export interface MapApi {
  navigateToLocation: (center: LonLat, zoom?: number) => void;
  /**
   * Frame a declared area, choosing the zoom from the box.
   *
   * The gap this closes (#395): with only `navigateToLocation`, a city and a
   * neighbourhood opened at an IDENTICAL zoom, because the caller could pass a
   * centre and nothing about the extent. ADR 0002 §6.3 has the map frame itself
   * from `location.bounds` in the server's echo, and half of that rule was
   * unimplementable without this.
   *
   * A box that wraps the antimeridian frames the strip it describes, not the
   * rest of the world — the conversion is `mapCamera.toCameraBounds` and it is
   * not the caller's problem.
   *
   * A DEGENERATE box (zero width or height) is not framed: fitting one drives
   * the zoom to maximum, so a city with a point-like extent would open at
   * building level. Those fall back to `navigateToLocation` at a sensible zoom.
   */
  fitBounds: (bounds: GeoBounds, options?: { padding?: number; duration?: number }) => void;
  highlightMarker: (id: string | null) => void;
  lookupAddress: (coordinates: LonLat) => Promise<GeocodedAddress | null>;
}
