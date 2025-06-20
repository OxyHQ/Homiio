/**
 * Lease Routes
 * API routes for lease management
 */

const express = require('express');
const { leaseController } = require('../controllers');
const { validation } = require('../middlewares');

module.exports = function(authenticateToken) {
  const router = express.Router();

  // Protected routes (authentication required)
  router.use(authenticateToken);

  // Lease CRUD operations
  router.get('/', leaseController.getLeases);
  router.post('/', validation.validateLease, leaseController.createLease);
  router.get('/:leaseId', 
    validation.validateId('leaseId'),
    leaseController.getLeaseById
  );
  router.put('/:leaseId', 
    validation.validateId('leaseId'),
    validation.validateLease,
    leaseController.updateLease
  );
  router.delete('/:leaseId', 
    validation.validateId('leaseId'),
    leaseController.deleteLease
  );

  // Lease lifecycle management
  router.post('/:leaseId/sign', 
    validation.validateId('leaseId'),
    leaseController.signLease
  );
  router.post('/:leaseId/terminate', 
    validation.validateId('leaseId'),
    leaseController.terminateLease
  );
  router.post('/:leaseId/renew', 
    validation.validateId('leaseId'),
    leaseController.renewLease
  );

  // Lease payments
  router.get('/:leaseId/payments', 
    validation.validateId('leaseId'),
    leaseController.getLeasePayments
  );
  router.post('/:leaseId/payments', 
    validation.validateId('leaseId'),
    validation.validatePayment,
    leaseController.createPayment
  );

  // Lease documents
  router.get('/:leaseId/documents', 
    validation.validateId('leaseId'),
    leaseController.getLeaseDocuments
  );
  router.post('/:leaseId/documents', 
    validation.validateId('leaseId'),
    validation.validateFileUpload,
    leaseController.uploadLeaseDocument
  );

  return router;
};