/**
 * Date and time formatting.
 *
 * The distinction this module exists to keep is between a **civil date** and an
 * **instant**, because the two look identical in a database column and behave
 * completely differently when rendered.
 *
 *  - A **civil date** (`2026-03-29`) is a calendar day with no time and no zone:
 *    a lease start, an eviction hearing's date, an "available from". It must
 *    render as that day in every timezone on earth. Passing `'2026-03-29'` to
 *    `new Date()` parses it as UTC MIDNIGHT, so anywhere west of Greenwich it
 *    renders as the 28th — a lease that starts a day early, silently, for the
 *    entire American continent.
 *  - An **instant** (`2026-03-29T01:30:00Z`) is a moment; which calendar day and
 *    clock time it lands on genuinely depends on the zone it is read in. A
 *    viewing at 23:30 UTC is Sunday in Tokyo and Saturday in New York, and both
 *    are correct.
 *
 * `formatDate` tells them apart by SHAPE — a bare `YYYY-MM-DD` is a civil date
 * and is rendered in UTC regardless of the `timeZone` argument, so its day
 * cannot shift; anything else is an instant and is rendered in the zone the
 * caller names. The `timeZone` argument is required rather than defaulted so
 * that "render this in the device's zone" is a decision somebody wrote down —
 * {@link deviceTimeZone} makes it one line.
 *
 * When an instant is rendered in a zone that may not be the event's own, pass
 * `{ timeZoneName: 'short' }` so the reader can see which clock they are being
 * shown; issue #357 requires a booking or viewing never to change day silently.
 */

/** Anything this module accepts as a point in time. */
export type DateInput = Date | number | string;

/** A bare calendar day with no time and no zone: `YYYY-MM-DD`. */
const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Formatting options, minus the zone — that is a separate, required argument. */
export type DateFormatOptions = Omit<Intl.DateTimeFormatOptions, 'timeZone'>;

/** Default rendering: a medium-length date, no time (`29 mar 2026`). */
const DEFAULT_DATE_OPTIONS: DateFormatOptions = { dateStyle: 'medium' };

/** Separator between the two ends of a formatted date range. */
const RANGE_SEPARATOR = ' – ';

/** Milliseconds in a second, minute, hour and day. */
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Beyond this distance a relative phrase stops being useful ("in 47 days") and
 * {@link formatRelativeDate} falls back to the absolute date instead.
 */
const DEFAULT_ABSOLUTE_AFTER_MS = 7 * MS_PER_DAY;

/** Whether `value` is a bare `YYYY-MM-DD` civil date rather than an instant. */
export function isCivilDate(value: unknown): value is string {
  return typeof value === 'string' && CIVIL_DATE_PATTERN.test(value);
}

/** The IANA zone this device is in, or `UTC` when the engine will not say. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The instant and the zone `value` should be rendered in.
 *
 * A civil date is pinned to UTC midnight AND forced to render in UTC, which is
 * what keeps its calendar fields intact everywhere. Everything else keeps the
 * caller's zone. `null` means the value is unparseable.
 */
