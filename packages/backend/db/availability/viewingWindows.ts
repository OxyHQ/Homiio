/**
 * The owner's viewing schedule, and the slots it produces (#518 §7.5).
 *
 * Two halves that belong together: the repository over
 * `property_viewing_windows`, and the PURE function that turns a weekly
 * recurrence plus a timezone into concrete instants. They are in one module
 * because the generator is the only reason the table has the shape it has, and
 * splitting them would let one change without the other.
 *
 * ## Why this sits beside `occupancy.ts` rather than inside it
 *
 * `db/availability/occupancy.ts` answers "is this DWELLING committed over these
 * nights?" — the question a reservation, an exchange and a host's blocked
 * calendar all bear on, where mixing the three up is a double booking. A
 * viewing is a different question with a different grain: half an hour of the
 * OWNER's afternoon, not a night of the home. Somebody can be shown a flat on
 * the Tuesday a guest is staying in it, and refusing that would be wrong; a
 * blocked calendar is not a closed door.
 *
 * So viewings are deliberately NOT a fourth `OccupancyKind`. Folding them in
 * would mean either that a booked stay blocks every viewing — silently ending
 * viewings on any listing that lets rooms — or that `findOccupancyConflict`
 * grows a flag saying which of its four sources to consult, which is two
 * questions wearing one name. Beside, not inside; and this docblock is where
 * the next person finds out that was a decision.
 *
 * ## The slot generator claims nothing it cannot verify
 *
 * Every candidate is converted with {@link zonedCivilToInstant}, which returns
 * `null` for a civil time the zone does not have. On the spring-forward Sunday
 * a 02:30 slot in `Europe/Madrid` is therefore simply not offered, rather than
 * being offered as a neighbouring moment nobody chose.
 */

import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  DEFAULT_VIEWING_DURATION_MINUTES,
  MAX_VIEWING_DURATION_MINUTES,
  MIN_VIEWING_DURATION_MINUTES,
  MINUTES_PER_DAY,
  VIEWING_HORIZON_MAX_DAYS,
  VIEWING_MINIMUM_NOTICE_MINUTES,
  VIEWING_WEEKDAY_MAX,
  VIEWING_WEEKDAY_MIN,
  VIEWING_WINDOWS_MAX,
  formatMinuteOfDay,
  instantToZonedCivil,
  isViewingModality,
  zonedCivilToInstant,
  type ViewingModality,
  type ViewingSlot,
  type ViewingWindow,
  type ViewingWindowInput,
} from '@homiio/shared-types';

import type { DatabaseOrTransaction } from '../postgres';
import { properties, propertyViewingWindows, viewingRequests } from '../schema';
import { ACTIVE_VIEWING_STATUSES } from '../bookings/viewingReads';

export type ViewingWindowRow = typeof propertyViewingWindows.$inferSelect;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** The wire shape of one window. */
export function serializeViewingWindow(row: ViewingWindowRow): ViewingWindow {
  return {
    id: row.id,
    weekday: row.weekday,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    slotMinutes: row.slotMinutes,
    modality: row.modality,
  };
}

/** Every window on a listing, ordered so a screen can render the week. */
export async function listViewingWindows(
  db: DatabaseOrTransaction,
  propertyId: string,
): Promise<readonly ViewingWindowRow[]> {
  return db
    .select()
    .from(propertyViewingWindows)
    .where(eq(propertyViewingWindows.propertyId, propertyId))
    .orderBy(
      asc(propertyViewingWindows.weekday),
      asc(propertyViewingWindows.startMinute),
      asc(propertyViewingWindows.modality),
    );
}

/**
 * The listing, IF the caller owns it, locked for the length of the transaction.
 *
 * Ownership is the predicate rather than a comparison afterwards, which is what
 * makes a non-owner indistinguishable from a stranger asking about a listing
 * that does not exist — `AGENTS.md`'s rule, and the reason the controller
 * answers 404 rather than 403.
 *
 * The lock is on `properties` for the same reason every booking path takes it
 * there: two schedule edits, or an edit racing a viewing request, are decided
 * against the same row.
 */
