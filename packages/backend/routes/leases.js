/**
 * Lease Routes
 * API routes for lease management
 */

const express = require('express');
const { leaseController } = require('../controllers');
const { auth, validation } = require('../middlewares');

const router = express.Router();

// Protected routes (authentication required)
router.use(auth.verifyToken);

// Lease CRUD operations
router.get('/', leaseController.getLeases);
router.post('/', validation.validateLease, leaseController.createLease);
router.get('/:leaseId', 
  validation.validateId('leaseId'),
  auth.verifyLeaseParticipation,
  leaseController.getLeaseById
);
router.put('/:leaseId', 
  validation.validateId('leaseId'),
  auth.verifyLeaseParticipation,
  validation.validateLease,
  leaseController.updateLease
);
router.delete('/:leaseId', 
  validation.validateId('leaseId'),
  auth.verifyLeaseParticipation,
  leaseController.deleteLease
);

// Lease lifecycle management
router.post('/:leaseId/sign', 
  validation.validateId('leaseId'),
  auth.verifyLeaseParticipation,
  leaseController.signLease
);
router.post('/:leaseId/terminate', 
  validation.validateId('leaseId'),
  auth.verifyLeaseParticipation,
  leaseController.terminateLease
);
router.post('/:leaseId/renew', 
  validation.validateId('leaseId'),
  auth.verifyLeaseParticipation,
  leaseController.renewLease
);

// Lease payments
router.get('/:leaseId/payments', 
  validation.validateId('leaseId'),
  auth.verifyLeaseParticipation,
  leaseController.getLeasePayments
);
router.post('/:leaseId/payments', 
  validation.validateId('leaseId'),
  auth.verifyLeaseParticipation,
  validation.validatePayment,
  leaseController.createPayment
);

// Lease documents
router.get('/:leaseId/documents', 
  validation.validateId('leaseId'),
  auth.verifyLeaseParticipation,
  leaseController.getLeaseDocuments
);
router.post('/:leaseId/documents', 
  validation.validateId('leaseId'),
  auth.verifyLeaseParticipation,
  validation.validateFileUpload,
  leaseController.uploadLeaseDocument
);

module.exports = router;