function resolveInstant(
  value: DateInput,
  timeZone: string,
): { date: Date; timeZone: string } | null {
  if (typeof value === 'string') {
    const civil = CIVIL_DATE_PATTERN.exec(value);
    if (civil) {
      const utc = Date.UTC(Number(civil[1]), Number(civil[2]) - 1, Number(civil[3]));
      return { date: new Date(utc), timeZone: 'UTC' };
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : { date, timeZone };
}

/**
 * Format a date or instant for `locale`, in `timeZone`.
 *
 * Returns `''` for an unparseable value rather than the string `"Invalid Date"`,
 * matching the defensive behaviour the booking cards already relied on. A
 * malformed locale or zone degrades to the runtime default rather than throwing
 * out of a render.
 */
export function formatDate(
  value: DateInput,
  locale: string,
  timeZone: string,
  options: DateFormatOptions = DEFAULT_DATE_OPTIONS,
): string {
  const resolved = resolveInstant(value, timeZone);
  if (!resolved) return '';

  // Ordered from "exactly what was asked for" to "something legible", each rung
  // giving up the least it can. The zone survives two of the three rungs and is
  // only replaced by UTC when the zone ITSELF is what `Intl` rejected — never
  // silently swapped for the device's, which would reintroduce the day shift.
  const attempts: [string | undefined, Intl.DateTimeFormatOptions][] = [
    [locale, { ...options, timeZone: resolved.timeZone }],
    [undefined, { ...options, timeZone: resolved.timeZone }],
    [undefined, { ...DEFAULT_DATE_OPTIONS, timeZone: resolved.timeZone }],
    [undefined, { ...DEFAULT_DATE_OPTIONS, timeZone: 'UTC' }],
  ];
  for (const [attemptLocale, attemptOptions] of attempts) {
    try {
      return new Intl.DateTimeFormat(attemptLocale, attemptOptions).format(resolved.date);
    } catch {
      // Try the next, less demanding rung.
    }
  }
  return '';
}

/**
 * Format a start → end window (check-in/check-out, an exchange stay, a lease
 * term).
 *
 * Either end being unparseable yields `''` — a half-rendered range is worse than
 * none, and this matches what the booking cards did before centralisation.
 */
export function formatDateRange(
  start: DateInput,
  end: DateInput,
  locale: string,
  timeZone: string,
  options: DateFormatOptions = DEFAULT_DATE_OPTIONS,
): string {
  const startText = formatDate(start, locale, timeZone, options);
  const endText = formatDate(end, locale, timeZone, options);
  if (!startText || !endText) return '';
  return `${startText}${RANGE_SEPARATOR}${endText}`;
}

/** Options accepted by {@link formatRelativeDate}. */
export interface FormatRelativeOptions {
  /** Zone for the absolute fallback. Defaults to {@link deviceTimeZone}. */
  timeZone?: string;
  /** Distance past which the absolute date is shown instead. */
  absoluteAfterMs?: number;
  /** Options for the absolute fallback. */
  absoluteOptions?: DateFormatOptions;
}

/** The largest relative unit that fits `deltaMs`, with the value in that unit. */
function relativeParts(deltaMs: number): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const magnitude = Math.abs(deltaMs);
  if (magnitude < MS_PER_MINUTE) {
    return { value: Math.round(deltaMs / MS_PER_SECOND), unit: 'second' };
  }
  if (magnitude < MS_PER_HOUR) {
    return { value: Math.round(deltaMs / MS_PER_MINUTE), unit: 'minute' };
  }
  if (magnitude < MS_PER_DAY) {
    return { value: Math.round(deltaMs / MS_PER_HOUR), unit: 'hour' };
  }
  return { value: Math.round(deltaMs / MS_PER_DAY), unit: 'day' };
}

/**
 * A relative phrase ("in 3 days", "hace 5 minutos") with an absolute fallback.
 *
 * The fallback fires in three cases, all required by issue #357: the value is
 * further away than `absoluteAfterMs` (a relative phrase stops helping), the
 * engine has no `Intl.RelativeTimeFormat` (Hermes builds vary), or the value is
 * a civil date more than a day out — a calendar day is better named than
 * counted. An unparseable value yields `''`.
 */
export function formatRelativeDate(
  value: DateInput,
  locale: string,
  now: Date = new Date(),
  options: FormatRelativeOptions = {},
): string {
  const timeZone = options.timeZone ?? deviceTimeZone();
  const resolved = resolveInstant(value, timeZone);
  if (!resolved) return '';

  const absolute = (): string =>
    formatDate(value, locale, timeZone, options.absoluteOptions ?? DEFAULT_DATE_OPTIONS);

  const deltaMs = resolved.date.getTime() - now.getTime();
  if (Math.abs(deltaMs) >= (options.absoluteAfterMs ?? DEFAULT_ABSOLUTE_AFTER_MS)) {
    return absolute();
  }
  if (typeof Intl.RelativeTimeFormat !== 'function') return absolute();

  const { value: amount, unit } = relativeParts(deltaMs);
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(amount, unit);
  } catch {
    try {
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit);
    } catch {
      return absolute();
    }
  }
}
