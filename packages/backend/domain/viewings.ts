/**
 * Viewing requests and the owner's viewing schedule — the use cases.
 *
 * Every function takes the acting account explicitly (`oxyUserId`) and is
 * called by BOTH the Express controllers (`controllers/viewingController.ts`,
 * `controllers/viewingAvailabilityController.ts`) and the catalogue tools
 * (`capabilities/handlers/viewings.ts`), so a route and its tool share one
 * implementation. Refusals are `AppError`s carrying the route's status and
 * code.
 *
 * Persisted in PostgreSQL (`db/schema/bookings.ts`, read and written through
 * `db/bookings/viewingReads.ts`).
 *
 * ## What the port changed
 *
 * **`cancelledBy` and `status` move in one statement.**
 * `viewing_requests_cancelled_by_status_check` makes them an equivalence, so a
 * cancellation that failed to record WHO cancelled is now a `23514` rather than
 * a row nobody can attribute. The repository is the only writer of either.
 *
 * **Every transition carries its precondition in the `UPDATE`'s predicate.**
 * Reading the row, checking `status === 'pending'` in JS and then writing would
 * leave a window in which two owners could both approve. A read is still
 * there, because it is what decides WHICH error the caller sees (404 vs 403 vs
 * 400), but the write no longer trusts it.
 *
 * **The property read is a narrow projection**
 * (`db/properties/propertyBookingBasis.ts`): the questions are "is this
 * bookable?" and "who owns it?", and a viewing request is not a listing page.
 *
 * ## What #518 §7.5 changed, and where each half lives
 *
 * A viewing has a ZONE, a LENGTH, a MODALITY and an owner's REPLY, and the
 * times on offer come from the owner rather than from a list of thirteen
 * hardcoded labels on the booking screen.
 *
 *  - **Zone.** `date` + `time` is a civil time and is anchored in the
 *    PROPERTY's zone (`db/availability/viewingTimeZone.ts`), never the
 *    server's. The civil reading travels back out beside the instant, so no
 *    client has to guess which clock "10:00" was.
 *  - **Length.** `duration_minutes`, which turns the old
 *    `scheduled_at = scheduled_at` conflict check into a real overlap
 *    (`findOverlappingViewing`).
 *  - **Modality.** In person or video, on the request and on the window that
 *    offered it.
 *  - **Reply.** `owner_response`, written in the same statement as the
 *    decision, and sent as the notification's body in place of the fixed
 *    English sentence the requester used to get.
 *
 * ## The schedule is authoritative WHEN IT EXISTS, and only then
 *
 * A listing whose owner has published no window keeps the free-form path: the
 * visitor proposes a time and the server checks it is in the future and does
 * not overlap an existing appointment. That is deliberate and it is not a
 * transitional hack. Refusing every request on every listing that has not yet
 * been configured would take a working feature away from every home in the
 * catalogue on the day this deployed, to enforce a rule nobody had had the
 * chance to state. What it must NOT do is invent slots — which is precisely
 * what the thirteen hardcoded `TIME_SLOTS` on the booking screen did — so the
 * availability says `published: false` and carries an empty `slots`, and the
 * screen says the owner has not published times instead of making some up.
 *
 * Once a window exists the schedule is binding: a requested instant must BE one
 * of the offered slots, matched by instant against the generator's own output
 * rather than re-derived, so the offer and the acceptance cannot drift.
 */

import { eq } from 'drizzle-orm';

