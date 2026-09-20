/**
 * Viewings: the slots an owner offers, and what a visit actually is
 * (#518 §7.5, #519 §7.5).
 *
 * The epic asks for *"visitas con huecos reales, timezone, modalidad,
 * solicitudes persistidas y respuesta del propietario"*. Requests already
 * persist. This module holds the vocabulary of the other four, shared so the
 * screen that OFFERS a slot and the server that ACCEPTS one cannot hold
 * different ideas of what was offered.
 *
 * ## Recurring weekly windows, not one-off exceptions
 *
 * An owner says "Tuesdays and Thursdays, 17:00–20:00, half-hour visits" once,
 * and it keeps being true. The alternative — a row per concrete date — was
 * rejected for three reasons and the third is the one that decided it:
 *
 *  1. it makes availability a chore that expires, so a calendar left alone for
 *     a fortnight silently becomes "no viewings" and the listing stops being
 *     visitable with nothing to notice;
 *  2. it has no answer for "the next four months" without writing 120 rows;
 *  3. **the two models are not complementary, they are rivals.** With both, a
 *     slot exists if a recurrence offers it and no exception withdraws it —
 *     which is a second source of truth for one question, and the bug it
 *     produces (an exception nobody can see on the weekly grid) is invisible
 *     until somebody turns up at a locked door. One model, so there is one
 *     answer.
 *
 * What a recurrence cannot say is "not this Thursday, I'm away". That is a real
 * gap and it is left OPEN rather than half-built: the honest workaround today is
 * that the owner declines the request, in words, which is what
 * `viewing_requests.owner_response` is for.
 *
 * ## Minutes from local midnight, not a `time` column
 *
 * A window is `[startMinute, endMinute)` in the PROPERTY's zone. Minutes rather
 * than `time`, because every operation this domain performs on them is
 * arithmetic — carve a window into slots, check a request lands on one, refuse
 * a window shorter than its own slot — and because a `time` column arrives in
 * JavaScript as the string `'17:00:00'`, which every one of those operations
 * would have to parse first. The bounds are then plain integer CHECKs.
 *
 * ## The modality is on the WINDOW as well as on the request
 *
 * "Tuesday evenings I can only do video" is a normal thing to mean, and an
 * owner who can do both on a Tuesday evening declares two windows. One tuple
 * ({@link VIEWING_MODALITIES}) serves both tables, so a third value can never
 * mean one thing on a window and another on a request.
 */

/** In person, or over video. A closed set; there is no "either". */
export const VIEWING_MODALITIES = ['in_person', 'video'] as const;

/** How a viewing happens. */
export type ViewingModality = (typeof VIEWING_MODALITIES)[number];

/** Whether `value` is a declared modality. */
export function isViewingModality(value: unknown): value is ViewingModality {
  return typeof value === 'string' && (VIEWING_MODALITIES as readonly string[]).includes(value);
}

/** Minutes in a day. A window's `endMinute` may equal it; its start may not. */
export const MINUTES_PER_DAY = 1440;

/**
 * How long one viewing takes, in minutes.
 *
 * The ceiling is not decoration: it is what makes the overlap query's index
 * bound CORRECT rather than a guess. A conflict search can only stop looking
 * backwards from a candidate instant once it knows no appointment can run
 * longer than this, and the CHECK constraint is what lets it know. Raising it
 * means widening that scan, and lowering it needs a data migration — neither is
 * a free edit, which is why the number lives here beside the reason.
 */
export const MIN_VIEWING_DURATION_MINUTES = 10;
/** See {@link MIN_VIEWING_DURATION_MINUTES}. */
export const MAX_VIEWING_DURATION_MINUTES = 240;
/**
 * What a viewing lasts when nobody said.
 *
 * Applies to a request made against a listing whose owner has published no
 * schedule — the free-form path, where there is no window to take a length
 * from. A request that lands on a published slot takes the window's own
 * `slotMinutes` instead, copied onto the row so that editing the schedule
 * afterwards cannot retroactively change how long an agreed appointment is.
 */
