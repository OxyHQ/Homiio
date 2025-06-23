/**
 * Lease Routes
 * API routes for lease management
 */

const express = require('express');
const { leaseController } = require('../controllers');
const { validation, asyncHandler } = require('../middlewares');

module.exports = function(authenticateToken) {
  const router = express.Router();

  // Protected routes (authentication required)
  router.use(authenticateToken);

  // Lease CRUD operations
  router.get('/', asyncHandler(leaseController.getLeases));
  router.post('/', validation.validateLease, asyncHandler(leaseController.createLease));
  router.get('/:leaseId', 
    validation.validateId('leaseId'),
    asyncHandler(leaseController.getLeaseById)
  );
  router.put('/:leaseId', 
    validation.validateId('leaseId'),
    validation.validateLease,
    asyncHandler(leaseController.updateLease)
  );
  router.delete('/:leaseId', 
    validation.validateId('leaseId'),
    asyncHandler(leaseController.deleteLease)
  );

  // Lease lifecycle management
  router.post('/:leaseId/sign', 
    validation.validateId('leaseId'),
    asyncHandler(leaseController.signLease)
  );
  router.post('/:leaseId/terminate', 
    validation.validateId('leaseId'),
    asyncHandler(leaseController.terminateLease)
  );
  router.post('/:leaseId/renew', 
    validation.validateId('leaseId'),
    asyncHandler(leaseController.renewLease)
  );

  // Lease payments
  router.get('/:leaseId/payments', 
    validation.validateId('leaseId'),
    asyncHandler(leaseController.getLeasePayments)
  );
  router.post('/:leaseId/payments', 
    validation.validateId('leaseId'),
    validation.validatePayment,
    asyncHandler(leaseController.createPayment)
  );

  // Lease documents
  router.get('/:leaseId/documents', 
    validation.validateId('leaseId'),
    asyncHandler(leaseController.getLeaseDocuments)
  );
  router.post('/:leaseId/documents', 
    validation.validateId('leaseId'),
    validation.validateFileUpload,
    asyncHandler(leaseController.uploadLeaseDocument)
  );

  return router;
};