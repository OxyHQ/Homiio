/**
 * Reservation Routes
 *
 * Mounted at /api/reservations (authenticated via global oxy.auth() in server.ts).
 * Handles the vacation/short-term booking lifecycle.
 */

import express from 'express';
import { asyncHandler } from '../middlewares';

export default function () {
  const router = express.Router();

  const reservationController = require('../controllers/reservationController');
  const validation = require('../middlewares/validation');

  // POST /api/reservations — guest creates a reservation
  router.post(
    '/',
    validation.validateReservation,
    asyncHandler(reservationController.createReservation)
  );

  // GET /api/reservations — list my reservations (as guest or ?asHost=true)
  router.get(
    '/',
    asyncHandler(reservationController.listMyReservations)
  );

  // GET /api/reservations/:id — view a single reservation
  router.get(
    '/:id',
    asyncHandler(reservationController.getReservationById)
  );

  // PATCH /api/reservations/:id — host approves/declines, guest cancels
  router.patch(
    '/:id',
    validation.validateReservationUpdate,
    asyncHandler(reservationController.updateReservationStatus)
  );

  return router;
}
