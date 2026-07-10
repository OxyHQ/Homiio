/**
 * Validation Middleware
 * Handles request validation using various validation schemas
 */

import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { logger } from './logging';

/** Currency codes accepted on every priced block (rent / sale / exchange). */
const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'CAD', 'FAIR'];

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

    res.status(400).json({
      error: 'Validation failed',
      details: formattedErrors,
      message: `Validation failed for: ${formattedErrors.map(e => e.field).join(', ')}`
    });
    return;
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
  body('address').custom((value: { postal_code?: unknown; zipCode?: unknown } | undefined) => {
    // `value` is undefined when the body carries an `addressId` instead of an
    // inline `address`; guard so this produces a clean 400 (not a TypeError 500).
    if (!value || (!value.postal_code && !value.zipCode)) {
      throw new Error('Postal code is required');
    }
    return true;
  }),
  body('bedrooms').optional().isInt({ min: 0 }).withMessage('Bedrooms must be a non-negative integer'),
  body('bathrooms').optional().isFloat({ min: 0 }).withMessage('Bathrooms must be non-negative'),
  body('squareFootage').optional().isFloat({ min: 0 }).withMessage('Square footage must be non-negative'),
  body('type').isIn(['apartment', 'house', 'room', 'studio', 'couchsurfing', 'roommates', 'coliving', 'hostel', 'guesthouse', 'campsite', 'boat', 'treehouse', 'yurt', 'other']).withMessage('Invalid property type'),
  body('housingType').optional().isIn(['private', 'public']).withMessage('Invalid housing type'),
  // ---- Per-offering fields ----
  // The "offerings equals the present blocks, each with a positive price" rule
  // is enforced once in the offeringRules controller + schema validator. This
  // layer validates the SHAPE of each field when present.
  body('offerings').isArray({ min: 1 }).withMessage('offerings must be a non-empty array'),
  body('offerings.*').isIn(['long_term_rent', 'short_term_rent', 'sale', 'exchange']).withMessage('Invalid offering type'),
  // Long-term rent block
  body('longTermRent.monthlyAmount').optional().isFloat({ gt: 0 }).withMessage('monthlyAmount must be a positive number'),
  body('longTermRent.currency').optional().isIn(CURRENCY_CODES).withMessage('Invalid currency'),
  body('longTermRent.deposit').optional().isFloat({ min: 0 }).withMessage('deposit must be non-negative'),
  body('longTermRent.applicationFee').optional().isFloat({ min: 0 }).withMessage('applicationFee must be non-negative'),
  body('longTermRent.lateFee').optional().isFloat({ min: 0 }).withMessage('lateFee must be non-negative'),
  body('longTermRent.utilities').optional().isIn(['included', 'excluded', 'partial']).withMessage('Invalid utilities value'),
  // Short-term rent block
  body('shortTermRent.nightlyRate').optional().isFloat({ gt: 0 }).withMessage('nightlyRate must be a positive number'),
  body('shortTermRent.currency').optional().isIn(CURRENCY_CODES).withMessage('Invalid currency'),
  body('shortTermRent.cleaningFee').optional().isFloat({ min: 0 }).withMessage('cleaningFee must be non-negative'),
  body('shortTermRent.serviceFee').optional().isFloat({ min: 0 }).withMessage('serviceFee must be non-negative'),
  body('shortTermRent.taxesPercent').optional().isFloat({ min: 0, max: 100 }).withMessage('taxesPercent must be between 0 and 100'),
  body('shortTermRent.minNights').optional().isInt({ min: 1 }).withMessage('minNights must be a positive integer'),
  body('shortTermRent.maxNights').optional().isInt({ min: 1 }).withMessage('maxNights must be a positive integer'),
  body('shortTermRent.maxNights').optional().custom((value, { req }) => {
    const min = req.body?.shortTermRent?.minNights;
    if (value !== undefined && min !== undefined && Number(value) < Number(min)) {
      throw new Error('maxNights must be greater than or equal to minNights');
    }
    return true;
  }),
  body('shortTermRent.instantBook').optional().isBoolean().withMessage('instantBook must be a boolean'),
  body('shortTermRent.deposit').optional().isFloat({ min: 0 }).withMessage('deposit must be non-negative'),
  // Sale block
  body('sale.price').optional().isFloat({ gt: 0 }).withMessage('sale.price must be a positive number'),
  body('sale.currency').optional().isIn(CURRENCY_CODES).withMessage('Invalid currency'),
  // Exchange block
  body('exchange.mode').optional().isIn(['swap', 'host', 'both']).withMessage('Invalid exchange mode'),
  // Short-term calendar + booking policy
  body('cancellationPolicy').optional().isIn(['flexible', 'moderate', 'strict', 'super_strict']).withMessage('Invalid cancellation policy'),
  body('maxGuests').optional().isInt({ min: 1 }).withMessage('maxGuests must be a positive integer'),
  body('availabilityWindows').optional().isArray().withMessage('availabilityWindows must be an array'),
  body('availabilityWindows.*.start').optional().isISO8601().withMessage('Each availability window start must be a valid ISO-8601 date'),
  body('availabilityWindows.*.end').optional().isISO8601().withMessage('Each availability window end must be a valid ISO-8601 date'),
  body('availabilityWindows.*.status').optional().isIn(['available', 'blocked', 'booked']).withMessage('Invalid availability window status'),
  body('availabilityWindows').optional().custom((windows: unknown) => {
    if (!Array.isArray(windows)) return true;
    for (const window of windows) {
      const w = window as { start?: string; end?: string };
      if (w.start && w.end && new Date(w.end) <= new Date(w.start)) {
        throw new Error('Each availability window end must be after start');
      }
    }
    return true;
  }),
  // Optional partner referral code captured from the share link. Validated
  // loosely (a short slug); resolved to a partner in the create controller.
  body('referralCode').optional().isString().isLength({ max: 64 }).withMessage('referralCode must be a string up to 64 chars'),
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
    const startDate = req.query?.startDate;
    if (value && startDate && new Date(value) <= new Date(String(startDate))) {
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
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const file = req.file || (req.files as Express.Multer.File[])[0];
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (!allowedTypes.includes(file.mimetype)) {
    res.status(400).json({ error: 'Invalid file type' });
    return;
  }

  if (file.size > maxSize) {
    res.status(400).json({ error: 'File too large' });
    return;
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

/**
 * Reservation (vacation booking) validation rules
 */
const validateReservation = [
  body('propertyId').isString().notEmpty().withMessage('Property ID is required'),
  body('checkIn').isISO8601().withMessage('Valid check-in date is required'),
  body('checkOut').isISO8601().withMessage('Valid check-out date is required'),
  body('checkOut').custom((value, { req }) => {
    if (value && req.body?.checkIn && new Date(value) <= new Date(req.body.checkIn)) {
      throw new Error('Check-out must be after check-in');
    }
    return true;
  }),
  body('guestCount').isInt({ min: 1 }).withMessage('Guest count must be a positive integer'),
  body('specialRequests').optional().isString().isLength({ max: 2000 }).withMessage('Special requests max length is 2000'),
  handleValidationErrors
];

/**
 * Reservation status update validation rules (PATCH)
 */
const validateReservationUpdate = [
  param('id').isString().notEmpty().withMessage('Reservation ID is required'),
  body('status').isIn(['confirmed', 'declined', 'cancelled']).withMessage('Invalid status transition'),
  handleValidationErrors
];

/**
 * Tenant application validation rules (POST)
 *
 * Documents may arrive either as a JSON array (when application/json) or as
 * uploaded files under the `documents[]` multipart field. The controller
 * normalises both shapes, so this validator only enforces the structural
 * primary-key fields.
 */
const validateTenantApplication = [
  body('propertyId').isString().notEmpty().withMessage('Property ID is required'),
  body('moveInDate').isISO8601().withMessage('Valid move-in date is required'),
  body('leaseTermMonths').isInt({ min: 1 }).withMessage('Lease term (months) must be a positive integer'),
  body('monthlyIncome').isFloat({ min: 0 }).withMessage('Monthly income must be non-negative'),
  body('employmentStatus').isIn(['employed', 'self_employed', 'student', 'retired', 'unemployed', 'other']).withMessage('Invalid employment status'),
  body('notes').optional().isString().isLength({ max: 4000 }).withMessage('Notes max length is 4000'),
  handleValidationErrors
];

/**
 * Tenant application status update validation rules (PATCH)
 */
const validateTenantApplicationUpdate = [
  param('id').isString().notEmpty().withMessage('Application ID is required'),
  body('status').isIn(['reviewing', 'approved', 'rejected', 'withdrawn']).withMessage('Invalid status transition'),
  body('notes').optional().isString().isLength({ max: 4000 }).withMessage('Notes max length is 4000'),
  handleValidationErrors
];

export {
  validateReservation,
  validateReservationUpdate,
  validateTenantApplication,
  validateTenantApplicationUpdate,
};

/**
 * Exchange request validation rules (POST /api/exchanges)
 *
 * Only the structural primary fields are enforced here; the controller owns the
 * business rules (intent/mode compatibility, ownership, future-dated window,
 * conflict detection). `offered*` are optional at this layer because they only
 * apply to a swap — the controller requires them for `mode === 'swap'`.
 */
const validateExchangeRequest = [
  body('propertyId').isString().notEmpty().withMessage('Property ID is required'),
  body('mode').isIn(['swap', 'host']).withMessage('Exchange mode must be "swap" or "host"'),
  body('requestedWindow.start').isISO8601().withMessage('Valid requested window start is required'),
  body('requestedWindow.end').isISO8601().withMessage('Valid requested window end is required'),
  body('requestedWindow.end').custom((value, { req }) => {
    const start = req.body?.requestedWindow?.start;
    if (value && start && new Date(value) <= new Date(start)) {
      throw new Error('Requested window end must be after start');
    }
    return true;
  }),
  body('offeredPropertyId').optional().isString().withMessage('Offered property ID must be a string'),
  body('offeredWindow.start').optional().isISO8601().withMessage('Offered window start must be a valid date'),
  body('offeredWindow.end').optional().isISO8601().withMessage('Offered window end must be a valid date'),
  body('offeredWindow.end').optional().custom((value, { req }) => {
    const start = req.body?.offeredWindow?.start;
    if (value && start && new Date(value) <= new Date(start)) {
      throw new Error('Offered window end must be after start');
    }
    return true;
  }),
  body('message').optional().isString().isLength({ max: 2000 }).withMessage('Message max length is 2000'),
  handleValidationErrors
];

/**
 * Exchange status update validation rules (PATCH /api/exchanges/:id)
 */
const validateExchangeUpdate = [
  param('id').isString().notEmpty().withMessage('Exchange request ID is required'),
  body('status').isIn(['confirmed', 'declined', 'cancelled', 'completed']).withMessage('Invalid status transition'),
  body('message').optional().isString().isLength({ max: 2000 }).withMessage('Message max length is 2000'),
  handleValidationErrors
];

/**
 * Exchange review validation rules (POST /api/exchanges/:id/reviews)
 */
const validateExchangeReview = [
  param('id').isString().notEmpty().withMessage('Exchange request ID is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be an integer between 1 and 5'),
  body('comment').optional().isString().isLength({ max: 2000 }).withMessage('Comment max length is 2000'),
  body('categories').optional().isObject().withMessage('Categories must be an object'),
  body('categories.communication').optional().isInt({ min: 1, max: 5 }).withMessage('communication must be 1-5'),
  body('categories.cleanliness').optional().isInt({ min: 1, max: 5 }).withMessage('cleanliness must be 1-5'),
  body('categories.accuracy').optional().isInt({ min: 1, max: 5 }).withMessage('accuracy must be 1-5'),
  body('categories.hospitality').optional().isInt({ min: 1, max: 5 }).withMessage('hospitality must be 1-5'),
  handleValidationErrors
];

export {
  validateExchangeRequest,
  validateExchangeUpdate,
  validateExchangeReview,
};

/** Review currency codes accepted by the Review schema. */
const REVIEW_CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'CAD'];

/**
 * Address review create validation rules (POST /api/reviews)
 *
 * The body carries a nested `address` block plus flat review fields. The Review
 * schema + controller own the required-field, enum and hierarchy rules; this
 * layer closes injection / bad-input gaps by enforcing the SHAPE of the
 * high-risk fields (rating range, bounded free text, numeric price, valid
 * currency, ISO dates, image URLs). All review fields are optional here so the
 * partial payloads the frontend sends are not rejected.
 */
const validateReviewCreate = [
  body('address').isObject().withMessage('address must be an object'),
  body('address.street').isString().trim().notEmpty().withMessage('address.street is required'),
  body('address.city').isString().trim().notEmpty().withMessage('address.city is required'),
  body('address.postal_code').isString().trim().notEmpty().withMessage('address.postal_code is required'),
  body('address.country').isString().trim().notEmpty().withMessage('address.country is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be an integer between 1 and 5'),
  body('price').optional().isFloat({ min: 0 }).withMessage('price must be a non-negative number'),
  body('currency').optional().isIn(REVIEW_CURRENCY_CODES).withMessage('Invalid currency'),
  body('opinion').isString().isLength({ min: 10, max: 2000 }).withMessage('opinion must be between 10 and 2000 characters'),
  body('positiveComment').optional().isString().isLength({ max: 1000 }).withMessage('positiveComment max length is 1000'),
  body('negativeComment').optional().isString().isLength({ max: 1000 }).withMessage('negativeComment max length is 1000'),
  body('greenHouse').optional().isString().isLength({ max: 200 }).withMessage('greenHouse max length is 200'),
  body('recommendation').optional().isBoolean().withMessage('recommendation must be a boolean'),
  body('depositReturned').optional().isBoolean().withMessage('depositReturned must be a boolean'),
  body('touristApartments').optional().isBoolean().withMessage('touristApartments must be a boolean'),
  body('livedForMonths').optional().isInt({ min: 0 }).withMessage('livedForMonths must be a non-negative integer'),
  body('livedFrom').optional().isISO8601().withMessage('livedFrom must be a valid date'),
  body('livedTo').optional().isISO8601().withMessage('livedTo must be a valid date'),
  body('images').optional().isArray().withMessage('images must be an array'),
  body('images.*').optional().isString().isLength({ max: 2048 }).withMessage('Each image must be a string URL'),
  handleValidationErrors
];

/**
 * Address review update validation rules (PUT /api/reviews/:reviewId)
 *
 * Updates are partial (the controller merges the body into the existing review)
 * so every field is optional; only their type/range is enforced.
 */
const validateReviewUpdate = [
  param('reviewId').isMongoId().withMessage('Invalid review ID'),
  body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be an integer between 1 and 5'),
  body('price').optional().isFloat({ min: 0 }).withMessage('price must be a non-negative number'),
  body('currency').optional().isIn(REVIEW_CURRENCY_CODES).withMessage('Invalid currency'),
  body('opinion').optional().isString().isLength({ min: 10, max: 2000 }).withMessage('opinion must be between 10 and 2000 characters'),
  body('positiveComment').optional().isString().isLength({ max: 1000 }).withMessage('positiveComment max length is 1000'),
  body('negativeComment').optional().isString().isLength({ max: 1000 }).withMessage('negativeComment max length is 1000'),
  body('greenHouse').optional().isString().isLength({ max: 200 }).withMessage('greenHouse max length is 200'),
  body('recommendation').optional().isBoolean().withMessage('recommendation must be a boolean'),
  body('depositReturned').optional().isBoolean().withMessage('depositReturned must be a boolean'),
  body('touristApartments').optional().isBoolean().withMessage('touristApartments must be a boolean'),
  body('livedForMonths').optional().isInt({ min: 0 }).withMessage('livedForMonths must be a non-negative integer'),
  body('livedFrom').optional().isISO8601().withMessage('livedFrom must be a valid date'),
  body('livedTo').optional().isISO8601().withMessage('livedTo must be a valid date'),
  body('images').optional().isArray().withMessage('images must be an array'),
  body('images.*').optional().isString().isLength({ max: 2048 }).withMessage('Each image must be a string URL'),
  handleValidationErrors
];

/** Review ID parameter validation (GET/DELETE /api/reviews/:reviewId). */
const validateReviewId = [
  param('reviewId').isMongoId().withMessage('Invalid review ID'),
  handleValidationErrors
];

/** Profile ID parameter + pagination for owner-scoped review reads. */
const validateProfileReviewsQuery = [
  param('profileId').isMongoId().withMessage('Invalid profile ID'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
  handleValidationErrors
];

export {
  validateReviewCreate,
  validateReviewUpdate,
  validateReviewId,
  validateProfileReviewsQuery,
};

/** Lifestyle / gender enum values mirrored from the RoommatePreferences type. */
const ROOMMATE_GENDERS = ['male', 'female', 'any'];
const ROOMMATE_TRISTATE = ['yes', 'no', 'prefer_not'];
const ROOMMATE_CLEANLINESS = ['very_clean', 'clean', 'average', 'relaxed'];
const ROOMMATE_SCHEDULE = ['early_bird', 'night_owl', 'flexible'];

/**
 * Send roommate request validation rules (POST /api/roommates/:profileId/request)
 *
 * The route param is the target profile id (validated as an ObjectId to block
 * NoSQL operator injection into `Profile.findById`); `message` is optional free
 * text and length-bounded.
 */
const validateRoommateRequest = [
  param('profileId').isMongoId().withMessage('Invalid profile ID'),
  body('message').optional().isString().isLength({ max: 1000 }).withMessage('Message max length is 1000'),
  handleValidationErrors
];

/**
 * Update roommate preferences validation rules (PUT /api/roommates/preferences)
 *
 * The frontend sends the whole RoommatePreferences object. The controller
 * spreads the nested fields into the profile document, so this validator
 * enforces type/shape of each field WITHOUT requiring any of them (the whole
 * body is optional/permissive to preserve existing behavior).
 */
const validateRoommatePreferences = [
  body('enabled').optional().isBoolean().withMessage('enabled must be a boolean'),
  body('gender').optional().isIn(ROOMMATE_GENDERS).withMessage('Invalid gender'),
  body('location').optional().isString().isLength({ max: 200 }).withMessage('location max length is 200'),
  body('moveInDate').optional().isString().isLength({ max: 100 }).withMessage('moveInDate max length is 100'),
  body('leaseDuration').optional().isString().isLength({ max: 100 }).withMessage('leaseDuration max length is 100'),
  body('ageRange.min').optional().isInt({ min: 0, max: 120 }).withMessage('ageRange.min must be between 0 and 120'),
  body('ageRange.max').optional().isInt({ min: 0, max: 120 }).withMessage('ageRange.max must be between 0 and 120'),
  body('budget.min').optional().isFloat({ min: 0 }).withMessage('budget.min must be non-negative'),
  body('budget.max').optional().isFloat({ min: 0 }).withMessage('budget.max must be non-negative'),
  body('lifestyle.smoking').optional().isIn(ROOMMATE_TRISTATE).withMessage('Invalid lifestyle.smoking'),
  body('lifestyle.pets').optional().isIn(ROOMMATE_TRISTATE).withMessage('Invalid lifestyle.pets'),
  body('lifestyle.partying').optional().isIn(ROOMMATE_TRISTATE).withMessage('Invalid lifestyle.partying'),
  body('lifestyle.cleanliness').optional().isIn(ROOMMATE_CLEANLINESS).withMessage('Invalid lifestyle.cleanliness'),
  body('lifestyle.schedule').optional().isIn(ROOMMATE_SCHEDULE).withMessage('Invalid lifestyle.schedule'),
  body('interests').optional().isArray().withMessage('interests must be an array'),
  body('interests.*').optional().isString().isLength({ max: 100 }).withMessage('Each interest must be a string'),
  handleValidationErrors
];

/**
 * Toggle roommate matching validation rules (PATCH /api/roommates/toggle).
 */
const validateRoommateToggle = [
  body('enabled').isBoolean().withMessage('enabled must be a boolean'),
  handleValidationErrors
];

/**
 * Roommate request id parameter validation
 * (POST /api/roommates/requests/:requestId/accept|decline).
 */
const validateRoommateRequestId = [
  param('requestId').isMongoId().withMessage('Invalid roommate request ID'),
  handleValidationErrors
];

/** Roommate listing pagination + filter validation (GET /api/roommates). */
const validateRoommateListQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
  query('minMatchPercentage').optional().isInt({ min: 0, max: 100 }).withMessage('minMatchPercentage must be between 0 and 100'),
  query('maxBudget').optional().isFloat({ min: 0 }).withMessage('maxBudget must be non-negative'),
  query('gender').optional().isString().isLength({ max: 50 }).withMessage('gender must be a string'),
  query('location').optional().isString().isLength({ max: 200 }).withMessage('location max length is 200'),
  handleValidationErrors
];

export {
  validateRoommateRequest,
  validateRoommatePreferences,
  validateRoommateToggle,
  validateRoommateRequestId,
  validateRoommateListQuery,
};

/**
 * Lease create validation rules (POST /api/leases)
 *
 * Matches the actual shape consumed by leaseController.createLease
 * (propertyId, tenantOxyUserId, leaseTerms.startDate/endDate,
 * rentDetails.monthlyRent). ObjectId fields are validated to block NoSQL
 * operator injection into Property.findById / Lease.create. The controller
 * still owns the required-field 400s and ownership checks; this layer is kept
 * permissive (fields optional) so it never rejects a payload the controller
 * would otherwise accept, while enforcing type/format when present.
 */
const validateLeaseCreate = [
  body('propertyId').isMongoId().withMessage('Valid propertyId is required'),
  body('tenantOxyUserId').optional().isMongoId().withMessage('tenantOxyUserId must be a valid id'),
  body('tenantId').optional().isMongoId().withMessage('tenantId must be a valid id'),
  body('leaseTerms.startDate').optional().isISO8601().withMessage('leaseTerms.startDate must be a valid date'),
  body('leaseTerms.endDate').optional().isISO8601().withMessage('leaseTerms.endDate must be a valid date'),
  body('leaseTerms.endDate').optional().custom((value, { req }) => {
    const start = req.body?.leaseTerms?.startDate;
    if (value && start && new Date(value) <= new Date(start)) {
      throw new Error('leaseTerms.endDate must be after leaseTerms.startDate');
    }
    return true;
  }),
  body('rentDetails.monthlyRent').optional().isFloat({ min: 0 }).withMessage('rentDetails.monthlyRent must be non-negative'),
  body('rentDetails.deposit').optional().isFloat({ min: 0 }).withMessage('rentDetails.deposit must be non-negative'),
  handleValidationErrors
];

/**
 * Lease update validation rules (PUT /api/leases/:id)
 *
 * Partial update; the controller filters immutable keys and enforces the
 * landlord/editable-status rules. Only the id param and the type/format of any
 * supplied mutable fields are validated here.
 */
const validateLeaseUpdate = [
  param('id').isMongoId().withMessage('Invalid lease ID'),
  body('leaseTerms.startDate').optional().isISO8601().withMessage('leaseTerms.startDate must be a valid date'),
  body('leaseTerms.endDate').optional().isISO8601().withMessage('leaseTerms.endDate must be a valid date'),
  body('leaseTerms.endDate').optional().custom((value, { req }) => {
    const start = req.body?.leaseTerms?.startDate;
    if (value && start && new Date(value) <= new Date(start)) {
      throw new Error('leaseTerms.endDate must be after leaseTerms.startDate');
    }
    return true;
  }),
  body('rentDetails.monthlyRent').optional().isFloat({ min: 0 }).withMessage('rentDetails.monthlyRent must be non-negative'),
  body('rentDetails.deposit').optional().isFloat({ min: 0 }).withMessage('rentDetails.deposit must be non-negative'),
  handleValidationErrors
];

/** Lease id parameter validation (GET/DELETE /api/leases/:id). */
const validateLeaseId = [
  param('id').isMongoId().withMessage('Invalid lease ID'),
  handleValidationErrors
];

/** Lease listing pagination + filter validation (GET /api/leases). */
const validateLeaseListQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
  query('status').optional().isString().isLength({ max: 50 }).withMessage('status must be a string'),
  query('propertyId').optional().isMongoId().withMessage('propertyId must be a valid id'),
  handleValidationErrors
];

