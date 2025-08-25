/**
 * Validation Middleware
 * Handles request validation using various validation schemas
 */

import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { logger } from './logging';

/**
 * Handle validation errors
 */
const handleValidationErrors = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Log validation errors for debugging
    logger.error('Validation errors detected', {
      errors: errors.array(),
      body: req.body,
      params: req.params,
      query: req.query
    });
    
    const formattedErrors = errors.array().map((error: any) => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value,
      location: error.location
    }));
    
    return res.status(400).json({
      error: 'Validation failed',
      details: formattedErrors,
      message: `Validation failed for: ${formattedErrors.map(e => e.field).join(', ')}`
    });
  }
  next();
};

/**
 * Property validation rules
 */
const validateProperty = [
  body('description').optional().isString(),
  body('address.street').notEmpty().withMessage('Street address is required'),
  body('address.city').notEmpty().withMessage('City is required'),
  body('address.state').notEmpty().withMessage('State is required'),
  body('address').custom((value) => {
    if (!value.postal_code && !value.zipCode) {
      throw new Error('Postal code is required');
    }
    return true;
  }),
  body('rent.amount').isFloat({ min: 0.01 }).withMessage('Rent amount must be greater than 0'),
  body('rent.currency').optional().isIn(['USD', 'EUR', 'GBP', 'CAD', 'FAIR']).withMessage('Invalid currency'),
  body('bedrooms').optional().isInt({ min: 0 }).withMessage('Bedrooms must be a non-negative integer'),
  body('bathrooms').optional().isFloat({ min: 0 }).withMessage('Bathrooms must be non-negative'),
  body('squareFootage').optional().isFloat({ min: 0 }).withMessage('Square footage must be non-negative'),
  body('type').isIn(['apartment', 'house', 'room', 'studio', 'couchsurfing', 'roommates', 'coliving', 'hostel', 'guesthouse', 'campsite', 'boat', 'treehouse', 'yurt', 'other']).withMessage('Invalid property type'),
  body('housingType').optional().isIn(['private', 'public']).withMessage('Invalid housing type'),
];

/**
 * Lease validation rules
 */
const validateLease = [
  body('propertyId').notEmpty().withMessage('Property ID is required'),
  body('tenantId').notEmpty().withMessage('Tenant ID is required'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').optional().isISO8601().withMessage('End date must be valid'),
  body('rent.amount').isFloat({ min: 0 }).withMessage('Rent amount must be positive'),
  body('rent.dueDay').optional().isInt({ min: 1, max: 31 }).withMessage('Due day must be between 1-31'),
  body('terms.duration').optional().isInt({ min: 1 }).withMessage('Duration must be positive'),
  body('terms.noticePeriod').optional().isInt({ min: 0 }).withMessage('Notice period must be non-negative'),
  handleValidationErrors
];

/**
 * Payment validation rules
 */
const validatePayment = [
  body('leaseId').notEmpty().withMessage('Lease ID is required'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be positive'),
  body('type').isIn(['rent', 'deposit', 'late_fee', 'utility', 'maintenance']).withMessage('Invalid payment type'),
  body('paymentMethod').isIn(['faircoin', 'bank_transfer', 'credit_card', 'cash']).withMessage('Invalid payment method'),
  body('dueDate').isISO8601().withMessage('Valid due date is required'),
  body('fairCoin.walletTo').if(body('paymentMethod').equals('faircoin')).notEmpty().withMessage('FairCoin wallet address required'),
  handleValidationErrors
];

/**
 * Pagination validation
 */
const validatePagination = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
  query('sortBy').optional().isString().withMessage('SortBy must be a string'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('SortOrder must be asc or desc'),
  handleValidationErrors
];

/**
 * ID parameter validation
 */
const validateId = (paramName = 'id') => [
  param(paramName).matches(/^[a-zA-Z0-9_-]+$/).withMessage(`${paramName} must contain only alphanumeric characters, underscores, and hyphens`),
  handleValidationErrors
];

/**
 * Date range validation
 */
const validateDateRange = [
  query('startDate').optional().isISO8601().withMessage('Start date must be valid'),
  query('endDate').optional().isISO8601().withMessage('End date must be valid'),
  query('endDate').custom((value, { req }) => {
    if (value && req.query.startDate && new Date(value) <= new Date(req.query.startDate)) {
      throw new Error('End date must be after start date');
    }
    return true;
  }),
  handleValidationErrors
];

/**
 * File upload validation
 */
const validateFileUpload = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.file && !req.files) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const file = req.file || req.files[0];
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
  const maxSize = 10 * 1024 * 1024; // 10MB
  
  if (!allowedTypes.includes(file.mimetype)) {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  if (file.size > maxSize) {
    return res.status(400).json({ error: 'File too large' });
  }
  
  next();
};

export {
  handleValidationErrors,
  validateProperty,
  validateLease,
  validatePayment,
  validatePagination,
  validateId,
  validateDateRange,
  validateFileUpload,
};
/**
 * Viewing request validation rules
 */
const validateViewingRequest = [
  param('propertyId').isString().notEmpty().withMessage('Property ID is required'),
  body('date').isISO8601().withMessage('Valid date is required'),
  body('time').matches(/^\d{2}:\d{2}$/).withMessage('Time must be in HH:MM format'),
  body('message').optional().isString().isLength({ max: 1000 }).withMessage('Message max length is 1000'),
  handleValidationErrors
];

export { validateViewingRequest };
