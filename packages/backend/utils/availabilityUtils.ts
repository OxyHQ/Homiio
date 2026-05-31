/**
 * Availability / calendar-overlap utilities.
 *
 * A single, pure, typed home for the half-open interval overlap check shared by
 * the booking flows (reservations, exchanges). Half-open means a window is
 * `[start, end)`: the start instant is included, the end instant is excluded, so
 * two adjacent stays (one ending exactly when the next begins) do NOT collide.
 *
 * No mongoose, no Express, no side effects — just date math. The callers cast
 * their own documents into the small `DateWindow` shape before checking.
 */

/** A half-open date range `[start, end)`. */
export interface DateWindow {
  start: Date;
  end: Date;
}

/**
 * Two half-open intervals `[aStart, aEnd)` and `[bStart, bEnd)` overlap iff
 * `aStart < bEnd` AND `bStart < aEnd`.
 *
 * Invalid dates (NaN) never overlap, so a malformed window can never silently
 * block a valid request.
 */
export function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  const aS = aStart.getTime();
  const aE = aEnd.getTime();
  const bS = bStart.getTime();
  const bE = bEnd.getTime();
  if (Number.isNaN(aS) || Number.isNaN(aE) || Number.isNaN(bS) || Number.isNaN(bE)) {
    return false;
  }
  return aS < bE && bS < aE;
}

/**
 * Returns `true` if `window` overlaps ANY of the `existing` windows.
 * Used to reject a requested stay that collides with already-committed ones.
 */
export function hasConflict(window: DateWindow, existing: ReadonlyArray<DateWindow>): boolean {
  if (!Array.isArray(existing) || existing.length === 0) {
    return false;
  }
  for (const other of existing) {
    if (windowsOverlap(window.start, window.end, other.start, other.end)) {
      return true;
    }
  }
  return false;
}
