/**
 * The route's JSON body minus `success`, `message` and `meta` — what the
 * application, lease and payment tools return, built with the SAME envelope
 * helpers the controllers use so the two cannot drift.
 */

import { paginationResponse, successResponse } from '../../middlewares/errorHandler';

function strip(body: Record<string, unknown>): Record<string, unknown> {
  const { success: _success, message: _message, meta: _meta, ...rest } = body;
  return rest;
}

/** `successResponse(data)` → `{ data }`. */
export function dataBody(data: unknown): Record<string, unknown> {
  return strip(successResponse(data));
}

/** `paginationResponse(...)` → `{ data, pagination }`. */
export function pageBody(
  data: unknown,
  page: number,
  limit: number,
  total: number,
): Record<string, unknown> {
  return strip(paginationResponse(data, page, limit, total));
}
