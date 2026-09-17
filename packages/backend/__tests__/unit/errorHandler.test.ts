/**
 * The global error handler must never hand a client the internals of a failure
 * our code did not anticipate, and must log that failure in every environment
 * without the request's data.
 *
 * The regression this pins: `GET /api/properties/:id/stats` answered a 500 whose
 * body was drizzle's `Failed query: select ... params: <propertyId>,active,<dates>`
 * — the SQL and every bound value — while production logged nothing the team
 * could find.
 */

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../../middlewares/logging', () => ({ logger: mockLogger }));

import type { NextFunction, Request, Response } from 'express';
import config from '../../config';
import { AppError, errorHandler } from '../../middlewares/errorHandler';

// The real config object (the suite's setup reads its Postgres URL); only the
// environment is switched per test and restored afterwards.
const originalEnvironment = config.environment;
const mockConfig = config;
afterAll(() => {
  config.environment = originalEnvironment;
});

const SQL = 'select coalesce(sum("rent_details_monthly_rent"), 0) from "properties" where ("id" = $1 and "status" = $2)';
const PARAMS = ['0b5a6f1e-secret-property-id', 'active', '2026-09-01T00:00:00.000Z'];

/** The shape drizzle-orm 0.45's `DrizzleQueryError` has at runtime. */
function drizzleQueryError(): Error {
  const cause = Object.assign(new Error('invalid input syntax for type timestamp: "not-a-date"'), {
    name: 'PostgresError',
    code: '22007',
    detail: 'Key (id)=(0b5a6f1e-secret-property-id) leaked',
  });
  const err = new Error(`Failed query: ${SQL}\nparams: ${PARAMS.join(',')}`) as Error & {
    query: string;
    params: unknown[];
    cause: unknown;
  };
  err.query = SQL;
  err.params = PARAMS;
  err.cause = cause;
  return err;
}

function mockRequest(): Request {
  return {
    method: 'GET',
    baseUrl: '/api/properties',
    path: '/0b5a6f1e-secret-property-id/stats',
    originalUrl: '/api/properties/0b5a6f1e-secret-property-id/stats?token=abc',
    route: { path: '/:propertyId/stats' },
    body: { email: 'someone@example.com' },
    headers: {},
    params: { propertyId: '0b5a6f1e-secret-property-id' },
    query: { token: 'abc' },
    get: () => undefined,
  } as unknown as Request;
}

function mockResponse() {
  const res = { headersSent: false, statusCode: 0, body: undefined as any } as any;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res as Response & { statusCode: number; body: any };
}

function run(err: unknown) {
  const res = mockResponse();
  const next = jest.fn() as NextFunction;
  errorHandler(err, mockRequest(), res, next);
  return res;
}

describe('errorHandler', () => {
  beforeEach(() => {
    mockConfig.environment = 'production';
    jest.clearAllMocks();
  });

  describe('an unexpected error in production', () => {
    it('answers a generic message, never the SQL or its parameters', () => {
      const res = run(drizzleQueryError());

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: { message: 'Internal server error', code: 'INTERNAL_SERVER_ERROR', statusCode: 500 },
      });
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('Failed query');
      expect(serialized).not.toContain('secret-property-id');
    });

    it('logs the failure with the query and Postgres cause, but no bound values or request data', () => {
      run(drizzleQueryError());

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const [message, meta] = mockLogger.error.mock.calls[0];
      expect(message).toBe('Unhandled request error');
      expect(meta).toMatchObject({
        method: 'GET',
        route: '/api/properties/:propertyId/stats',
        error: {
          name: 'DrizzleQueryError',
          message: `Failed query: ${SQL}`,
          query: SQL,
          cause: {
            name: 'PostgresError',
            code: '22007',
            message: 'invalid input syntax for type timestamp: [redacted]',
          },
        },
      });
      expect(typeof meta.error.stack).toBe('string');

      const serialized = JSON.stringify(meta);
      expect(serialized).not.toContain('params:');
      for (const value of PARAMS) expect(serialized).not.toContain(value);
      expect(serialized).not.toContain('not-a-date');
      expect(serialized).not.toContain('someone@example.com');
      expect(serialized).not.toContain('token');
    });

    it('does not trust a statusCode on an error our code did not build', () => {
      const err = Object.assign(new Error('connect ECONNREFUSED 10.0.3.7:5432'), { statusCode: 503 });
      const res = run(err);

      expect(res.statusCode).toBe(503);
      expect(res.body.error.message).toBe('Internal server error');
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });

    it('replaces an upstream FairCoin message with a fixed one', () => {
      const err = Object.assign(new Error('POST https://internal-node:8080/tx rejected for acct 42'), {
        code: 'FAIRCOIN_ERROR',
      });
      const res = run(err);

      expect(res.statusCode).toBe(502);
      expect(res.body.error).toEqual({
        message: 'FairCoin transaction failed',
        code: 'FAIRCOIN_ERROR',
        statusCode: 502,
      });
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('an AppError', () => {
    it('keeps a 4xx message and does not log it as a server failure', () => {
      const res = run(new AppError('Property not found', 404, 'NOT_FOUND'));

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: { message: 'Property not found', code: 'NOT_FOUND', statusCode: 404 },
      });
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('keeps the message of a 5xx our code wrote, and still logs it', () => {
      const res = run(new AppError('geocoding failed', 500, 'GEO_FAILED'));

      expect(res.body.error.message).toBe('geocoding failed');
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('in development', () => {
    it('keeps the detail in the response', () => {
      mockConfig.environment = 'development';
      const err = drizzleQueryError();
      const res = run(err);

      expect(res.statusCode).toBe(500);
      expect(res.body.error.message).toBe(err.message);
      expect(res.body.error.stack).toBe(err.stack);
      expect(res.body.error.fullError).toBe(err);
      expect(res.body.request).toMatchObject({ method: 'GET' });
    });
  });

  it('never includes stack or fullError outside development', () => {
    const res = run(new Error('boom'));
    expect(res.body.error.stack).toBeUndefined();
    expect(res.body.error.fullError).toBeUndefined();
    expect(res.body.request).toBeUndefined();
  });

  it('delegates to Express once headers are sent', () => {
    const res = mockResponse();
    (res as any).headersSent = true;
    const next = jest.fn();
    const err = new Error('late');
    errorHandler(err, mockRequest(), res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});