export async function lockOwnedPropertyForSchedule(
  tx: DatabaseOrTransaction,
  propertyId: string,
  ownerOxyUserId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.oxyUserId, ownerOxyUserId)))
    .limit(1)
    .for('update');
  return row;
}

/**
 * Replace a listing's whole schedule.
 *
 * A replace rather than per-window CRUD, because a weekly calendar is edited as
 * a whole — the owner drags Tuesday evening off and Thursday morning on in one
 * gesture — and because a partial apply is the failure mode that matters here:
 * half of an edit is a schedule the owner never chose, offering slots they
 * cannot keep. Delete and insert run in the CALLER's transaction, so the old
 * schedule and the new one are never both visible and never neither.
 *
 * Returns the rows as stored, so the caller serializes what the database holds
 * rather than what it was sent.
 */
export async function replaceViewingWindows(
  tx: DatabaseOrTransaction,
  propertyId: string,
  windows: readonly ViewingWindowInput[],
): Promise<readonly ViewingWindowRow[]> {
  await tx.delete(propertyViewingWindows).where(eq(propertyViewingWindows.propertyId, propertyId));
  if (windows.length === 0) return [];

  await tx.insert(propertyViewingWindows).values(
    windows.map((window) => ({
      propertyId,
      weekday: window.weekday,
      startMinute: window.startMinute,
      endMinute: window.endMinute,
      slotMinutes: window.slotMinutes,
      modality: window.modality,
    })),
  );
  return listViewingWindows(tx, propertyId);
}

/** A rejected window, named so the caller can say WHICH one and why. */
export interface ViewingWindowRejection {
  readonly index: number;
  readonly reason: string;
}

/** Either the windows, validated, or the first thing wrong with them. */
export type ViewingWindowParse =
  | { readonly ok: true; readonly windows: readonly ViewingWindowInput[] }
  | { readonly ok: false; readonly rejection: ViewingWindowRejection };

/**
 * Validate a submitted schedule.
 *
 * Every rule here is also a CHECK constraint, and that duplication is on
 * purpose: the constraint is what makes the rule true of the DATA whatever
 * writes it, and this is what turns a violation into a 400 naming the offending
 * window instead of a 23514 the owner cannot act on. The constraint is the
 * authority; if the two ever disagree, the database wins and this is the bug.
 */
export function parseViewingWindows(value: unknown): ViewingWindowParse {
  if (!Array.isArray(value)) {
    return { ok: false, rejection: { index: -1, reason: 'windows must be an array' } };
  }
  if (value.length > VIEWING_WINDOWS_MAX) {
    return {
      ok: false,
      rejection: { index: -1, reason: `at most ${VIEWING_WINDOWS_MAX} windows` },
    };
  }

  const windows: ViewingWindowInput[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index] as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') {
      return { ok: false, rejection: { index, reason: 'not an object' } };
    }

    const weekday = asInteger(raw.weekday);
    const startMinute = asInteger(raw.startMinute);
    const endMinute = asInteger(raw.endMinute);
    const slotMinutes = raw.slotMinutes === undefined
      ? DEFAULT_VIEWING_DURATION_MINUTES
      : asInteger(raw.slotMinutes);
    const modality = raw.modality;

    if (weekday === null || weekday < VIEWING_WEEKDAY_MIN || weekday > VIEWING_WEEKDAY_MAX) {
      return { ok: false, rejection: { index, reason: 'weekday must be 0 (Sunday) to 6' } };
    }
    if (startMinute === null || startMinute < 0 || startMinute >= MINUTES_PER_DAY) {
      return { ok: false, rejection: { index, reason: 'startMinute must be 0 to 1439' } };
    }
    if (endMinute === null || endMinute <= 0 || endMinute > MINUTES_PER_DAY) {
      return { ok: false, rejection: { index, reason: 'endMinute must be 1 to 1440' } };
    }
    if (endMinute <= startMinute) {
      return { ok: false, rejection: { index, reason: 'endMinute must follow startMinute' } };
    }
    if (
      slotMinutes === null ||
      slotMinutes < MIN_VIEWING_DURATION_MINUTES ||
      slotMinutes > MAX_VIEWING_DURATION_MINUTES
    ) {
      return {
        ok: false,
        rejection: {
          index,
          reason: `slotMinutes must be ${MIN_VIEWING_DURATION_MINUTES} to ${MAX_VIEWING_DURATION_MINUTES}`,
        },
      };
    }
    if (endMinute - startMinute < slotMinutes) {
      return { ok: false, rejection: { index, reason: 'window is shorter than one slot' } };
    }
    if (!isViewingModality(modality)) {
      return { ok: false, rejection: { index, reason: 'modality must be in_person or video' } };
    }

    // The unique index says the same thing; catching it here names the window.
    const key = `${weekday}:${startMinute}:${modality}`;
    if (seen.has(key)) {
      return { ok: false, rejection: { index, reason: 'duplicate window' } };
    }
    seen.add(key);

    windows.push({ weekday, startMinute, endMinute, slotMinutes, modality });
  }

  return { ok: true, windows };
}