import {
  DEFAULT_VIEWING_DURATION_MINUTES,
  PropertyStatus,
  VIEWING_HORIZON_DEFAULT_DAYS,
  VIEWING_HORIZON_MAX_DAYS,
  instantToZonedCivil,
  isSupportedTimeZone,
  isViewingModality,
  zonedCivilToInstant,
  type ViewingAvailability,
  type ViewingModality,
} from '@homiio/shared-types';
import { getDb } from '../db/postgres';
import type { DatabaseOrTransaction } from '../db/postgres';
import { properties } from '../db/schema';
import {
  cancelViewing as cancelViewingRow,
  createViewing,
  decideViewing,
  findActiveViewingForRequester,
  findOverlappingViewing,
  findViewingById,
  isViewingStatus,
  listViewings,
  rescheduleViewing as rescheduleViewingRow,
  serializeViewing,
} from '../db/bookings/viewingReads';
import {
  findBusyViewingIntervals,
  findOfferedSlot,
  generateViewingSlots,
  listViewingWindows,
  lockOwnedPropertyForSchedule,
  parseViewingWindows,
  replaceViewingWindows,
  serializeViewingWindow,
} from '../db/availability/viewingWindows';
import {
  resolveViewingTimeZone,
  resolveViewingTimeZones,
} from '../db/availability/viewingTimeZone';
import {
  findPropertyBookingBasis,
  lockPropertyBookingBases,
} from '../db/properties/propertyBookingBasis';
import { logger } from '../middlewares/logging';
import { AppError } from '../middlewares/errorHandler';
import { notificationDispatchService } from '../services/notificationDispatchService';
import { externalListingOutcome, type ExternalListingOutcome } from './bookingOutcomes';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ViewingDto = Record<string, unknown>;

export interface Page {
  readonly page: number;
  readonly limit: number;
}

export interface PagedViewings extends Page {
  readonly rows: ViewingDto[];
  readonly total: number;
}

/** The route's paging: `?page`/`?limit`, defaulting to 1 and 10. */
export function viewingPage(page: unknown, limit: unknown): Page {
  return {
    page: parseInt(String(page ?? ''), 10) || 1,
    limit: parseInt(String(limit ?? ''), 10) || 10,
  };
}

/** A short free-text field, trimmed, or `undefined` if it carries nothing. */
function asText(value: unknown, maxLength = 2000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, maxLength);
}

/**
 * What the two write paths agree on before they touch a row.
 *
 * `date` + `time` is a CIVIL time, and a civil time is not a moment. It used to
 * be anchored with `new Date(\`${date}T${time}\`)` — no offset, so parsed in
 * whatever zone the process happened to boot in — while the client rendered the
 * result in the DEVICE's zone. Three zones and nothing reconciling them: a
 * viewing booked at "10:00" was 10:00 to nobody in particular.
 *
 * It is now anchored in the PROPERTY's zone, which is the only one of the three
 * that is a fact about the appointment. Where that zone comes from, and why it
 * is not derived from coordinates, is in `db/availability/viewingTimeZone.ts`.
 *
 * A civil time the zone does not have — 02:30 on the spring-forward Sunday — is
 * refused rather than nudged to a neighbouring instant, because an appointment
 * at a time nobody chose is worse than a rejected form.
 */
interface ResolvedRequestTime {
  readonly scheduledAt: Date;
  readonly durationMinutes: number;
  readonly modality: ViewingModality;
  readonly timeZone: string;
}

/**
 * Turn `{ date, time, modality }` into an instant this listing will accept.
 *
 * **The published schedule is authoritative when it exists.** With windows on
 * the listing the requested instant must BE one of the generated slots —
 * matched against the generator's own output, never re-derived — and it takes
 * that slot's length. With no windows the listing keeps the free-form path: any
 * future instant, at the default length.
 *
 * @throws {AppError} 400 for an unreadable time or modality, 409 for a time the
 *   published schedule does not offer.
 */
