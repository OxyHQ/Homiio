/**
 * Viewing Controller
 * Handles viewing request lifecycle (create, list, approve, decline, cancel).
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
 * The Mongoose version read the document, checked `status === 'pending'` in JS,
 * assigned and saved — a window in which two owners could both approve. The
 * read is still there, because it is what decides WHICH error the caller sees
 * (404 vs 403 vs 400), but the write no longer trusts it.
 *
 * **The property read is a narrow projection**
 * (`db/properties/propertyBookingBasis.ts`): the questions are "is this
 * bookable?" and "who owns it?", and a viewing request is not a listing page.
 *
 * ## What #518 §7.5 changed, and where each half lives
 *
 * A viewing now has a ZONE, a LENGTH, a MODALITY and an owner's REPLY, and the
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
 * The slots themselves, and why a published schedule is authoritative only once
 * it exists, are in `viewingAvailabilityController`.
 */

import type { Request, Response, NextFunction } from 'express';

import {
  DEFAULT_VIEWING_DURATION_MINUTES,
  PropertyStatus,
  VIEWING_HORIZON_MAX_DAYS,
  instantToZonedCivil,
  isViewingModality,
  zonedCivilToInstant,
  type ViewingModality,
} from '@homiio/shared-types';
import { getDb } from '../db/postgres';
import type { DatabaseOrTransaction } from '../db/postgres';
import {
  cancelViewing,
  createViewing,
  decideViewing,
  findActiveViewingForRequester,
  findOverlappingViewing,
  findViewingById,
  isViewingStatus,
  listViewings,
  rescheduleViewing,
  serializeViewing,
} from '../db/bookings/viewingReads';
import {
  findOfferedSlot,
  findBusyViewingIntervals,
  generateViewingSlots,
  listViewingWindows,
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
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import { notificationDispatchService } from '../services/notificationDispatchService';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Resolve the caller from the session, in the shape the auth layer sets. */
function callerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || req.userId || undefined;
}

