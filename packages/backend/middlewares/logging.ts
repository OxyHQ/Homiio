/**
 * Logging Middleware
 * Request logging and application logging utilities
 */

import fs from 'fs';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import config from '../config';

// Log environment information for debugging
console.log('Logging environment:', {
  environment: config.environment,
  isVercel: !!process.env.VERCEL,
  isLambda: !!process.env.AWS_LAMBDA_FUNCTION_NAME,
  isFunction: !!process.env.FUNCTION_TARGET,
  logFile: config.logging.file
});

/**
 * Ensure logs directory exists
 */
const ensureLogDirectory = () => {
  // Skip directory creation in serverless environments
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.FUNCTION_TARGET) {
    return;
  }
  
  try {
    const logDir = path.dirname(config.logging.file);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (error) {
    console.error('Failed to create log directory:', error);
    // Don't throw - logging should not break the application
  }
};

/**
 * Logger utility
 */
const logger = {
  info: (message: string, meta: Record<string, unknown> = {}): void => {
    log('INFO', message, meta);
  },
  
  warn: (message: string, meta: Record<string, unknown> = {}): void => {
    log('WARN', message, meta);
  },
  
  error: (message: string, meta: Record<string, unknown> = {}): void => {
    log('ERROR', message, meta);
  },
  
  debug: (message: string, meta: Record<string, unknown> = {}): void => {
    if (config.environment === 'development') {
      log('DEBUG', message, meta);
    }
  }
};

/**
 * Core logging function
 */
const log = (level: string, message: string, meta: Record<string, unknown> = {}): void => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...meta
  };

  // Console output
  const consoleMessage = `[${timestamp}] ${level}: ${message}`;
  
  switch (level) {
    case 'ERROR':
      console.error(consoleMessage, meta);
      break;
    case 'WARN':
      console.warn(consoleMessage, meta);
      break;
    case 'DEBUG':
      console.debug(consoleMessage, meta);
      break;
    default:
      console.log(consoleMessage, meta);
  }

  // File output (in production, but not in serverless environments)
  const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.FUNCTION_TARGET;
  if (config.environment === 'production' && !isServerless) {
    try {
      ensureLogDirectory();
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(config.logging.file, logLine);
    } catch (error) {
      // Log to console as fallback, but don't break the application
      console.error('Failed to write to log file:', error);
      console.log('Log entry that failed to write:', logEntry);
    }
  }
};

/**
 * Request logging middleware
 */
const requestLogger = (req: any, res: Response, next: NextFunction): void => {
  const start = Date.now();
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress;

  // Log request start
  logger.info('Request started', {
    method: req.method,
    url: req.originalUrl,
    ip: ip,
    userAgent: userAgent,
    userId: req.userId || (req.user ? req.user.id : null),
    requestId: req.id || null
  });

  // Capture response
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - start;
    
    // Call original send first
    const result = originalSend.call(this, data);
    
    // Then log response (after Content-Length is set)
    const contentLength = res.get('Content-Length') || (data ? Buffer.byteLength(data, 'utf8') : 0);
    
    logger.info('Request completed', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: duration,
      contentLength: contentLength,
      ip: ip,
      userId: req.userId || (req.user ? req.user.id : null),
      requestId: req.id || null
    });

    return result;
  };

  next();
};

/**
 * Error logging middleware
 */
const errorLogger = (err: any, req: any, res: Response, next: NextFunction): void => {
  logger.error('Request error', {
    method: req.method,
    url: req.originalUrl,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      statusCode: err.statusCode
    },
    userId: req.userId || (req.user ? req.user.id : null),
    requestId: req.id || null,
    body: req.body,
    params: req.params,
    query: req.query
  });

  next(err);
};

/**
 * Security event logger
 */
const securityLogger = {
  loginAttempt: (email, success, ip, userAgent) => {
    logger.info('Login attempt', {
      event: 'AUTH_LOGIN_ATTEMPT',
      email: email,
      success: success,
      ip: ip,
      userAgent: userAgent
    });
  },

  loginSuccess: (userId, email, ip, userAgent) => {
    logger.info('Login successful', {
      event: 'AUTH_LOGIN_SUCCESS',
      userId: userId,
      email: email,
      ip: ip,
      userAgent: userAgent
    });
  },

  loginFailure: (email, reason, ip, userAgent) => {
    logger.warn('Login failed', {
      event: 'AUTH_LOGIN_FAILURE',
      email: email,
      reason: reason,
      ip: ip,
      userAgent: userAgent
    });
  },

  tokenRefresh: (userId, ip) => {
    logger.info('Token refreshed', {
      event: 'AUTH_TOKEN_REFRESH',
      userId: userId,
      ip: ip
    });
  },

  unauthorizedAccess: (url, method, ip, userAgent) => {
    logger.warn('Unauthorized access attempt', {
      event: 'SECURITY_UNAUTHORIZED_ACCESS',
      url: url,
      method: method,
      ip: ip,
      userAgent: userAgent
    });
  },

  suspiciousActivity: (userId, activity, details) => {
    logger.warn('Suspicious activity detected', {
      event: 'SECURITY_SUSPICIOUS_ACTIVITY',
      userId: userId,
      activity: activity,
      details: details
    });
  }
};

/**
 * Business event logger
 */
const businessLogger = {
  propertyCreated: (propertyId, ownerId) => {
    logger.info('Property created', {
      event: 'BUSINESS_PROPERTY_CREATED',
      propertyId: propertyId,
      ownerId: ownerId
    });
  },

  leaseCreated: (leaseId, propertyId, landlordId, tenantId) => {
    logger.info('Lease created', {
      event: 'BUSINESS_LEASE_CREATED',
      leaseId: leaseId,
      propertyId: propertyId,
      landlordId: landlordId,
      tenantId: tenantId
    });
  },

  paymentProcessed: (paymentId, amount, method, status) => {
    logger.info('Payment processed', {
      event: 'BUSINESS_PAYMENT_PROCESSED',
      paymentId: paymentId,
      amount: amount,
      method: method,
      status: status
    });
  },

  energyDataReceived: (deviceId, propertyId, dataCount) => {
    logger.debug('Energy data received', {
      event: 'DEVICE_ENERGY_DATA_RECEIVED',
      deviceId: deviceId,
      propertyId: propertyId,
      dataCount: dataCount
    });
  },

  deviceStatusChanged: (deviceId, oldStatus, newStatus) => {
    logger.info('Device status changed', {
      event: 'DEVICE_STATUS_CHANGED',
      deviceId: deviceId,
      oldStatus: oldStatus,
      newStatus: newStatus
    });
  }
};

export {
  logger,
  requestLogger,
  errorLogger,
  securityLogger,
  businessLogger
};