async function resolveRequestedTime(
  db: DatabaseOrTransaction,
  propertyId: string,
  body: { date: unknown; time: unknown; modality: unknown },
  now: Date,
): Promise<ResolvedRequestTime> {
  const { date, time } = body;
  if (typeof date !== 'string' || typeof time !== 'string') {
    throw new AppError('Invalid date or time', 400, 'INVALID_DATETIME');
  }

  const modality =
    body.modality === undefined || body.modality === null ? 'in_person' : body.modality;
  if (!isViewingModality(modality)) {
    throw new AppError('Unknown viewing modality', 400, 'INVALID_MODALITY');
  }

  const zone = await resolveViewingTimeZone(db, propertyId);
  const scheduledAt = zonedCivilToInstant(date, time, zone.timeZone);
  if (!scheduledAt) throw new AppError('Invalid date or time', 400, 'INVALID_DATETIME');
  if (scheduledAt.getTime() <= now.getTime()) {
    throw new AppError('Scheduled time must be in the future', 400, 'TIME_IN_PAST');
  }

  const windows = (await listViewingWindows(db, propertyId)).map(serializeViewingWindow);
  if (windows.length === 0) {
    return {
      scheduledAt,
      durationMinutes: DEFAULT_VIEWING_DURATION_MINUTES,
      modality,
      timeZone: zone.timeZone,
    };
  }

  const today = instantToZonedCivil(now, zone.timeZone);
  if (!today) throw new AppError('Invalid date or time', 400, 'INVALID_DATETIME');
  const dayOffset = Math.round((civilEpoch(date) - civilEpoch(today.date)) / MS_PER_DAY);
  if (!Number.isFinite(dayOffset) || dayOffset < 0 || dayOffset >= VIEWING_HORIZON_MAX_DAYS) {
    throw new AppError('That time is not on offer', 409, 'SLOT_NOT_OFFERED');
  }

  const busy = await findBusyViewingIntervals(
    db,
    propertyId,
    new Date(scheduledAt.getTime() - MS_PER_DAY),
    new Date(scheduledAt.getTime() + MS_PER_DAY),
  );
  const slots = generateViewingSlots({
    windows,
    timeZone: zone.timeZone,
    now,
    days: dayOffset + 1,
    busy,
    onlyDate: date,
  });
  const offered = findOfferedSlot(slots, scheduledAt, modality);
  if (!offered) throw new AppError('That time is not on offer', 409, 'SLOT_NOT_OFFERED');

  return {
    scheduledAt,
    durationMinutes: offered.durationMinutes,
    modality,
    timeZone: zone.timeZone,
  };
}

