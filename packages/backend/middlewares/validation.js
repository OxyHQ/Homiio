/**
 * Validation Middleware
 * Handles request validation using various validation schemas
 */

const { body, param, query, validationResult } = require('express-validator');

/**
 * Handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const { logger } = require('./logging');
    
    // Log validation errors for debugging
    logger.error('Validation errors detected', {
      errors: errors.array(),
      body: req.body,
      params: req.params,
      query: req.query
    });
    
    const formattedErrors = errors.array().map(error => ({
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
  body('address.zipCode').notEmpty().withMessage('ZIP code is required'),
  body('rent.amount').isFloat({ min: 0.01 }).withMessage('Rent amount must be greater than 0'),
  body('rent.currency').optional().isIn(['USD', 'EUR', 'GBP', 'CAD']).withMessage('Invalid currency'),
  body('bedrooms').optional().isInt({ min: 0 }).withMessage('Bedrooms must be a non-negative integer'),
  body('bathrooms').optional().isFloat({ min: 0 }).withMessage('Bathrooms must be a non-negative number'),
  body('squareFootage').optional().isFloat({ min: 0 }).withMessage('Square footage must be non-negative'),
  body('type').isIn(['apartment', 'house', 'room', 'studio', 'couchsurfing', 'roommates', 'coliving', 'hostel', 'guesthouse', 'campsite', 'boat', 'treehouse', 'yurt', 'other']).withMessage('Invalid property type'),
  body('housingType').optional().isIn(['private', 'public']).withMessage('Invalid housing type'),
  body('layoutType').optional().isIn(['open', 'shared', 'partitioned', 'traditional', 'studio', 'other']).withMessage('Invalid layout type'),
  handleValidationErrors
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
 * Energy data validation rules
 */
const validateEnergyData = [
  body('deviceId').notEmpty().withMessage('Device ID is required'),
  body('propertyId').notEmpty().withMessage('Property ID is required'),
  body('readings.voltage').isFloat({ min: 0 }).withMessage('Voltage must be positive'),
  body('readings.current').isFloat({ min: 0 }).withMessage('Current must be positive'),
  body('readings.power').isFloat({ min: 0 }).withMessage('Power must be positive'),
  body('readings.energy').optional().isFloat({ min: 0 }).withMessage('Energy must be positive'),
  body('timestamp').optional().isISO8601().withMessage('Timestamp must be valid ISO8601 date'),
  handleValidationErrors
];

/**
 * Device validation rules
 */
const validateDevice = [
  body('propertyId').notEmpty().withMessage('Property ID is required'),
  body('name').notEmpty().withMessage('Device name is required'),
  body('serialNumber').notEmpty().withMessage('Serial number is required'),
  body('macAddress').matches(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/).withMessage('Invalid MAC address format'),
  body('type').optional().isIn(['raspberry-pi', 'smart-meter', 'sensor']).withMessage('Invalid device type'),
  body('configuration.samplingRate').optional().isInt({ min: 1 }).withMessage('Sampling rate must be positive'),
  handleValidationErrors
];

/**
 * User validation rules
 */
const validateUser = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('username').isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters'),
  body('profile.firstName').notEmpty().withMessage('First name is required'),
  body('profile.lastName').notEmpty().withMessage('Last name is required'),
  body('profile.phoneNumber').optional().isMobilePhone().withMessage('Invalid phone number'),
  body('role').isIn(['tenant', 'landlord', 'property_manager', 'admin']).withMessage('Invalid role'),
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
const validateFileUpload = (req, res, next) => {
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

module.exports = {
  handleValidationErrors,
  validateProperty,
  validateLease,
  validatePayment,
  validateEnergyData,
  validateDevice,
  validateUser,
  validatePagination,
  validateId,
  validateDateRange,
  validateFileUpload
};