export {
  validateLeaseCreate,
  validateLeaseUpdate,
  validateLeaseId,
  validateLeaseListQuery,
};

/**
 * Viewing request update validation rules (PUT /api/viewings/:viewingId)
 *
 * The controller rebuilds `scheduledAt` from `date` (YYYY-MM-DD) + `time`
 * (HH:mm) and enforces the future-date / conflict rules. This layer validates
 * the id param and the date/time/message shape.
 */
const validateViewingUpdate = [
  param('viewingId').isMongoId().withMessage('Invalid viewing request ID'),
  body('date').isISO8601().withMessage('Valid date is required'),
  body('time').matches(/^\d{2}:\d{2}$/).withMessage('Time must be in HH:MM format'),
  body('message').optional().isString().isLength({ max: 1000 }).withMessage('Message max length is 1000'),
  handleValidationErrors
];

/** Viewing request id parameter validation (POST .../approve|decline|cancel). */
const validateViewingId = [
  param('viewingId').isMongoId().withMessage('Invalid viewing request ID'),
  handleValidationErrors
];

/** Current-user viewing list pagination + status filter (GET /api/viewings/me). */
const validateViewingListQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
  query('status').optional().isIn(['pending', 'approved', 'declined', 'cancelled']).withMessage('Invalid status filter'),
  handleValidationErrors
];

export {
  validateViewingUpdate,
  validateViewingId,
  validateViewingListQuery,
};
