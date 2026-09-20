/**
 * Viewing availability — when may somebody ask to see this home? (#518 §7.5)
 *
 * Two surfaces over `property_viewing_windows`:
 *
 *  - **`GET /api/properties/:id/viewing-availability`** — PUBLIC, mounted on
 *    `routes/public.ts`. Choosing a time is something a visitor does before
 *    they have an account, exactly as choosing dates is; the stay calendar is
 *    public for that reason and this is the same argument. It is safe on that
 *    router because of what it RETURNS, not because of anything it checks: the
 *    weekly windows the owner published, the free slots they produce, and the
 *    zone those clock times are in. No requester, no owner, no viewing id, no
 *    message. A taken slot is simply absent from the list — which says a time
 *    is unavailable without saying who has it. It reads nothing from
 *    `req.user`, which is the condition `AGENTS.md` sets for a handler here.
 *
 *  - **`GET` / `PUT /api/properties/:id/viewing-windows`** — the owner's own
 *    schedule, on the authenticated router. Ownership is the repository's
 *    predicate (`lockOwnedPropertyForSchedule`), so somebody else's listing
 *    answers 404 rather than 403 and a prober cannot use the endpoint to
 *    enumerate which listings exist.
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
 * response says `published: false` and carries an empty `slots`, and the screen
 * says the owner has not published times instead of making some up.
 *
 * Once a window exists the schedule is binding: a requested instant must BE one
 * of the offered slots, matched by instant against the generator's own output
 * rather than re-derived, so the offer and the acceptance cannot drift.
 */

import type { Request, Response, NextFunction } from 'express';

import {
  VIEWING_HORIZON_DEFAULT_DAYS,
  VIEWING_HORIZON_MAX_DAYS,
  isSupportedTimeZone,
  isViewingModality,
  type ViewingAvailability,
} from '@homiio/shared-types';

import { getDb } from '../db/postgres';
import { properties } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  findBusyViewingIntervals,
  generateViewingSlots,
  listViewingWindows,
  lockOwnedPropertyForSchedule,
  parseViewingWindows,
  replaceViewingWindows,
  serializeViewingWindow,
} from '../db/availability/viewingWindows';
import { resolveViewingTimeZone } from '../db/availability/viewingTimeZone';
import { findPropertyBookingBasis } from '../db/properties/propertyBookingBasis';
import { AppError, successResponse } from '../middlewares/errorHandler';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The requested horizon, clamped to what the generator will answer. */
function horizonDays(query: Request['query']): number {
  const asked = parseInt(String(query.days ?? ''), 10);
  if (!Number.isFinite(asked) || asked <= 0) return VIEWING_HORIZON_DEFAULT_DAYS;
  return Math.min(asked, VIEWING_HORIZON_MAX_DAYS);
}

/**
 * Everything the availability answer needs, in one place.
 *
 * Shared by the public endpoint and by `viewingController`'s create and
 * reschedule paths, because "which slots are on offer" must have exactly one
 * implementation: a second one written for the write path is how a screen ends
 * up offering a slot the server then refuses.
 */
export async function buildViewingAvailability(
  db: Parameters<typeof listViewingWindows>[0],
  propertyId: string,
  options: { readonly now?: Date; readonly days?: number } = {},
): Promise<ViewingAvailability> {
  const now = options.now ?? new Date();
  const days = options.days ?? VIEWING_HORIZON_DEFAULT_DAYS;

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

class ViewingAvailabilityController {
  /** The slots a listing offers. PUBLIC — see the module header. */
  async getViewingAvailability(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void | Response> {
    try {
      const { propertyId } = req.params;
      const db = getDb();

      const property = await findPropertyBookingBasis(db, propertyId);
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      // External listings have no in-app viewing at all, so they publish no
      // slots — the same refusal the create path makes, stated before somebody
      // picks a time rather than after.
      if (property.isExternal) {
        return next(
          new AppError(
            'Cannot book viewings for external properties',
            400,
            'EXTERNAL_PROPERTY',
          ),
        );
      }

      const availability = await buildViewingAvailability(db, propertyId, {
        days: horizonDays(req.query),
      });
      res.json(successResponse(availability, 'Viewing availability retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /** The owner's own schedule, including the zone it is expressed in. */
  async getViewingWindows(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void | Response> {
    try {
      const { propertyId } = req.params;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const db = getDb();
      // Ownership IS the predicate; a stranger's listing is indistinguishable
      // from one that does not exist.
      const owned = await lockOwnedPropertyForSchedule(db, propertyId, oxyUserId);
      if (!owned) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const [zone, windows] = await Promise.all([
        resolveViewingTimeZone(db, propertyId),
        listViewingWindows(db, propertyId),
      ]);

      res.json(
        successResponse(
          {
            propertyId,
            timeZone: zone.timeZone,
            timeZoneSource: zone.source,
            windows: windows.map(serializeViewingWindow),
          },
          'Viewing schedule retrieved',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Replace the schedule, and optionally the zone it is expressed in.
   *
   * One endpoint for both because they are one fact: "17:00" is not a time
   * until the zone is known, so an owner who moves their windows and their zone
   * in two requests is briefly offering slots at an hour they did not choose.
   */
  async putViewingWindows(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void | Response> {
    try {
      const { propertyId } = req.params;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const parsed = parseViewingWindows(req.body?.windows ?? []);
      if (!parsed.ok) {
        return next(
          new AppError(
            parsed.rejection.index >= 0
              ? `Window ${parsed.rejection.index}: ${parsed.rejection.reason}`
              : parsed.rejection.reason,
            400,
            'INVALID_VIEWING_WINDOW',
          ),
        );
      }

      const rawTimeZone = req.body?.timeZone;
      // `null` clears the owner's statement and falls back to the city; absent
      // leaves it alone; anything else has to be a zone `Intl` knows. No CHECK
      // does this — an IANA name is a FORMAT, and CONVENTIONS.md keeps format
      // validators out of the schema — so this is the only place it happens.
      let timeZoneUpdate: string | null | undefined;
      if (rawTimeZone === null) timeZoneUpdate = null;
      else if (rawTimeZone !== undefined) {
        if (!isSupportedTimeZone(rawTimeZone)) {
          return next(new AppError('Unknown time zone', 400, 'INVALID_TIMEZONE'));
        }
        timeZoneUpdate = rawTimeZone;
      }

      const outcome = await getDb().transaction(async (tx) => {
        const owned = await lockOwnedPropertyForSchedule(tx, propertyId, oxyUserId);
        if (!owned) return { error: new AppError('Property not found', 404, 'NOT_FOUND') };

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

      if ('error' in outcome) return next(outcome.error);

      res.json(
        successResponse(
          {
            propertyId,
            timeZone: outcome.zone.timeZone,
            timeZoneSource: outcome.zone.source,
            windows: outcome.windows.map(serializeViewingWindow),
          },
          'Viewing schedule updated',
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}

export const viewingAvailabilityController = new ViewingAvailabilityController();
export default viewingAvailabilityController;

/** Validate a modality from a request body, defaulting to an in-person visit. */
export function modalityFrom(value: unknown): 'in_person' | 'video' | undefined {
  if (value === undefined || value === null) return 'in_person';
  return isViewingModality(value) ? value : undefined;
}