function parsePagination(query: Request['query']): { page: number; limit: number; skip: number } {
  const page = parseInt(String(query.page ?? ''), 10) || 1;
  const limit = parseInt(String(query.limit ?? ''), 10) || 10;
  return { page, limit, skip: (page - 1) * limit };
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

type ResolveOutcome =
  | { readonly ok: true; readonly value: ResolvedRequestTime }
  | { readonly ok: false; readonly error: AppError };

/**
 * Turn `{ date, time, modality }` into an instant this listing will accept.
 *
 * **The published schedule is authoritative when it exists.** With windows on
 * the listing the requested instant must BE one of the generated slots —
 * matched against the generator's own output, never re-derived — and it takes
 * that slot's length. With no windows the listing keeps the free-form path: any
 * future instant, at the default length. The argument for that asymmetry is in
 * `viewingAvailabilityController`'s header.
 */
async function resolveRequestedTime(
  db: DatabaseOrTransaction,
  propertyId: string,
  body: { date: unknown; time: unknown; modality: unknown },
  now: Date,
): Promise<ResolveOutcome> {
  const { date, time } = body;
  if (typeof date !== 'string' || typeof time !== 'string') {
    return { ok: false, error: new AppError('Invalid date or time', 400, 'INVALID_DATETIME') };
  }

  const modality = body.modality === undefined || body.modality === null ? 'in_person' : body.modality;
  if (!isViewingModality(modality)) {
    return { ok: false, error: new AppError('Unknown viewing modality', 400, 'INVALID_MODALITY') };
  }

  const zone = await resolveViewingTimeZone(db, propertyId);
  const scheduledAt = zonedCivilToInstant(date, time, zone.timeZone);
  if (!scheduledAt) {
    return { ok: false, error: new AppError('Invalid date or time', 400, 'INVALID_DATETIME') };
  }
  if (scheduledAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      error: new AppError('Scheduled time must be in the future', 400, 'TIME_IN_PAST'),
    };
  }

  const windows = (await listViewingWindows(db, propertyId)).map(serializeViewingWindow);
  if (windows.length === 0) {
    return {
      ok: true,
      value: {
        scheduledAt,
        durationMinutes: DEFAULT_VIEWING_DURATION_MINUTES,
        modality,
        timeZone: zone.timeZone,
      },
    };
  }

  const today = instantToZonedCivil(now, zone.timeZone);
  if (!today) {
    return { ok: false, error: new AppError('Invalid date or time', 400, 'INVALID_DATETIME') };
  }
  const dayOffset = Math.round((civilEpoch(date) - civilEpoch(today.date)) / MS_PER_DAY);
  if (!Number.isFinite(dayOffset) || dayOffset < 0 || dayOffset >= VIEWING_HORIZON_MAX_DAYS) {
    return {
      ok: false,
      error: new AppError('That time is not on offer', 409, 'SLOT_NOT_OFFERED'),
    };
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
  if (!offered) {
    return {
      ok: false,
      error: new AppError('That time is not on offer', 409, 'SLOT_NOT_OFFERED'),
    };
  }

  return {
    ok: true,
    value: {
      scheduledAt,
      durationMinutes: offered.durationMinutes,
      modality,
      timeZone: zone.timeZone,
    },
  };
}

/** A `YYYY-MM-DD` as a UTC epoch, for counting CIVIL days between two dates. */
function civilEpoch(civilDate: string): number {
  const [year, month, day] = civilDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

class ViewingController {
  /**
   * Create a new viewing request for a property
   */
  async createViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { propertyId } = req.params;
      const { date, time, modality, message } = req.body;

      const oxyUserId = callerOf(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

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
       * historical rows. The rule lives in a read, so the read needs a lock
       * behind it; the `properties` row is the one both requests share.
       */
      const outcome = await getDb().transaction(async (tx) => {
        const property = (await lockPropertyBookingBases(tx, [propertyId])).get(propertyId);
        if (!property) return { error: new AppError('Property not found', 404, 'NOT_FOUND') };
        if (property.status !== PropertyStatus.PUBLISHED) {
          return { error: new AppError('Property is not active', 400, 'PROPERTY_INACTIVE') };
        }
        if (property.isExternal) {
          return { error: new AppError('Cannot book viewings for external properties', 400, 'EXTERNAL_PROPERTY') };
        }

        const ownerOxyUserId = property.oxyUserId;
        if (!ownerOxyUserId) return { error: new AppError('Property has no owner', 400, 'INVALID_PROPERTY') };
        if (ownerOxyUserId === oxyUserId) {
          return { error: new AppError('You cannot book a viewing for your own property', 403, 'FORBIDDEN') };
        }

        // The zone, the schedule and the slot the caller asked for — resolved
        // INSIDE the lock, because the owner's calendar is one of the things
        // two concurrent requests are deciding against.
        const resolved = await resolveRequestedTime(
          tx,
          propertyId,
          { date, time, modality },
          now,
        );
        if (!resolved.ok) return { error: resolved.error };

        // One active request per person per property.
        const existingActiveForProfile = await findActiveViewingForRequester(
          tx,
          propertyId,
          requesterOxyUserId,
        );
        if (existingActiveForProfile) {
          return { error: new AppError('You already have an active viewing request for this property', 409, 'ALREADY_REQUESTED') };
        }

        // Nothing active may OVERLAP the appointment — not merely share its
        // starting instant, which is what this check used to ask.
        const conflict = await findOverlappingViewing(
          tx,
          propertyId,
          resolved.value.scheduledAt,
          resolved.value.durationMinutes,
        );
        if (conflict) {
          return { error: new AppError('Time slot is no longer available', 409, 'TIME_CONFLICT') };
        }

        const viewing = await createViewing(tx, {
          propertyId,
          requesterOxyUserId,
          ownerOxyUserId,
          scheduledAt: resolved.value.scheduledAt,
          durationMinutes: resolved.value.durationMinutes,
          modality: resolved.value.modality,
          message: asText(message),
        });
        return { viewing, ownerOxyUserId, timeZone: resolved.value.timeZone };
      });

      if ('error' in outcome) return next(outcome.error);

      logger.info('Viewing request created', {
        viewingId: outcome.viewing.id,
        propertyId,
        requesterOxyUserId,
        ownerOxyUserId: outcome.ownerOxyUserId,
      });

      // Notify the property owner that someone requested a viewing. OUTSIDE the
      // transaction on purpose: dispatch is best-effort and swallows, and a
      // mailbox write must never be able to roll a booked viewing back.
      await notificationDispatchService.createForUser(outcome.ownerOxyUserId, {
        type: 'property',
        title: 'New viewing request',
        message: 'Someone requested a viewing for your property.',
        priority: 'high',
        data: { viewingId: outcome.viewing.id, propertyId, screen: '/viewings' },
      });

      res
        .status(201)
        .json(
          successResponse(
            serializeViewing(outcome.viewing, outcome.timeZone),
            'Viewing request created',
          ),
        );
    } catch (error) {
      next(error);
    }
  }

  /**
   * List viewing requests for current user (requester)
   */
  async listMyViewingRequests(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const oxyUserId = callerOf(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const db = getDb();
      const result = await listViewings(
        db,
        {
          requesterOxyUserId: oxyUserId,
          status: isViewingStatus(status) ? status : undefined,
        },
        { limit, offset: skip },
      );

      // One resolution for the whole page rather than a query per row: the
      // listings on a page of viewings are usually a handful, and each one's
      // zone is what makes its "10:00" mean anything.
      const zones = await resolveViewingTimeZones(
        db,
        result.rows.map((row) => row.propertyId),
      );

      res.json(
        paginationResponse(
          result.rows.map((row) => serializeViewing(row, zones.get(row.propertyId)?.timeZone)),
          page,
          limit,
          result.total,
          'Viewing requests retrieved',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * List viewing requests for a property
   * If requester calls this, returns only their own requests for that property
   * If owner calls this, returns all requests for the property
   */
  async listPropertyViewingRequests(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { propertyId } = req.params;
      const oxyUserId = callerOf(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const property = await findPropertyBookingBasis(db, propertyId);
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const isOwner = property.oxyUserId === oxyUserId;
      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const [result, zone] = await Promise.all([
        listViewings(
          db,
          {
            propertyId,
            // A non-owner sees only their own requests — the scope IS the
            // authorisation, so it belongs in the predicate rather than in a
            // filter applied to the results.
            requesterOxyUserId: isOwner ? undefined : oxyUserId,
            status: isViewingStatus(status) ? status : undefined,
          },
          { limit, offset: skip },
        ),
        resolveViewingTimeZone(db, propertyId),
      ]);

      res.json(
        paginationResponse(
          result.rows.map((row) => serializeViewing(row, zone.timeZone)),
          page,
          limit,
          result.total,
          'Viewing requests retrieved',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /** Approve a pending viewing request (owner only) */
  async approveViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const oxyUserId = callerOf(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const viewing = await findViewingById(db, viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      if (viewing.ownerOxyUserId !== oxyUserId) {
        return next(new AppError('Only the property owner can approve', 403, 'FORBIDDEN'));
      }
      if (viewing.status !== 'pending') {
        return next(new AppError('Only pending requests can be approved', 400, 'INVALID_STATE'));
      }

      // No OTHER approved request may OVERLAP this appointment.
      const conflict = await findOverlappingViewing(
        db,
        viewing.propertyId,
        viewing.scheduledAt,
        viewing.durationMinutes,
        { excludeId: viewing.id, statuses: ['approved'] },
      );
      if (conflict) return next(new AppError('Time slot already approved for another request', 409, 'TIME_CONFLICT'));

      const response = asText(req.body?.response);
      const approved = await decideViewing(db, viewingId, oxyUserId, 'approved', response);
      if (!approved) return next(new AppError('Only pending requests can be approved', 400, 'INVALID_STATE'));

      // Notify the requester that their viewing was approved. The owner's own
      // words, when they wrote any: a fixed English sentence is what the
      // requester used to be shown in place of whatever the landlord actually
      // said, and it is not translated here because it is one person writing to
      // another rather than a string this product owns.
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
      res.json(
        successResponse(serializeViewing(approved, zone.timeZone), 'Viewing request approved'),
      );
    } catch (error) {
      next(error);
    }
  }

  /** Decline a pending viewing request (owner only) */
  async declineViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const oxyUserId = callerOf(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const viewing = await findViewingById(db, viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      if (viewing.ownerOxyUserId !== oxyUserId) {
        return next(new AppError('Only the property owner can decline', 403, 'FORBIDDEN'));
      }
      if (viewing.status !== 'pending') {
        return next(new AppError('Only pending requests can be declined', 400, 'INVALID_STATE'));
      }

      const response = asText(req.body?.response);
      const declined = await decideViewing(db, viewingId, oxyUserId, 'declined', response);
      if (!declined) return next(new AppError('Only pending requests can be declined', 400, 'INVALID_STATE'));

      // The owner's own words. "Sorry, it went yesterday" and "I can do
      // Thursday instead" are different answers, and before `owner_response`
      // existed both of them arrived as the same fixed English sentence.
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
      res.json(
        successResponse(serializeViewing(declined, zone.timeZone), 'Viewing request declined'),
      );
    } catch (error) {
      next(error);
    }
  }

  /** Cancel a viewing request (requester or owner) */
  async cancelViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const oxyUserId = callerOf(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const viewing = await findViewingById(db, viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      const isRequester = viewing.requesterOxyUserId === oxyUserId;
      const isOwner = viewing.ownerOxyUserId === oxyUserId;
      if (!isRequester && !isOwner) return next(new AppError('Not authorized to cancel this request', 403, 'FORBIDDEN'));

      const zone = await resolveViewingTimeZone(db, viewing.propertyId);

      if (viewing.status === 'cancelled') {
        return res.json(
          successResponse(
            serializeViewing(viewing, zone.timeZone),
            'Viewing request already cancelled',
          ),
        );
      }

      // Both columns in one statement — the CHECK is an equivalence.
      const cancelled = await cancelViewing(
        db,
        viewingId,
        isOwner ? 'owner' : 'requester',
        isOwner ? asText(req.body?.response) : undefined,
      );
      if (!cancelled) {
        // Somebody else cancelled between the read and the write; the outcome
        // the caller asked for already holds, so this is not an error.
        const current = await findViewingById(db, viewingId);
        if (!current) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));
        return res.json(
          successResponse(
            serializeViewing(current, zone.timeZone),
            'Viewing request already cancelled',
          ),
        );
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

      res.json(
        successResponse(serializeViewing(cancelled, zone.timeZone), 'Viewing request cancelled'),
      );
    } catch (error) {
      next(error);
    }
  }

  /** Update a pending viewing request (requester only) */
  async updateViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const { date, time, modality, message } = req.body;
      const oxyUserId = callerOf(req);

      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const db = getDb();
      const viewing = await findViewingById(db, viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      // Only allow updating pending requests
      if (viewing.status !== 'pending') {
        return next(new AppError('Can only modify pending viewing requests', 400, 'CANNOT_MODIFY'));
      }

      // Only allow requester to modify
      if (viewing.requesterOxyUserId !== oxyUserId) {
        return next(new AppError('Not authorized to modify this viewing request', 403, 'FORBIDDEN'));
      }

      const now = new Date();
      // A reschedule is a new request for the same row, so it faces the same
      // rules: the same zone, the same published schedule, the same overlap
      // check. Under a lock, because moving an appointment on top of another is
      // the same race as booking one there.
      const outcome = await getDb().transaction(async (tx) => {
        const locked = (await lockPropertyBookingBases(tx, [viewing.propertyId])).get(
          viewing.propertyId,
        );
        if (!locked) return { error: new AppError('Property not found', 404, 'NOT_FOUND') };

        const resolved = await resolveRequestedTime(
          tx,
          viewing.propertyId,
          { date, time, modality: modality ?? viewing.modality },
          now,
        );
        if (!resolved.ok) return { error: resolved.error };

        const conflict = await findOverlappingViewing(
          tx,
          viewing.propertyId,
          resolved.value.scheduledAt,
          resolved.value.durationMinutes,
          { excludeId: viewingId },
        );
        if (conflict) {
          return { error: new AppError('Time slot is no longer available', 409, 'TIME_CONFLICT') };
        }

        const updated = await rescheduleViewing(tx, viewingId, oxyUserId, {
          scheduledAt: resolved.value.scheduledAt,
          durationMinutes: resolved.value.durationMinutes,
          modality: resolved.value.modality,
          message: asText(message),
        });
        if (!updated) {
          return {
            error: new AppError('Can only modify pending viewing requests', 400, 'CANNOT_MODIFY'),
          };
        }
        return { updated, timeZone: resolved.value.timeZone };
      });

      if ('error' in outcome) return next(outcome.error);

      logger.info('Viewing request updated', {
        viewingId,
        scheduledAt: outcome.updated.scheduledAt,
      });
      res.json(
        successResponse(
          serializeViewing(outcome.updated, outcome.timeZone),
          'Viewing request updated',
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}

export default new ViewingController();
