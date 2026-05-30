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

export interface AddressData {
  street?: string;
  houseNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  fullAddress?: string;
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
  | { type: 'addressLookup'; address: AddressData; coordinates: LonLat }
  | { type: 'requestAddressLookup'; coordinates: LonLat }
  | {
      type: 'region';
      center: LonLat;
      zoom: number;
      bearing: number;
      pitch: number;
      bounds: { west: number; south: number; east: number; north: number };
      isFinal?: boolean; // true when a move/zoom gesture ends
    };

/** Commands the host sends down into the embedded document. */
export type OutboundMapMessage =
  | { type: 'setData'; features: MarkerInput[] }
  | { type: 'setView'; center: LonLat; zoom: number; duration?: number }
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
  highlightMarker: (id: string | null) => void;
  lookupAddress: (coordinates: LonLat) => Promise<AddressData | null>;
}
