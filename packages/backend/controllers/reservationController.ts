/**
 * Reservation Controller — the HTTP adapter for `domain/reservations.ts`.
 *
 * The short-stay lifecycle (pricing, the occupancy question, who may move a
 * booking where, the cancellation policy) lives in the domain module, which
 * the catalogue tools call too. Each handler here reads the session and the
 * request and answers what the route has always answered — including the
 * historical 400 `EXTERNAL_PROPERTY` for an external listing, which the domain
 * reports as a typed `external_listing` outcome.
 */

import type { NextFunction, Request, Response } from 'express';

import {
  createReservation,
  getListingAvailability,
  getReservation,
  listMyReservations,
  reservationPage,
  updateReservationStatus,
} from '../domain/reservations';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';

function requireCaller(req: Request): string {
  const oxyUserId = req.user?.id || req.user?._id || req.userId;
  if (!oxyUserId) throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  return oxyUserId;
}

class ReservationController {
  /** POST /api/reservations — guest creates a reservation (auto-confirms with instant book). */
  async createReservation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const { propertyId, checkIn, checkOut, guestCount, specialRequests } = req.body;
      const outcome = await createReservation(oxyUserId, {
        propertyId,
        checkIn,
        checkOut,
        guestCount,
        specialRequests,
      });
      if (outcome.status === 'external_listing') {
        throw new AppError('Cannot book external listings', 400, 'EXTERNAL_PROPERTY');
      }
      res.status(201).json(successResponse(outcome.reservation, 'Reservation created'));
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/reservations — as guest, or as host with `?asHost=true`. */
  async listMyReservations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const result = await listMyReservations(oxyUserId, {
        ...reservationPage(req.query.page, req.query.limit),
        status: req.query.status,
        asHost: String(req.query.asHost) === 'true',
      });
      res.json(
        paginationResponse(
          result.rows,
          result.page,
          result.limit,
          result.total,
          'Reservations retrieved',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/reservations/:id */
  async getReservationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const reservation = await getReservation(oxyUserId, { reservationId: req.params.id });
      res.json(successResponse(reservation, 'Reservation retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/reservations/:id — host approves/declines, guest or host cancels. */
  async updateReservationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const outcome = await updateReservationStatus(oxyUserId, {
        reservationId: req.params.id,
        status: req.body?.status,
      });
      res.json(
        successResponse(
          outcome.reservation,
          outcome.alreadyCancelled ? 'Reservation already cancelled' : 'Reservation updated',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/properties/:id/availability — PUBLIC (`routes/public.ts`).
   *
   * Reads NOTHING from `req.user`, which is the condition `AGENTS.md` sets for a
   * handler on the public router; the projection's privacy rule is in the
   * domain function.
   */
  async getPropertyAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await getListingAvailability({ propertyId: req.params.id });
      res.json(successResponse(data, 'Availability retrieved'));
    } catch (error) {
      next(error);
    }
  }
}

export default new ReservationController();