/** A `YYYY-MM-DD` as a UTC epoch, for counting CIVIL days between two dates. */
function civilEpoch(civilDate: string): number {
  const [year, month, day] = civilDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

// ── Viewing requests ────────────────────────────────────────────────────────

export interface RequestViewingInput {
  readonly propertyId: string;
  readonly date: unknown;
  readonly time: unknown;
  readonly modality?: unknown;
  readonly message?: unknown;
}

export type RequestViewingOutcome =
  | { readonly status: 'requested'; readonly viewing: ViewingDto }
  | ExternalListingOutcome;

/**
 * Ask the owner of a listing for a viewing.
 *
 * An EXTERNAL listing never gets a request: the outcome is the advertiser's own
 * link (`external_listing`), and the route turns that into its historical 400.
 */
export async function requestViewing(
  oxyUserId: string,
  input: RequestViewingInput,
): Promise<RequestViewingOutcome> {
  const { propertyId, date, time, modality, message } = input;
  const requesterOxyUserId = oxyUserId;
  const now = new Date();

  /**
   * The two "is this slot free?" reads and the insert are ONE transaction,
   * with the listing locked.
   *
   * They were four sequential statements against the pool, so two people
   * asking for the same 10:00 both read an empty slot and both got it — and
   * neither of the two rules ("one active request per person per property",
   * "one active request per property per instant") can be a unique index,
   * because both are scoped to a status SET that must still permit the
   * historical rows. The rule lives in a read, so the read needs a lock behind
   * it; the `properties` row is the one both requests share.
   */
  const outcome = await getDb().transaction(async (tx) => {
    const property = (await lockPropertyBookingBases(tx, [propertyId])).get(propertyId);
    if (!property) throw new AppError('Property not found', 404, 'NOT_FOUND');
    if (property.status !== PropertyStatus.PUBLISHED) {
      throw new AppError('Property is not active', 400, 'PROPERTY_INACTIVE');
    }
    if (property.isExternal) return { external: await externalListingOutcome(tx, propertyId) };

    const ownerOxyUserId = property.oxyUserId;
    if (!ownerOxyUserId) throw new AppError('Property has no owner', 400, 'INVALID_PROPERTY');
    if (ownerOxyUserId === oxyUserId) {
      throw new AppError('You cannot book a viewing for your own property', 403, 'FORBIDDEN');
    }

    // The zone, the schedule and the slot the caller asked for — resolved
    // INSIDE the lock, because the owner's calendar is one of the things two
    // concurrent requests are deciding against.
    const resolved = await resolveRequestedTime(tx, propertyId, { date, time, modality }, now);

    // One active request per person per property.
    if (await findActiveViewingForRequester(tx, propertyId, requesterOxyUserId)) {
      throw new AppError(
        'You already have an active viewing request for this property',
        409,
        'ALREADY_REQUESTED',
      );
    }

    // Nothing active may OVERLAP the appointment — not merely share its
    // starting instant, which is what this check used to ask.
    const conflict = await findOverlappingViewing(
      tx,
      propertyId,
      resolved.scheduledAt,
      resolved.durationMinutes,
    );
    if (conflict) throw new AppError('Time slot is no longer available', 409, 'TIME_CONFLICT');

    const viewing = await createViewing(tx, {
      propertyId,
      requesterOxyUserId,
      ownerOxyUserId,
      scheduledAt: resolved.scheduledAt,
      durationMinutes: resolved.durationMinutes,
      modality: resolved.modality,
      message: asText(message),
    });
    return { viewing, ownerOxyUserId, timeZone: resolved.timeZone };
  });

  if (outcome.external) return outcome.external;

  logger.info('Viewing request created', {
    viewingId: outcome.viewing.id,
    propertyId,
    requesterOxyUserId,
    ownerOxyUserId: outcome.ownerOxyUserId,
  });

  // Notify the property owner that someone requested a viewing. OUTSIDE the
  // transaction on purpose: dispatch is best-effort and swallows, and a mailbox
  // write must never be able to roll a booked viewing back.
  await notificationDispatchService.createForUser(outcome.ownerOxyUserId, {
    type: 'property',
    title: 'New viewing request',
    message: 'Someone requested a viewing for your property.',
    priority: 'high',
    data: { viewingId: outcome.viewing.id, propertyId, screen: '/viewings' },
  });

  return { status: 'requested', viewing: serializeViewing(outcome.viewing, outcome.timeZone) };
}

/** The viewing requests the account made, across every listing. */
export async function listMyViewingRequests(
  oxyUserId: string,
  input: Page & { readonly status?: unknown },
): Promise<PagedViewings> {
  const { page, limit } = input;
  const db = getDb();
  const result = await listViewings(
    db,
    {
      requesterOxyUserId: oxyUserId,
      status: isViewingStatus(input.status) ? input.status : undefined,
    },
    { limit, offset: (page - 1) * limit },
  );

  // One resolution for the whole page rather than a query per row: the
  // listings on a page of viewings are usually a handful, and each one's zone
  // is what makes its "10:00" mean anything.
  const zones = await resolveViewingTimeZones(
    db,
    result.rows.map((row) => row.propertyId),
  );
  return {
    page,
    limit,
    total: result.total,
    rows: result.rows.map((row) => serializeViewing(row, zones.get(row.propertyId)?.timeZone)),
  };
}

/**
 * The viewing requests on one listing: ALL of them for its owner, only the
 * account's own for anybody else. The scope IS the authorisation, so it is in
 * the predicate rather than a filter on the results.
 */
export async function listListingViewingRequests(
  oxyUserId: string,
  input: Page & { readonly propertyId: string; readonly status?: unknown },
): Promise<PagedViewings> {
  const { propertyId, page, limit } = input;
  const db = getDb();
  const property = await findPropertyBookingBasis(db, propertyId);
  if (!property) throw new AppError('Property not found', 404, 'NOT_FOUND');

  const isOwner = property.oxyUserId === oxyUserId;
  const [result, zone] = await Promise.all([
    listViewings(
      db,
      {
        propertyId,
        requesterOxyUserId: isOwner ? undefined : oxyUserId,
        status: isViewingStatus(input.status) ? input.status : undefined,
      },
      { limit, offset: (page - 1) * limit },
    ),
    resolveViewingTimeZone(db, propertyId),
  ]);

  return {
    page,
    limit,
    total: result.total,
    rows: result.rows.map((row) => serializeViewing(row, zone.timeZone)),
  };
}

export interface ViewingDecisionInput {
  readonly viewingId: string;
  /** The owner's own words to the requester. */
  readonly response?: unknown;
}

/** Approve a pending viewing request on the account's own listing. */
export async function approveViewing(
  oxyUserId: string,
  input: ViewingDecisionInput,
): Promise<ViewingDto> {
  const { viewingId } = input;
  const db = getDb();
  const viewing = await findViewingById(db, viewingId);
  if (!viewing) throw new AppError('Viewing request not found', 404, 'NOT_FOUND');

  if (viewing.ownerOxyUserId !== oxyUserId) {
    throw new AppError('Only the property owner can approve', 403, 'FORBIDDEN');
  }
  if (viewing.status !== 'pending') {
    throw new AppError('Only pending requests can be approved', 400, 'INVALID_STATE');
  }

  // No OTHER approved request may OVERLAP this appointment.
  const conflict = await findOverlappingViewing(
    db,
    viewing.propertyId,
    viewing.scheduledAt,
    viewing.durationMinutes,
    { excludeId: viewing.id, statuses: ['approved'] },
  );
  if (conflict) {
    throw new AppError('Time slot already approved for another request', 409, 'TIME_CONFLICT');
  }

  const approved = await decideViewing(
    db,
    viewingId,
    oxyUserId,
    'approved',
    asText(input.response),
  );
  if (!approved) {
    throw new AppError('Only pending requests can be approved', 400, 'INVALID_STATE');
  }

  // The owner's own words, when they wrote any: a fixed English sentence is
  // what the requester used to be shown in place of whatever the landlord
  // actually said, and it is not translated here because it is one person
  // writing to another rather than a string this product owns.
  await notificationDispatchService.createForUser(approved.requesterOxyUserId, {
    type: 'property',
    title: 'Viewing approved',
    message: approved.ownerResponse ?? 'Your viewing request was approved.',
    priority: 'high',
    data: {
      viewingId: approved.id,
      propertyId: approved.propertyId,
      ownerResponse: approved.ownerResponse,
      screen: '/viewings',
    },
  });

  const zone = await resolveViewingTimeZone(db, approved.propertyId);
  return serializeViewing(approved, zone.timeZone);
}

/** Decline a pending viewing request on the account's own listing. */
export async function declineViewing(
  oxyUserId: string,
  input: ViewingDecisionInput,
): Promise<ViewingDto> {
  const { viewingId } = input;
  const db = getDb();
  const viewing = await findViewingById(db, viewingId);
  if (!viewing) throw new AppError('Viewing request not found', 404, 'NOT_FOUND');

  if (viewing.ownerOxyUserId !== oxyUserId) {
    throw new AppError('Only the property owner can decline', 403, 'FORBIDDEN');
  }
  if (viewing.status !== 'pending') {
    throw new AppError('Only pending requests can be declined', 400, 'INVALID_STATE');
  }

  const declined = await decideViewing(
    db,
    viewingId,
    oxyUserId,
    'declined',
    asText(input.response),
  );
  if (!declined) {
    throw new AppError('Only pending requests can be declined', 400, 'INVALID_STATE');
  }

  // "Sorry, it went yesterday" and "I can do Thursday instead" are different
  // answers, and before `owner_response` existed both of them arrived as the
  // same fixed English sentence.
  await notificationDispatchService.createForUser(declined.requesterOxyUserId, {
    type: 'property',
    title: 'Viewing declined',
    message: declined.ownerResponse ?? 'Your viewing request was declined.',
    priority: 'medium',
    data: {
      viewingId: declined.id,
      propertyId: declined.propertyId,
      ownerResponse: declined.ownerResponse,
      screen: '/viewings',
    },
  });

  const zone = await resolveViewingTimeZone(db, declined.propertyId);
  return serializeViewing(declined, zone.timeZone);
}

export interface CancelViewingOutcome {
  readonly viewing: ViewingDto;
  /** It was already cancelled — the outcome asked for already holds. */
  readonly alreadyCancelled: boolean;
}

/** Cancel a viewing the account requested, or one on the account's listing. */
export async function cancelViewing(
  oxyUserId: string,
  input: ViewingDecisionInput,
): Promise<CancelViewingOutcome> {
  const { viewingId } = input;
  const db = getDb();
  const viewing = await findViewingById(db, viewingId);
  if (!viewing) throw new AppError('Viewing request not found', 404, 'NOT_FOUND');

  const isRequester = viewing.requesterOxyUserId === oxyUserId;
  const isOwner = viewing.ownerOxyUserId === oxyUserId;
  if (!isRequester && !isOwner) {
    throw new AppError('Not authorized to cancel this request', 403, 'FORBIDDEN');
  }

  const zone = await resolveViewingTimeZone(db, viewing.propertyId);
  if (viewing.status === 'cancelled') {
    return { viewing: serializeViewing(viewing, zone.timeZone), alreadyCancelled: true };
  }

  // Both columns in one statement — the CHECK is an equivalence.
  const cancelled = await cancelViewingRow(
    db,
    viewingId,
    isOwner ? 'owner' : 'requester',
    isOwner ? asText(input.response) : undefined,
  );
  if (!cancelled) {
    // Somebody else cancelled between the read and the write; the outcome the
    // caller asked for already holds, so this is not an error.
    const current = await findViewingById(db, viewingId);
    if (!current) throw new AppError('Viewing request not found', 404, 'NOT_FOUND');
    return { viewing: serializeViewing(current, zone.timeZone), alreadyCancelled: true };
  }

  // Notify the counterparty that the viewing was cancelled.
  const cancelRecipientOxyUserId = isOwner
    ? cancelled.requesterOxyUserId
    : cancelled.ownerOxyUserId;
  await notificationDispatchService.createForUser(cancelRecipientOxyUserId, {
    type: 'property',
    title: 'Viewing cancelled',
    message:
      cancelled.ownerResponse ??
      (isOwner
        ? 'The owner cancelled a viewing you requested.'
        : 'A viewing request for your property was cancelled.'),
    priority: 'medium',
    data: {
      viewingId: cancelled.id,
      propertyId: cancelled.propertyId,
      ownerResponse: cancelled.ownerResponse,
      screen: '/viewings',
    },
  });

  return { viewing: serializeViewing(cancelled, zone.timeZone), alreadyCancelled: false };
}

export interface RescheduleViewingInput {
  readonly viewingId: string;
  readonly date: unknown;
  readonly time: unknown;
  readonly modality?: unknown;
  readonly message?: unknown;
}

/** Move a pending viewing the account requested to another time. */
export async function rescheduleViewing(
  oxyUserId: string,
  input: RescheduleViewingInput,
): Promise<ViewingDto> {
  const { viewingId, date, time, modality, message } = input;
  const db = getDb();
  const viewing = await findViewingById(db, viewingId);
  if (!viewing) throw new AppError('Viewing request not found', 404, 'NOT_FOUND');

  // Only pending requests, and only by the requester.
  if (viewing.status !== 'pending') {
    throw new AppError('Can only modify pending viewing requests', 400, 'CANNOT_MODIFY');
  }
  if (viewing.requesterOxyUserId !== oxyUserId) {
    throw new AppError('Not authorized to modify this viewing request', 403, 'FORBIDDEN');
  }

  const now = new Date();
  // A reschedule is a new request for the same row, so it faces the same rules:
  // the same zone, the same published schedule, the same overlap check. Under a
  // lock, because moving an appointment on top of another is the same race as
  // booking one there.
  const outcome = await db.transaction(async (tx) => {
    const locked = (await lockPropertyBookingBases(tx, [viewing.propertyId])).get(
      viewing.propertyId,
    );
    if (!locked) throw new AppError('Property not found', 404, 'NOT_FOUND');

    const resolved = await resolveRequestedTime(
      tx,
      viewing.propertyId,
      { date, time, modality: modality ?? viewing.modality },
      now,
    );

    const conflict = await findOverlappingViewing(
      tx,
      viewing.propertyId,
      resolved.scheduledAt,
      resolved.durationMinutes,
      { excludeId: viewingId },
    );
    if (conflict) throw new AppError('Time slot is no longer available', 409, 'TIME_CONFLICT');

    const updated = await rescheduleViewingRow(tx, viewingId, oxyUserId, {
      scheduledAt: resolved.scheduledAt,
      durationMinutes: resolved.durationMinutes,
      modality: resolved.modality,
      message: asText(message),
    });
    if (!updated) {
      throw new AppError('Can only modify pending viewing requests', 400, 'CANNOT_MODIFY');
    }
    return { updated, timeZone: resolved.timeZone };
  });

  logger.info('Viewing request updated', { viewingId, scheduledAt: outcome.updated.scheduledAt });
  return serializeViewing(outcome.updated, outcome.timeZone);
}

// ── Availability and the owner's schedule ───────────────────────────────────

/** The requested horizon, clamped to what the generator will answer. */
export function viewingHorizonDays(value: unknown): number {
  const asked = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(asked) || asked <= 0) return VIEWING_HORIZON_DEFAULT_DAYS;
  return Math.min(asked, VIEWING_HORIZON_MAX_DAYS);
}

