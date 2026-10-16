import type { NextFunction, Response } from 'express';

import { AppError } from '../../middlewares/errorHandler';
import { errorResponse } from './shared';

/**
 * Answer a refusal from `domain/saved.ts` in this route family's own body
 * (`errorResponse`: `{ success: false, message, code, timestamp }`), and pass
 * anything else on to the error handler.
 */
export function sendSavedError(res: Response, next: NextFunction, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json(errorResponse(error.message, error.code ?? 'ERROR'));
    return;
  }
  next(error);
}

/** The 401 every handler in this family answers without a session. */
export function sendAuthenticationRequired(res: Response): void {
  res.status(401).json(errorResponse('Authentication required', 'AUTHENTICATION_REQUIRED'));
}
