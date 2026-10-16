import type { RouteCoverage } from './types';

export const RESERVATION_ROUTE_COVERAGE: RouteCoverage = {
  'POST /api/reservations': 'createReservation',
  'GET /api/reservations': 'listMyReservations',
  'GET /api/reservations/:id': 'getReservation',
  // One PATCH, three tools, each fixing the status the route reads from its body.
  'PATCH /api/reservations/:id': ['confirmReservation', 'declineReservation', 'cancelReservation'],
};
