/**
 * Error Handling Middleware
 * Central error handling for the application
 */

import { Request, Response, NextFunction } from 'express';
import config from '../config';
import { logger } from './logging';

/**
 * Custom error class for application errors
 */
class AppError extends Error {
  statusCode: number;
  code?: string | null;
  isOperational: boolean;

  constructor(message: string, statusCode = 500, code: string | null = null) {
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
const notFound = (req: Request, res: Response, next: NextFunction): void => {
  const error = new AppError(`Resource not found - ${req.originalUrl}`, 404, 'NOT_FOUND');
  next(error);
};

const GENERIC_SERVER_ERROR_MESSAGE = 'Internal server error';

/**
 * drizzle-orm's `DrizzleQueryError` message is `Failed query: <sql>\nparams: <values>`.
 * The SQL is placeholders only; everything from `params:` on is the bound VALUES
 * (ids, dates, whatever the caller sent), which belong in neither a response nor
 * a log line. A message that wraps it (`Failed to X: Failed query: ...`) carries
 * the same tail, so it is stripped wherever `Failed query:` appears.
 */
const stripQueryParams = (text: string): string => {
  if (!text.includes('Failed query:')) return text;
  const start = text.indexOf('\nparams:');
  if (start === -1) return text;
  // Up to the first stack frame when the text is a stack, else to the end — a
  // string parameter can itself contain newlines. (String search, not a regex:
  // the text is attacker-influenced and a backtracking pattern is a ReDoS.)
  const frame = text.indexOf('\n    at ', start);
  return frame === -1 ? text.slice(0, start) : text.slice(0, start) + text.slice(frame);
};

/**
 * Postgres data-exception messages end in the offending VALUE
 * (`invalid input syntax for type uuid: "abc"`). The code and the type are what
 * a diagnosis needs, so the value is dropped. Constraint messages quote a
 * constraint NAME with no preceding colon and are left intact.
 *
 * Applied to the top-level message as well as the cause's: a postgres error
 * raised without a drizzle wrapper around it — every `db.execute`, and anything
 * a repository rethrows — arrives with that value in `err.message` and nowhere
 * else.
 */
const redactTrailingValue = (text: string): string => {
  const start = text.indexOf(': "');
  return start !== -1 && text.endsWith('"') ? `${text.slice(0, start)}: [redacted]` : text;
};

/**
 * The parts of an error that are safe to log: no request body, no bound
 * parameter values, no Postgres `detail` (which repeats key values).
 * Structured drizzle/postgres fields are preferred over parsing the message.
 */
const describeErrorForLog = (err: any): Record<string, unknown> => {
  const isDrizzleQueryError =
    err != null && typeof err === 'object' && typeof err.query === 'string' && 'params' in err;
  const rawMessage = typeof err?.message === 'string' ? err.message : String(err);
  const safeMessage = redactTrailingValue(stripQueryParams(rawMessage));
  const description: Record<string, unknown> = {
    name: isDrizzleQueryError ? 'DrizzleQueryError' : err?.name,
    message: safeMessage,
  };
  if (isDrizzleQueryError) description.query = err.query;
  if (err?.code !== undefined) description.code = err.code;

  const cause = err?.cause;
  if (cause && typeof cause === 'object') {
    description.cause = {
      name: cause.name,
      code: cause.code,
      message: typeof cause.message === 'string'
        ? redactTrailingValue(stripQueryParams(cause.message))
        : undefined,
      // postgres-js spells these `*_name`; node-postgres does not.
      constraint: cause.constraint_name ?? cause.constraint,
      table: cause.table_name ?? cause.table,
      column: cause.column_name ?? cause.column,
    };
  }
  // A stack STARTS with the message, so redacting one and not the other leaves
  // the value in the log anyway. Replaced as a function so a `$` in the message
  // is not read as a replacement pattern.
  if (typeof err?.stack === 'string') {
    description.stack = stripQueryParams(err.stack).replace(rawMessage, () => safeMessage);
  }
  return description;
};

/** Where the request was going: the matched route pattern, never the query string. */
const describeRequestForLog = (req: Request): Record<string, unknown> => {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : req.path;
  return {
    method: req.method,
    route: `${req.baseUrl || ''}${routePath || ''}` || (req.originalUrl || '').split('?')[0],
    requestId: req.id || req.get?.('x-request-id') || req.get?.('x-amzn-trace-id') || null,
  };
};

/**
 * Log an error nobody anticipated, in EVERY environment, without PII. A route
 * handler that answers a 500 itself calls this instead of echoing the error to
 * the client.
 */
const logUnexpectedError = (err: unknown, req: Request, context = 'Unhandled request error'): void => {
  logger.error(context, {
    ...describeRequestForLog(req),
    error: describeErrorForLog(err),
  });
};

/**
 * Global error handler
 */
const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  // Express only treats a middleware as an error handler when it takes four
  // parameters, so `next` has to be here whether or not it is called — and it
  // was never called, which left a real hole: once a handler has begun writing
  // the response, the `res.status().json()` below throws ERR_HTTP_HEADERS_SENT
  // on top of the original error. Delegating to Express's default handler is
  // what closes the socket correctly in that case.
  if (res.headersSent) {
    next(err);
    return;
  }

  const isDevelopment = config.environment === 'development';

  let error = { ...err };
  error.message = err?.message;

  // Whether OUR code wrote the text the client will see. An `AppError` is thrown
  // deliberately with a message meant for the caller (`'Property not found'`,
  // `'geocoding failed'`); the mapped branches below replace a library error
  // with a fixed message. A raw error — a drizzle/postgres failure, a TypeError,
  // a library error carrying its own `statusCode` — has not been vetted.
  const clientSafeMessage = err instanceof AppError;

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
  if (err.name === 'ValidationError' && err.errors && typeof err.errors === 'object') {
    const message = Object.values(err.errors).map((val: any) => val.message).join(', ');
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

  // FairCoin / Horizon API errors. These used to forward `err.message`, which is
  // the upstream integration's own text (possibly naming internal URLs or
  // accounts), not ours. The client now gets a fixed message; the original is
  // logged below like any other upstream failure.
  if (err.code === 'FAIRCOIN_ERROR') {
    error = new AppError('FairCoin transaction failed', 502, 'FAIRCOIN_ERROR');
  }

  if (err.code === 'HORIZON_ERROR') {
    error = new AppError('Horizon integration error', 502, 'HORIZON_ERROR');
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

  // A mapped branch above replaced the raw error with a fixed-message AppError.
  const messageIsClientSafe = clientSafeMessage || error instanceof AppError;

  // Every 5xx is logged, in every environment: a 500 nobody can see is a 500
  // nobody fixes. A 4xx is the caller's own mistake and `requestLogger` already
  // records its status. The log carries no body and no bound parameter values.
  if (statusCode >= 500) {
    logUnexpectedError(err, req);
  }

  // A 5xx whose text our code did not write is internals — a drizzle error is
  // the SQL plus every bound parameter — so outside development the client gets
  // a generic message (and no `details`). A 4xx message describes the caller's
  // own request and is kept.
  const exposeMessage = statusCode < 500 || messageIsClientSafe || isDevelopment;

  // Error response object
  const errorResponse: any = {
    success: false,
    error: {
      message: (exposeMessage && error.message) || GENERIC_SERVER_ERROR_MESSAGE,
      code: code,
      statusCode: statusCode
    }
  };

  // Add validation details if they exist
  if (error.details && exposeMessage) {
    errorResponse.error.details = error.details;
  }

  // Add stack trace in development
  if (isDevelopment) {
    errorResponse.error.stack = err.stack;
    errorResponse.error.fullError = err;
  }

  // Add request information for debugging
  if (isDevelopment) {
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
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/**
 * Validation error formatter
 */
const formatValidationError = (errors: Array<{ param: string; msg: string; value: any; location: string }>) => {
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
const successResponse = (data: unknown, message = 'Success', meta: Record<string, unknown> = {}) => {
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
const paginationResponse = (
  data: unknown,
  page: number,
  limit: number,
  total: number,
  message = 'Success',
  meta: Record<string, unknown> = {}
) => {
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  return {
    success: true,
    message,
    data,
    pagination: {
      page: page,
      limit: limit,
      total: total,
      totalPages: totalPages,
      hasNext: hasNext,
      hasPrev: hasPrev,
      nextPage: hasNext ? page + 1 : null,
      prevPage: hasPrev ? page - 1 : null
    },
    meta: {
      timestamp: new Date().toISOString(),
      ...meta
    }
  };
};

export {
  AppError,
  notFound,
  errorHandler,
  logUnexpectedError,
  describeErrorForLog,
  asyncHandler,
  formatValidationError,
  successResponse,
  paginationResponse
};
