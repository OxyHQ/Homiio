/**
 * Run a route's express-validator chain against a tool's input.
 *
 * Several routes validate in middleware before the controller runs
 * (`validation.validateProperty`, `validateLeaseCreate`,
 * `validateTenantApplication`, …). A tool reaches the same domain use case
 * WITHOUT that middleware, so its handler runs the same chain here first —
 * one set of rules, not a second copy that drifts. A failure is the route's
 * 400, as an `AppError` the handler wrapper turns into a tool error.
 *
 * The chain's trailing `handleValidationErrors` (a plain middleware, not a
 * chain) is skipped; its job is done by the `validationResult` check below.
 */

import { validationResult } from 'express-validator';
import { AppError } from '../../middlewares/errorHandler';

interface RunnableChain {
  run(req: unknown): Promise<unknown>;
}

function isRunnable(value: unknown): value is RunnableChain {
  return (
    typeof value === 'function' && typeof (value as unknown as { run?: unknown }).run === 'function'
  );
}

export async function runRouteValidation(
  chain: readonly unknown[],
  request: {
    body?: Record<string, unknown>;
    params?: Record<string, string>;
    query?: Record<string, string>;
  },
): Promise<void> {
  const req = {
    body: request.body ?? {},
    params: request.params ?? {},
    query: request.query ?? {},
    headers: {},
    cookies: {},
  };
  for (const step of chain) {
    if (isRunnable(step)) await step.run(req);
  }
  const errors = validationResult(req as never);
  if (!errors.isEmpty()) {
    const fields = errors
      .array()
      .map((error) => ('path' in error ? String(error.path) : 'input'))
      .join(', ');
    throw new AppError(`Validation failed for: ${fields}`, 400, 'VALIDATION_ERROR');
  }
}
