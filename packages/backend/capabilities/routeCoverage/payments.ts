import type { RouteCoverage } from './types';

export const PAYMENT_ROUTE_COVERAGE: RouteCoverage = {
  'GET /api/leases/:id/payments': 'listLeasePayments',
  'POST /api/leases/:id/payments': 'createLeasePaymentObligation',
  'GET /api/leases/:id/ledger': 'getLeaseLedger',
  'GET /api/leases/:id/movements/:movementId/receipt': {
    excluded:
      'Returns a rendered HTML receipt as base64 for the app to save or print; getLeaseLedger already gives the confirmed movement it is built from, and the person downloads the receipt in Homiio.',
  },
  'POST /api/leases/:id/obligations/:obligationId/declarations': 'declareRentPayment',
  'POST /api/leases/:id/movements/:movementId/confirm': 'confirmRentPayment',
  'POST /api/leases/:id/movements/:movementId/reject': 'rejectRentPayment',
  'POST /api/leases/:id/movements/:movementId/refunds': 'refundRentPayment',
};
