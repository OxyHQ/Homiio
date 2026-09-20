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

/**
 * Whether `timeZone` is an IANA zone this engine knows.
 *
 * `Intl.supportedValuesOf('timeZone')` would be the direct answer and is
 * deliberately not used: it is absent from several Hermes builds, so a check
 * written on it would be `undefined is not a function` on a device and a pass
 * everywhere it was tested. Constructing a formatter throws `RangeError` for an
 * unknown zone on every engine that implements `Intl` at all, which asks the
 * same question in a way that cannot degrade into a vacuous yes.
 */
export function isSupportedTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** A `HH:mm` clock time, 24-hour. */
const CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/** The civil fields `timeZone` shows at `instant`, read back as a UTC epoch. */
function civilFieldsAsUtc(instant: Date, timeZone: string): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);
  } catch {
    return null;
  }
  const field: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') field[part.type] = Number(part.value);
  }
  if (!Number.isFinite(field.year)) return null;
  // `hour12: false` renders midnight as 24 on some ICU versions, and 24:00 of a
  // day is 00:00 of that same day.
  return Date.UTC(
    field.year,
    field.month - 1,
    field.day,
    field.hour % 24,
    field.minute,
    field.second,
  );
}

/**
 * The instant at which `timeZone`'s wall clock reads `civilDate` `clockTime`.
 *
 * This is the conversion a viewing appointment needs, and the one
 * `new Date('2026-01-01T10:00')` silently gets wrong: with no zone suffix that
 * expression is parsed in whatever zone the PROCESS happens to run in, so one
 * string means a different moment on a developer's laptop and on an ECS task,
 * and a third moment again on the phone that renders it back.
 *
 * A zone's offset depends on the instant, and the instant is what is being
 * solved for, so it is found by iteration: guess with the offset in force at the
 * naive reading, correct with the offset in force at that guess, then VERIFY by
 * converting back.
 *
 * **A civil time that does not exist returns `null`.** On the spring-forward day
 * 02:30 is skipped entirely in `Europe/Madrid` — no instant reads 02:30 there —
 * and the verification is what detects it, rather than a table of transitions
 * this package would have to carry. Returning a nearby instant instead would
 * book an appointment for a time nobody chose. An AMBIGUOUS civil time, the hour
 * that repeats in autumn, resolves to the LATER of its two instants: that is
 * what the iteration converges on, measured rather than decreed, and either
 * answer is a real moment reading that clock.
 *
 * @param civilDate `YYYY-MM-DD`.
 * @param clockTime `HH:mm`, 24-hour.
 */
export function zonedCivilToInstant(
  civilDate: string,
  clockTime: string,
  timeZone: string,
): Date | null {
  const day = CIVIL_DATE_PATTERN.exec(civilDate);
  const clock = CLOCK_TIME_PATTERN.exec(clockTime);
  if (!day || !clock) return null;

  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return null;

  const wanted = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), hour, minute);
  if (!Number.isFinite(wanted)) return null;

  let guess = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    const reading = civilFieldsAsUtc(new Date(guess), timeZone);
    if (reading === null) return null;
    guess = wanted - (reading - guess);
  }

  const verify = civilFieldsAsUtc(new Date(guess), timeZone);
  if (verify === null || verify !== wanted) return null;
  return new Date(guess);
}

/** What a zone's wall clock reads at some instant. */
export interface ZonedCivilReading {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** `HH:mm`, 24-hour. */
  readonly time: string;
  /** Minutes since local midnight. */
  readonly minuteOfDay: number;
  /** `0` = Sunday, matching Postgres `extract(dow)` and `Date#getUTCDay`. */
  readonly weekday: number;
}

/** The wall-clock reading of `instant` in `timeZone`, or `null`. */
export function instantToZonedCivil(instant: Date, timeZone: string): ZonedCivilReading | null {
  if (Number.isNaN(instant.getTime())) return null;
  const reading = civilFieldsAsUtc(instant, timeZone);
  if (reading === null) return null;
  const asDate = new Date(reading);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return {
    date: `${asDate.getUTCFullYear()}-${pad(asDate.getUTCMonth() + 1)}-${pad(asDate.getUTCDate())}`,
    time: `${pad(asDate.getUTCHours())}:${pad(asDate.getUTCMinutes())}`,
    minuteOfDay: asDate.getUTCHours() * 60 + asDate.getUTCMinutes(),
    weekday: asDate.getUTCDay(),
  };
}
