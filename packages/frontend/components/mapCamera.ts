/**
 * Turning a {@link GeoBounds} into a MapLibre camera.
 *
 * This module is deliberately thin, and what it does NOT contain is the point:
 * the antimeridian arithmetic lives in `@homiio/shared-types` — `boundsCenter`
 * and `crossesAntimeridian` — which is where it was hoisted after four
 * production sites each computed it naively. Nothing here re-derives it, and a
 * caller that needs a centre should import the shared one rather than reach
 * through this module for it.
 *
 * What IS here is the one thing that belongs to MapLibre rather than to the
 * contract: MapLibre frames a box from a corner pair in a CONTINUOUS longitude
 * space, so a wrapping box must be handed to it with the east edge carried past
 * 180 rather than wrapped back into [-180, 180). That conversion has no meaning
 * outside a camera, so pushing it up into the shared package would be wrong —
 * and it is exactly as easy to get wrong as the midpoint was, so it lives in one
 * tested function rather than open-coded in two map implementations.
 */

import { crossesAntimeridian, type GeoBounds } from '@homiio/shared-types';

/** MapLibre's corner pair: `[[west, south], [east, north]]`. */
export type CameraBounds = [[number, number], [number, number]];

/**
 * A {@link GeoBounds} in the form MapLibre's `fitBounds` frames correctly.
 *
 * ## Why the naive reading is not a near miss
 *
 * ADR 0002 §9.3 probed this against PostGIS 3.5 rather than reasoning about it,
 * and the two columns of that table are **complements of each other**: for the
 * box `west 170, south -20, east -170, north -16`, every point inside the
 * intended 20-degree Pacific strip (Fiji at `178.44,-18.14`, Samoa at
 * `-172,-18`) is `t` under `::geography` and `f` under plain `geometry`, while
 * every point outside it (`0,-18`, `100,-18`, `-100,-18`) is exactly the
 * reverse. A camera that reads such a box naively does not land nearby — it
 * frames the rest of the world.
 *
 * Carrying the east edge past 180 expresses the wrap in the space MapLibre
 * works in: `[[170, -20], [190, -16]]` is a 20-degree span centred on 180,
 * which is the strip. Clamping the edges, or swapping the corners so that
 * `west < east`, both frame its complement.
 */
export function toCameraBounds(bounds: GeoBounds): CameraBounds {
  const east = crossesAntimeridian(bounds) ? bounds.east + 360 : bounds.east;
  return [
    [bounds.west, bounds.south],
    [east, bounds.north],
  ];
}

/**
 * Is this box degenerate — a point or a line rather than an area?
 *
 * `isValidBounds` accepts one deliberately: a zero-area box is a legitimate
 * query, not a malformed one. But it is not something to FIT. Asking MapLibre
 * to fit an infinitely small region drives the zoom to its maximum, so a city
 * whose stored extent happened to be point-like would open at building level —
 * which reads as bad data rather than as a camera that was asked the wrong
 * question.
 *
 * Callers fall back to framing the centre at a sensible zoom. The decision is
 * named here rather than inlined at both call sites so the two platforms cannot
 * disagree about what counts as degenerate.
 *
 * It reads the CAMERA form rather than the raw bounds, which is not a detail: a
 * box wrapping the globe back to its own start (`west 170 → east 170` the long
 * way) has equal raw edges and is emphatically not a point.
 */
export function isDegenerateBounds(bounds: GeoBounds): boolean {
  const [[west, south], [east, north]] = toCameraBounds(bounds);
  return west === east || south === north;
}
