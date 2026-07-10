/**
 * Lease Routes
 *
 * Mounted at /api/leases (authenticated via global oxy.auth() in server.ts).
 * Static sub-resource routes are declared before the `/:id` params so a path
 * segment like `payments` is never swallowed by the id matcher. List filtering
 * is done with query params (`?status=`, `?propertyId=`) — there are no
 * `/active` or `/pending-signature` convenience routes.
 */

const controllers = require('../controllers');
import express from 'express';
import { asyncHandler } from '../middlewares';
const validation = require('../middlewares/validation');
const { leaseController } = controllers;

module.exports = function() {
  const router = express.Router();

  router.get('/', validation.validateLeaseListQuery, asyncHandler(leaseController.getLeases));
  router.post('/', validation.validateLeaseCreate, asyncHandler(leaseController.createLease));

  // Sub-resource + lifecycle routes (static-segment first).
  router.get('/:id/payments', validation.validateLeaseId, asyncHandler(leaseController.getLeasePayments));
  router.post('/:id/payments', validation.validateLeaseId, asyncHandler(leaseController.createPayment));
  router.get('/:id/documents', validation.validateLeaseId, asyncHandler(leaseController.getLeaseDocuments));
  router.post('/:id/documents', validation.validateLeaseId, asyncHandler(leaseController.uploadLeaseDocument));
  router.post('/:id/sign', validation.validateLeaseId, asyncHandler(leaseController.signLease));
  router.post('/:id/terminate', validation.validateLeaseId, asyncHandler(leaseController.terminateLease));
  router.post('/:id/renew', validation.validateLeaseId, asyncHandler(leaseController.renewLease));

  router.get('/:id', validation.validateLeaseId, asyncHandler(leaseController.getLeaseById));
  router.put('/:id', validation.validateLeaseUpdate, asyncHandler(leaseController.updateLease));
  router.delete('/:id', validation.validateLeaseId, asyncHandler(leaseController.deleteLease));

  return router;
};
