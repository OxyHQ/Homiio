/**
 * Date-range formatting shared by the booking-style list cards.
 *
 * Reservations and exchange requests both render a check-in → check-out window
 * as `MMM d, yyyy → MMM d, yyyy`. They each carried their own `formatRange`
 * helper over `date-fns`; this centralises that one pattern.
 *
 * The dates are parsed with `parseISO` (the values are ISO strings from the
 * API). Either end being unparseable yields an empty string rather than
 * `"Invalid Date"`, matching the defensive guard the exchange card already had.
 */
import { format, parseISO } from 'date-fns';

/** Default date format for each end of the range (`Jun 1, 2026`). */
const DEFAULT_DATE_FORMAT = 'MMM d, yyyy';

/** Separator between the two dates (`start → end`). */
const RANGE_SEPARATOR = ' → ';

/**
 * Format an ISO start/end pair as `MMM d, yyyy → MMM d, yyyy`. Pass `fmt` to
 * change the per-date `date-fns` pattern. Returns `''` when either end fails to
 * parse.
 */
export function formatDateRange(
  start: string,
  end: string,
  fmt: string = DEFAULT_DATE_FORMAT,
): string {
  const startDate = parseISO(start);
  const endDate = parseISO(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return '';
  }
  return `${format(startDate, fmt)}${RANGE_SEPARATOR}${format(endDate, fmt)}`;
}