/** A whole number, or `null` for anything else — including a float. */
function asInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value;
}

/** A half-open interval somebody already holds. */
export interface BusyInterval {
  readonly start: Date;
  readonly end: Date;
}

export interface GenerateSlotsInput {
  readonly windows: readonly ViewingWindow[];
  readonly timeZone: string;
  /** "Now". Slots are offered from `now + VIEWING_MINIMUM_NOTICE_MINUTES`. */
  readonly now: Date;
  readonly days: number;
  /** Appointments already taken, which are not offered again. */
  readonly busy: readonly BusyInterval[];
  /** Narrow the answer to one modality. */
  readonly modality?: ViewingModality;
  /**
   * Answer for ONE civil day (`YYYY-MM-DD`) instead of the whole horizon.
   *
   * The write path asks "is this exact time on offer?", and it must ask the
   * generator rather than re-deriving the answer — two implementations of
   * "which slots exist" is how a screen ends up offering a time the server then
   * refuses. This keeps that single implementation without making every request
   * build a fortnight of slots to look at one of them.
   */
  readonly onlyDate?: string;
}

/**
 * The concrete slots a weekly schedule offers over the next `days` days.
 *
 * Pure: every input is an argument, so the DST behaviour and the busy-slot
 * exclusion are testable without a database or a clock.
 *
 * Days are walked as CIVIL days in the property's zone rather than by adding
 * 24 hours to an instant, which is the arithmetic that loses an hour twice a
 * year: on a transition day the same wall-clock time is not 86,400,000 ms
 * later, so a slot list built that way drifts and starts offering 09:30 where
 * the owner published 10:00.
 */
