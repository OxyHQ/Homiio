/**
 * Lease Controller
 * Handles lease management operations
 */

const { successResponse, paginationResponse, AppError } = require('../middlewares/errorHandler');
const { logger } = require('../middlewares/logging');

class LeaseController {
  /**
   * Get user's leases
   */
  async getLeases(req, res, next) {
    try {
      const userId = req.userId;
      const {
        page = 1,
        limit = 10,
        status,
        propertyId,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // In a real implementation, fetch leases from database
      // const leases = await LeaseModel.findByParticipant(userId, filters);

      const mockLeases = [
        {
          id: 'lease_1',
          propertyId: 'prop_1',
          landlordId: 'user_landlord_1',
          tenantId: userId,
          status: 'active',
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-12-31T23:59:59Z',
          rent: {
            amount: 1200,
            currency: 'USD',
            dueDay: 1,
            paymentMethod: 'bank_transfer'
          },
          deposit: {
            amount: 1200,
            currency: 'USD',
            status: 'paid'
          },
          terms: {
            duration: 12, // months
            noticePeriod: 30, // days
            petPolicy: 'allowed',
            smokingPolicy: 'not_allowed',
            maintenanceResponsibility: 'landlord'
          },
          signatures: {
            landlord: {
              signedAt: '2023-12-15T10:00:00Z',
              ipAddress: '192.168.1.1'
            },
            tenant: {
              signedAt: '2023-12-16T14:30:00Z',
              ipAddress: '192.168.1.100'
            }
          },
          createdAt: '2023-12-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 'lease_2',
          propertyId: 'prop_2',
          landlordId: userId,
          tenantId: 'user_tenant_1',
          status: 'pending_signature',
          startDate: '2024-03-01T00:00:00Z',
          endDate: '2025-02-28T23:59:59Z',
          rent: {
            amount: 950,
            currency: 'USD',
            dueDay: 5,
            paymentMethod: 'faircoin'
          },
          deposit: {
            amount: 950,
            currency: 'USD',
            status: 'pending'
          },
          terms: {
            duration: 12,
            noticePeriod: 30,
            petPolicy: 'not_allowed',
            smokingPolicy: 'not_allowed',
            maintenanceResponsibility: 'shared'
          },
          signatures: {
            landlord: {
              signedAt: '2024-02-15T09:00:00Z',
              ipAddress: '192.168.1.1'
            },
            tenant: null
          },
          createdAt: '2024-02-01T00:00:00Z',
          updatedAt: '2024-02-15T09:00:00Z'
        }
      ];

      // Apply filters
      let filteredLeases = mockLeases;
      if (status) {
        filteredLeases = filteredLeases.filter(l => l.status === status);
      }
      if (propertyId) {
        filteredLeases = filteredLeases.filter(l => l.propertyId === propertyId);
      }

      const total = filteredLeases.length;

      res.json(paginationResponse(
        filteredLeases,
        parseInt(page),
        parseInt(limit),
        total,
        'Leases retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new lease
   */
  async createLease(req, res, next) {
    try {
      const leaseData = {
        ...req.body,
        landlordId: req.userId,
        status: 'draft',
        createdAt: new Date(),
        signatures: {
          landlord: null,
          tenant: null
        }
      };

      // In a real implementation, validate property ownership and save to database
      // const property = await PropertyModel.findById(leaseData.propertyId);
      // if (property.ownerId !== req.userId) {
      //   throw new AppError('Access denied to this property', 403, 'FORBIDDEN');
      // }
      // const lease = await LeaseModel.create(leaseData);

      const newLease = {
        id: `lease_${Date.now()}`,
        ...leaseData
      };

      logger.info('Lease created', {
        leaseId: newLease.id,
        landlordId: req.userId,
        propertyId: leaseData.propertyId
      });

      res.status(201).json(successResponse(
        newLease,
        'Lease created successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get lease by ID
   */
  async getLeaseById(req, res, next) {
    try {
      const { leaseId } = req.params;

      // In a real implementation, fetch from database
      // const lease = await LeaseModel.findById(leaseId);

      const mockLease = {
        id: leaseId,
        propertyId: 'prop_1',
        property: {
          id: 'prop_1',
          title: 'Downtown Apartment',
          address: {
            street: '123 Main St',
            city: 'San Francisco',
            state: 'CA',
            zipCode: '94102'
          }
        },
        landlordId: 'user_landlord_1',
        landlord: {
          id: 'user_landlord_1',
          firstName: 'John',
          lastName: 'Smith',
          email: 'landlord@example.com',
          phone: '+1234567890'
        },
        tenantId: req.userId,
        tenant: {
          id: req.userId,
          firstName: 'Jane',
          lastName: 'Doe',
          email: req.user.email,
          phone: '+1234567891'
        },
        status: 'active',
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
        rent: {
          amount: 1200,
          currency: 'USD',
          dueDay: 1,
          paymentMethod: 'bank_transfer',
          lateFee: {
            amount: 50,
            gracePeriod: 5
          }
        },
        deposit: {
          amount: 1200,
          currency: 'USD',
          status: 'paid',
          paidAt: '2023-12-20T10:00:00Z'
        },
        terms: {
          duration: 12,
          noticePeriod: 30,
          petPolicy: 'allowed',
          smokingPolicy: 'not_allowed',
          maintenanceResponsibility: 'landlord',
          utilitiesIncluded: ['water', 'trash'],
          additionalTerms: [
            'No subleasing without written consent',
            'Quiet hours from 10 PM to 8 AM',
            'Maximum 2 guests for overnight stays'
          ]
        },
        signatures: {
          landlord: {
            signedAt: '2023-12-15T10:00:00Z',
            ipAddress: '192.168.1.1',
            signature: 'digital_signature_hash_landlord'
          },
          tenant: {
            signedAt: '2023-12-16T14:30:00Z',
            ipAddress: '192.168.1.100',
            signature: 'digital_signature_hash_tenant'
          }
        },
        documents: [
          {
            id: 'doc_1',
            type: 'lease_agreement',
            filename: 'lease_agreement.pdf',
            uploadedAt: '2023-12-01T10:00:00Z'
          },
          {
            id: 'doc_2',
            type: 'move_in_checklist',
            filename: 'move_in_checklist.pdf',
            uploadedAt: '2023-12-31T09:00:00Z'
          }
        ],
        createdAt: '2023-12-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      };

      res.json(successResponse(mockLease, 'Lease retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update lease
   */
  async updateLease(req, res, next) {
    try {
      const { leaseId } = req.params;
      const updateData = req.body;

      // In a real implementation, update in database with proper validation
      // const lease = await LeaseModel.findById(leaseId);
      // if (lease.status === 'signed' && updateData.modifies_critical_terms) {
      //   throw new AppError('Cannot modify signed lease terms', 400, 'INVALID_OPERATION');
      // }

      const updatedLease = {
        id: leaseId,
        ...updateData,
        updatedAt: new Date().toISOString()
      };

      logger.info('Lease updated', { leaseId, updatedBy: req.userId });

      res.json(successResponse(updatedLease, 'Lease updated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete lease
   */
  async deleteLease(req, res, next) {
    try {
      const { leaseId } = req.params;

      // In a real implementation, check if lease can be deleted and soft delete
      // const lease = await LeaseModel.findById(leaseId);
      // if (lease.status === 'active') {
      //   throw new AppError('Cannot delete active lease', 400, 'INVALID_OPERATION');
      // }
      // await LeaseModel.softDelete(leaseId);

      logger.info('Lease deleted', { leaseId, deletedBy: req.userId });

      res.json(successResponse(null, 'Lease deleted successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Sign lease
   */
  async signLease(req, res, next) {
    try {
      const { leaseId } = req.params;
      const { signature, acceptTerms } = req.body;

      if (!acceptTerms) {
        throw new AppError('Must accept terms to sign lease', 400, 'TERMS_NOT_ACCEPTED');
      }

      // In a real implementation, record signature and update lease status
      // const lease = await LeaseModel.findById(leaseId);
      // const userRole = lease.landlordId === req.userId ? 'landlord' : 'tenant';
      // await LeaseModel.addSignature(leaseId, userRole, {
      //   signedAt: new Date(),
      //   signature: signature,
      //   ipAddress: req.ip
      // });

      const signedLease = {
        id: leaseId,
        status: 'partially_signed', // or 'fully_signed' if both parties signed
        signatures: {
          // Updated signatures object
        },
        updatedAt: new Date().toISOString()
      };

      logger.info('Lease signed', { 
        leaseId, 
        signedBy: req.userId,
        userAgent: req.get('User-Agent')
      });

      res.json(successResponse(signedLease, 'Lease signed successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Terminate lease
   */
  async terminateLease(req, res, next) {
    try {
      const { leaseId } = req.params;
      const { reason, terminationDate, notice } = req.body;

      // In a real implementation, handle lease termination process
      // const lease = await LeaseModel.findById(leaseId);
      // await LeaseModel.initializeTermination(leaseId, {
      //   initiatedBy: req.userId,
      //   reason: reason,
      //   terminationDate: terminationDate,
      //   notice: notice
      // });

      logger.info('Lease termination initiated', { 
        leaseId, 
        initiatedBy: req.userId,
        reason: reason
      });

      res.json(successResponse(null, 'Lease termination initiated'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Renew lease
   */
  async renewLease(req, res, next) {
    try {
      const { leaseId } = req.params;
      const { newEndDate, rentIncrease, updatedTerms } = req.body;

      // In a real implementation, create lease renewal
      // const originalLease = await LeaseModel.findById(leaseId);
      // const renewalLease = await LeaseModel.createRenewal(leaseId, {
      //   newEndDate: newEndDate,
      //   rentIncrease: rentIncrease,
      //   updatedTerms: updatedTerms
      // });

      const renewalLease = {
        id: `lease_${Date.now()}_renewal`,
        originalLeaseId: leaseId,
        status: 'pending_signature',
        newEndDate: newEndDate,
        rentIncrease: rentIncrease,
        updatedTerms: updatedTerms,
        createdAt: new Date().toISOString()
      };

      logger.info('Lease renewal created', { 
        originalLeaseId: leaseId, 
        renewalLeaseId: renewalLease.id,
        createdBy: req.userId
      });

      res.json(successResponse(renewalLease, 'Lease renewal created'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get lease payments
   */
  async getLeasePayments(req, res, next) {
    try {
      const { leaseId } = req.params;
      const { page = 1, limit = 10, status } = req.query;

      // In a real implementation, fetch payments from database
      // const payments = await PaymentModel.findByLeaseId(leaseId, filters);

      const mockPayments = [
        {
          id: 'payment_1',
          leaseId: leaseId,
          type: 'rent',
          amount: 1200,
          currency: 'USD',
          dueDate: '2024-01-01T00:00:00Z',
          paidAt: '2023-12-30T15:00:00Z',
          status: 'paid',
          paymentMethod: 'bank_transfer',
          reference: 'TXN123456'
        },
        {
          id: 'payment_2',
          leaseId: leaseId,
          type: 'rent',
          amount: 1200,
          currency: 'USD',
          dueDate: '2024-02-01T00:00:00Z',
          paidAt: '2024-02-01T10:30:00Z',
          status: 'paid',
          paymentMethod: 'bank_transfer',
          reference: 'TXN123457'
        }
      ];

      const total = mockPayments.length;

      res.json(paginationResponse(
        mockPayments,
        parseInt(page),
        parseInt(limit),
        total,
        'Lease payments retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create payment
   */
  async createPayment(req, res, next) {
    try {
      const { leaseId } = req.params;
      const paymentData = {
        ...req.body,
        leaseId: leaseId,
        createdBy: req.userId,
        status: 'pending'
      };

      // In a real implementation, create payment and process
      // const payment = await PaymentModel.create(paymentData);
      // await PaymentProcessor.process(payment);

      const newPayment = {
        id: `payment_${Date.now()}`,
        ...paymentData,
        createdAt: new Date().toISOString()
      };

      logger.info('Payment created', {
        paymentId: newPayment.id,
        leaseId: leaseId,
        amount: paymentData.amount,
        createdBy: req.userId
      });

      res.status(201).json(successResponse(
        newPayment,
        'Payment created successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get lease documents
   */
  async getLeaseDocuments(req, res, next) {
    try {
      const { leaseId } = req.params;

      // In a real implementation, fetch documents from database
      const mockDocuments = [
        {
          id: 'doc_1',
          leaseId: leaseId,
          type: 'lease_agreement',
          filename: 'lease_agreement.pdf',
          size: 256789,
          uploadedBy: 'user_landlord_1',
          uploadedAt: '2023-12-01T10:00:00Z',
          downloadUrl: '/api/leases/lease_1/documents/doc_1/download'
        },
        {
          id: 'doc_2',
          leaseId: leaseId,
          type: 'move_in_checklist',
          filename: 'move_in_checklist.pdf',
          size: 128456,
          uploadedBy: 'user_tenant_1',
          uploadedAt: '2023-12-31T09:00:00Z',
          downloadUrl: '/api/leases/lease_1/documents/doc_2/download'
        }
      ];

      res.json(successResponse(mockDocuments, 'Lease documents retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upload lease document
   */
  async uploadLeaseDocument(req, res, next) {
    try {
      const { leaseId } = req.params;
      const { type, description } = req.body;
      const file = req.file;

      // In a real implementation, save file and create document record
      // const savedFile = await FileStorage.save(file);
      // const document = await DocumentModel.create({
      //   leaseId: leaseId,
      //   type: type,
      //   filename: file.originalname,
      //   fileUrl: savedFile.url,
      //   uploadedBy: req.userId
      // });

      const newDocument = {
        id: `doc_${Date.now()}`,
        leaseId: leaseId,
        type: type,
        filename: file.originalname,
        size: file.size,
        description: description,
        uploadedBy: req.userId,
        uploadedAt: new Date().toISOString(),
        downloadUrl: `/api/leases/${leaseId}/documents/doc_${Date.now()}/download`
      };

      logger.info('Lease document uploaded', {
        documentId: newDocument.id,
        leaseId: leaseId,
        filename: file.originalname,
        uploadedBy: req.userId
      });

      res.status(201).json(successResponse(
        newDocument,
        'Document uploaded successfully'
      ));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new LeaseController();