/**
 * Everything the availability answer needs, in one place.
 *
 * "Which slots are on offer" must have exactly one implementation: a second one
 * written for the write path is how a screen ends up offering a slot the server
 * then refuses.
 */
async function buildViewingAvailability(
  db: DatabaseOrTransaction,
  propertyId: string,
  days: number,
): Promise<ViewingAvailability> {
  const now = new Date();
  const [zone, windowRows] = await Promise.all([
    resolveViewingTimeZone(db, propertyId),
    listViewingWindows(db, propertyId),
  ]);
  const windows = windowRows.map(serializeViewingWindow);
  if (windows.length === 0) {
    return {
      propertyId,
      timeZone: zone.timeZone,
      timeZoneSource: zone.source,
      published: false,
      windows: [],
      slots: [],
    };
  }

  const busy = await findBusyViewingIntervals(
    db,
    propertyId,
    now,
    new Date(now.getTime() + (days + 1) * MS_PER_DAY),
  );

  return {
    propertyId,
    timeZone: zone.timeZone,
    timeZoneSource: zone.source,
    published: true,
    windows,
    slots: generateViewingSlots({ windows, timeZone: zone.timeZone, now, days, busy }),
  };
}

export type ViewingAvailabilityOutcome =
  | { readonly status: 'available'; readonly availability: ViewingAvailability }
  | ExternalListingOutcome;

