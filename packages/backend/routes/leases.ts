/**
 * Lease Routes
 * API routes for lease management
 */

const controllers = require('../controllers');
import express from 'express';
import { asyncHandler } from '../middlewares';
const { leaseController } = controllers;

module.exports = function() {
  const router = express.Router();

  router.get('/', asyncHandler(leaseController.getLeases));
  router.post('/', asyncHandler(leaseController.createLease));
  router.get('/:id', asyncHandler(leaseController.getLeaseById));
  router.put('/:id', asyncHandler(leaseController.updateLease));
  router.delete('/:id', asyncHandler(leaseController.deleteLease));

  return router;
};