export function generateViewingSlots(input: GenerateSlotsInput): readonly ViewingSlot[] {
  const days = Math.max(0, Math.min(Math.trunc(input.days), VIEWING_HORIZON_MAX_DAYS));
  if (days === 0 || input.windows.length === 0) return [];

  const earliest = input.now.getTime() + VIEWING_MINIMUM_NOTICE_MINUTES * MS_PER_MINUTE;
  const byWeekday = new Map<number, ViewingWindow[]>();
  for (const window of input.windows) {
    if (input.modality !== undefined && window.modality !== input.modality) continue;
    const list = byWeekday.get(window.weekday);
    if (list) list.push(window);
    else byWeekday.set(window.weekday, [window]);
  }
  if (byWeekday.size === 0) return [];

  // The first civil day, in the property's zone. Everything after it is
  // counted in CIVIL days — `Date.UTC` arithmetic on a date with no time — and
  // never by adding 86,400,000 ms to an instant. The latter skips or repeats a
  // day whenever `now` is near midnight and a transition falls in between,
  // which is a whole day of slots appearing twice or not at all, twice a year.
  const today = instantToZonedCivil(input.now, input.timeZone);
  if (!today) return [];
  const [year, month, day] = today.date.split('-').map(Number);
  const firstDay = Date.UTC(year, month - 1, day);

  const slots: ViewingSlot[] = [];
  const emitted = new Set<string>();

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const civilDay = new Date(firstDay + dayOffset * MS_PER_DAY);
    const pad = (value: number): string => String(value).padStart(2, '0');
    const reading = {
      date: `${civilDay.getUTCFullYear()}-${pad(civilDay.getUTCMonth() + 1)}-${pad(civilDay.getUTCDate())}`,
      weekday: civilDay.getUTCDay(),
    };

    if (input.onlyDate !== undefined && reading.date !== input.onlyDate) continue;

    const windows = byWeekday.get(reading.weekday);
    if (!windows) continue;

    for (const window of windows) {
      for (
        let minute = window.startMinute;
        minute + window.slotMinutes <= window.endMinute;
        minute += window.slotMinutes
      ) {
        const time = formatMinuteOfDay(minute);
        const startsAt = zonedCivilToInstant(reading.date, time, input.timeZone);
        // A civil time the zone does not have — the spring-forward gap. Not
        // offered, rather than offered as some nearby moment.
        if (!startsAt) continue;
        if (startsAt.getTime() < earliest) continue;

        const endsAt = new Date(startsAt.getTime() + window.slotMinutes * MS_PER_MINUTE);
        if (input.busy.some((held) => held.start < endsAt && held.end > startsAt)) continue;

        const key = `${startsAt.getTime()}:${window.modality}`;
        if (emitted.has(key)) continue;
        emitted.add(key);

        slots.push({
          startsAt: startsAt.toISOString(),
          date: reading.date,
          time,
          durationMinutes: window.slotMinutes,
          modality: window.modality,
        });
      }
    }
  }

  slots.sort((left, right) =>
    left.startsAt === right.startsAt
      ? left.modality.localeCompare(right.modality)
      : left.startsAt.localeCompare(right.startsAt),
  );
  return slots;
}

/**
 * Appointments already holding time on this listing, over a horizon.
 *
 * Only the ACTIVE statuses hold a slot — a declined or cancelled request must
 * not keep a Tuesday evening off the market forever. The lower bound reaches
 * `MAX_VIEWING_DURATION_MINUTES` before the window because an appointment that
 * STARTED earlier may still be running inside it; the CHECK constraint is what
 * makes that bound exhaustive rather than a guess.
 */
export async function findBusyViewingIntervals(
  db: DatabaseOrTransaction,
  propertyId: string,
  from: Date,
  to: Date,
): Promise<readonly BusyInterval[]> {
  const rows = await db
    .select({
      scheduledAt: viewingRequests.scheduledAt,
      durationMinutes: viewingRequests.durationMinutes,
    })
    .from(viewingRequests)
    .where(
      and(
        eq(viewingRequests.propertyId, propertyId),
        inArray(viewingRequests.status, [...ACTIVE_VIEWING_STATUSES]),
        gte(
          viewingRequests.scheduledAt,
          new Date(from.getTime() - MAX_VIEWING_DURATION_MINUTES * MS_PER_MINUTE),
        ),
        lt(viewingRequests.scheduledAt, to),
      ),
    );

  return rows.map((row) => ({
    start: row.scheduledAt,
    end: new Date(row.scheduledAt.getTime() + row.durationMinutes * MS_PER_MINUTE),
  }));
}

/**
 * The slot in `slots` that starts at `startsAt` with this modality.
 *
 * The create path's authorisation over an owner's calendar: a requested time is
 * accepted because it IS one of the offered slots, matched by instant rather
 * than by re-deriving whether it "looks like" one. Re-deriving would be a
 * second implementation of the generator, and the two would disagree the first
 * time somebody changed either.
 */
export function findOfferedSlot(
  slots: readonly ViewingSlot[],
  startsAt: Date,
  modality: ViewingModality,
): ViewingSlot | undefined {
  const wanted = startsAt.getTime();
  return slots.find(
    (slot) => slot.modality === modality && new Date(slot.startsAt).getTime() === wanted,
  );
}