/**
 * The slots a listing offers. PUBLIC: no requester, no owner, no viewing id, no
 * message — a taken slot is simply absent. It reads no account at all.
 *
 * External listings have no in-app viewing, so they publish no slots: the
 * outcome is the advertiser's link instead.
 */
export async function getViewingAvailability(input: {
  readonly propertyId: string;
  readonly days: number;
}): Promise<ViewingAvailabilityOutcome> {
  const db = getDb();
  const property = await findPropertyBookingBasis(db, input.propertyId);
  if (!property) throw new AppError('Property not found', 404, 'NOT_FOUND');
  if (property.isExternal) return externalListingOutcome(db, input.propertyId);
  return {
    status: 'available',
    availability: await buildViewingAvailability(db, input.propertyId, input.days),
  };
}

export interface ViewingSchedule {
  readonly propertyId: string;
  readonly timeZone: string;
  readonly timeZoneSource: string;
  readonly windows: ReturnType<typeof serializeViewingWindow>[];
}

/**
 * The owner's own schedule. Ownership IS the predicate
 * (`lockOwnedPropertyForSchedule`), so somebody else's listing answers 404.
 */
export async function getViewingWindows(
  oxyUserId: string,
  input: { readonly propertyId: string },
): Promise<ViewingSchedule> {
  const { propertyId } = input;
  const db = getDb();
  const owned = await lockOwnedPropertyForSchedule(db, propertyId, oxyUserId);
  if (!owned) throw new AppError('Property not found', 404, 'NOT_FOUND');

  const [zone, windows] = await Promise.all([
    resolveViewingTimeZone(db, propertyId),
    listViewingWindows(db, propertyId),
  ]);
  return {
    propertyId,
    timeZone: zone.timeZone,
    timeZoneSource: zone.source,
    windows: windows.map(serializeViewingWindow),
  };
}

