/**
 * The route bodies the booking tools answer, without the envelope.
 *
 * A tool returns the route's JSON body minus `success`, `message` and `meta`
 * (`homiio.handlers.ts`), so a paginated list is `{ data, pagination }` built
 * by the SAME `paginationResponse` the route uses — the page arithmetic cannot
 * drift between the two.
 */

import { paginationResponse } from '../../middlewares/errorHandler';
import type { ToolResult } from './context';

export function pageBody(
  rows: unknown[],
  page: number,
  limit: number,
  total: number,
  extra: Record<string, unknown> = {},
): ToolResult {
  const { data, pagination } = paginationResponse(rows, page, limit, total);
  return { data, pagination, ...extra };
}
