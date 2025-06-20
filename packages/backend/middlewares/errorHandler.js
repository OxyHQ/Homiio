/**
 * Error Handling Middleware
 * Central error handling for the application
 */

const config = require('../config');

/**
 * Custom error class for application errors
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Not found middleware (404 handler)
 */
const notFound = (req, res, next) => {
  const error = new AppError(`Resource not found - ${req.originalUrl}`, 404, 'NOT_FOUND');
  next(error);
};

/**
 * Global error handler
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  console.error(err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Invalid resource ID';
    error = new AppError(message, 400, 'INVALID_ID');
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = new AppError(message, 400, 'DUPLICATE_FIELD');
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new AppError(message, 400, 'VALIDATION_ERROR');
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = new AppError(message, 401, 'INVALID_TOKEN');
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = new AppError(message, 401, 'TOKEN_EXPIRED');
  }

  // FairCoin API errors
  if (err.code === 'FAIRCOIN_ERROR') {
    const message = err.message || 'FairCoin transaction failed';
    error = new AppError(message, 502, 'FAIRCOIN_ERROR');
  }

  // Raspberry Pi device errors
  if (err.code === 'DEVICE_ERROR') {
    const message = err.message || 'Device communication error';
    error = new AppError(message, 503, 'DEVICE_ERROR');
  }

  // Horizon API errors
  if (err.code === 'HORIZON_ERROR') {
    const message = err.message || 'Horizon integration error';
    error = new AppError(message, 502, 'HORIZON_ERROR');
  }

  // Rate limit errors
  if (err.type === 'RATE_LIMIT_ERROR') {
    const message = 'Too many requests, please try again later';
    error = new AppError(message, 429, 'RATE_LIMIT_EXCEEDED');
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'File too large';
    error = new AppError(message, 413, 'FILE_TOO_LARGE');
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    const message = 'Too many files';
    error = new AppError(message, 400, 'TOO_MANY_FILES');
  }

  // Database connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError') {
    const message = 'Database connection error';
    error = new AppError(message, 503, 'DATABASE_ERROR');
  }

  // Default to 500 server error
  const statusCode = error.statusCode || 500;
  const code = error.code || 'INTERNAL_SERVER_ERROR';

  // Error response object
  const errorResponse = {
    success: false,
    error: {
      message: error.message || 'Internal server error',
      code: code,
      statusCode: statusCode
    }
  };

  // Add validation details if they exist
  if (error.details) {
    errorResponse.error.details = error.details;
  }

  // Add stack trace in development
  if (config.environment === 'development') {
    errorResponse.error.stack = err.stack;
    errorResponse.error.fullError = err;
  }

  // Add request information for debugging
  if (config.environment === 'development') {
    errorResponse.request = {
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      body: req.body,
      params: req.params,
      query: req.query,
      user: req.user ? { id: req.user.id, role: req.user.role } : null
    };
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * Async error wrapper
 * Wraps async functions to catch errors and pass to next()
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Validation error formatter
 */
const formatValidationError = (errors) => {
  return errors.map(err => ({
    field: err.param,
    message: err.msg,
    value: err.value,
    location: err.location
  }));
};

/**
 * Success response formatter
 */
const successResponse = (data, message = 'Success', meta = {}) => {
  return {
    success: true,
    message,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta
    }
  };
};

/**
 * Pagination response formatter
 */
const paginationResponse = (data, page, limit, total, message = 'Success') => {
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  return {
    success: true,
    message,
    data,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: total,
      totalPages: totalPages,
      hasNext: hasNext,
      hasPrev: hasPrev,
      nextPage: hasNext ? page + 1 : null,
      prevPage: hasPrev ? page - 1 : null
    },
    meta: {
      timestamp: new Date().toISOString()
    }
  };
};

module.exports = {
  AppError,
  notFound,
  errorHandler,
  asyncHandler,
  formatValidationError,
  successResponse,
  paginationResponse
};
