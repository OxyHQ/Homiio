/**
 * Where Homiio's maps open, and the zooms they frame a point at.
 *
 * The maps themselves are `@goway.to/maps` (GoWay's maps SDK): `MapView`,
 * `Markers`, the camera by value. This module is the little that is Homiio's.
 */
import type { MapViewport } from '@goway.to/maps';

/** A map with nothing of its own to frame opens on Barcelona, at city zoom. */
export const HOMIIO_OPENING_VIEW: MapViewport = {
  latitude: 41.38723,
  longitude: 2.16538,
  zoom: 12,
};

/** The zoom a map frames the device's position at: the reader's streets. */
export const DEVICE_ZOOM = 14;

/** The zoom a map frames one address at: its block. */
export const ADDRESS_ZOOM = 15;