/**
 * Replace the schedule, and optionally the zone it is expressed in.
 *
 * One operation for both because they are one fact: "17:00" is not a time
 * until the zone is known, so an owner who moves their windows and their zone
 * in two steps is briefly offering slots at an hour they did not choose.
 *
 * `timeZone`: `null` clears the owner's statement and falls back to the city;
 * `undefined` leaves it alone; anything else has to be a zone `Intl` knows.
 */
export async function setViewingWindows(
  oxyUserId: string,
  input: { readonly propertyId: string; readonly windows: unknown; readonly timeZone?: unknown },
): Promise<ViewingSchedule> {
  const { propertyId } = input;
  const parsed = parseViewingWindows(input.windows ?? []);
  if (!parsed.ok) {
    throw new AppError(
      parsed.rejection.index >= 0
        ? `Window ${parsed.rejection.index}: ${parsed.rejection.reason}`
        : parsed.rejection.reason,
      400,
      'INVALID_VIEWING_WINDOW',
    );
  }

  // No CHECK does this — an IANA name is a FORMAT, and CONVENTIONS.md keeps
  // format validators out of the schema — so this is the only place it happens.
  let timeZoneUpdate: string | null | undefined;
  if (input.timeZone === null) timeZoneUpdate = null;
  else if (input.timeZone !== undefined) {
    if (!isSupportedTimeZone(input.timeZone)) {
      throw new AppError('Unknown time zone', 400, 'INVALID_TIMEZONE');
    }
    timeZoneUpdate = input.timeZone;
  }

  const outcome = await getDb().transaction(async (tx) => {
    const owned = await lockOwnedPropertyForSchedule(tx, propertyId, oxyUserId);
    if (!owned) throw new AppError('Property not found', 404, 'NOT_FOUND');

    if (timeZoneUpdate !== undefined) {
      await tx
        .update(properties)
        .set({ viewingTimezone: timeZoneUpdate })
        .where(eq(properties.id, propertyId));
    }
    const windows = await replaceViewingWindows(tx, propertyId, parsed.windows);
    const zone = await resolveViewingTimeZone(tx, propertyId);
    return { windows, zone };
  });

  return {
    propertyId,
    timeZone: outcome.zone.timeZone,
    timeZoneSource: outcome.zone.source,
    windows: outcome.windows.map(serializeViewingWindow),
  };
}