export const DEFAULT_VIEWING_DURATION_MINUTES = 30;

/**
 * How far ahead a published slot must be before it is offered.
 *
 * An owner has to be able to answer. A slot four minutes from now is not an
 * appointment anybody can keep, and offering it would make the listing look
 * more available than it is — which is the same lie as the hardcoded slot list
 * this domain exists to replace, told at a finer grain.
 *
 * It bounds only what is OFFERED. The free-form path — a listing whose owner
 * has published no schedule at all — keeps its own weaker rule ("in the
 * future"), because there is no window there to take a notice period from and
 * inventing one would refuse requests nobody has said are unwelcome.
 */
export const VIEWING_MINIMUM_NOTICE_MINUTES = 60;

/** How many days of slots the availability endpoint answers by default. */
export const VIEWING_HORIZON_DEFAULT_DAYS = 14;
/** The most it will answer, however many the caller asks for. */
export const VIEWING_HORIZON_MAX_DAYS = 60;
/** The most windows one listing may carry — a week of half-hour bands, twice. */
export const VIEWING_WINDOWS_MAX = 60;

/** `0` = Sunday, matching Postgres `extract(dow)` and `Date#getUTCDay`. */
export const VIEWING_WEEKDAY_MIN = 0;
/** See {@link VIEWING_WEEKDAY_MIN}. */
export const VIEWING_WEEKDAY_MAX = 6;

/** One recurring weekly window an owner offers on a listing. */
export interface ViewingWindow {
  readonly id: string;
  /** `0` = Sunday. */
  readonly weekday: number;
  /** Minutes since local midnight, inclusive. */
  readonly startMinute: number;
  /** Minutes since local midnight, exclusive. */
  readonly endMinute: number;
  /** How long each appointment inside this window lasts. */
  readonly slotMinutes: number;
  readonly modality: ViewingModality;
}

/** The shape an owner submits when replacing a listing's schedule. */
export interface ViewingWindowInput {
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly slotMinutes: number;
  readonly modality: ViewingModality;
}

/** One bookable appointment, already resolved to an instant. */
export interface ViewingSlot {
  /** The instant, ISO-8601 with an offset. What the client should echo back. */
  readonly startsAt: string;
  /** `YYYY-MM-DD` in the PROPERTY's zone — what the create endpoint takes. */
  readonly date: string;
  /** `HH:mm` in the PROPERTY's zone. */
  readonly time: string;
  readonly durationMinutes: number;
  readonly modality: ViewingModality;
}

/**
 * Where a listing's viewing timezone came from.
 *
 * Reported on the wire rather than kept private, because "10:00 in which
 * clock?" is the whole question and a surface that cannot answer it is back to
 * guessing. `fallback` means nothing in the system knows, and the UTC the
 * server then uses is a stated convention rather than a claim about the home.
 */
export type ViewingTimeZoneSource = 'property' | 'city' | 'fallback';

/** What the availability endpoint answers. */
export interface ViewingAvailability {
  readonly propertyId: string;
  /** The IANA zone every `date`/`time` below is expressed in. */
  readonly timeZone: string;
  readonly timeZoneSource: ViewingTimeZoneSource;
  /** Whether the owner has published any window at all. */
  readonly published: boolean;
  /** The weekly schedule, so a client can say "Tue & Thu evenings". */
  readonly windows: readonly ViewingWindow[];
  /** Concrete free slots over the requested horizon, soonest first. */
  readonly slots: readonly ViewingSlot[];
}

/** `HH:mm` for a minute-of-day. */
export function formatMinuteOfDay(minute: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.trunc(minute)));
  const hours = Math.floor(clamped / 60) % 24;
  return `${String(hours).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/** A `HH:mm` clock time as a minute-of-day, or `null` if it is not one. */
export function parseMinuteOfDay(clockTime: unknown): number | null {
  if (typeof clockTime !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(clockTime);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
