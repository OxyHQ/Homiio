/**
 * The public case client without a schema runtime.
 *
 * Browsers load this entry (`@oxy.so/homiio-sdk/client`) to resolve case cards,
 * so it checks requests and responses by hand instead of through the Zod
 * schemas in `@oxy.so/homiio-contracts`: those weigh hundreds of KB that a card
 * renderer would otherwise download and evaluate. It accepts exactly what
 * `publicCaseBatchResponseSchema` and `apiErrorSchema` accept, and the types
 * and limits below are tied to the contracts at compile time.
 */
import type {
  ApiErrorCode,
  MAX_PUBLIC_CASE_BATCH as ContractBatchLimit,
  PublicCase,
  PublicCaseBatchResponse,
} from '@oxy.so/homiio-contracts';
import { CASE_ID_MAX_LENGTH, CASE_ID_MIN_LENGTH } from '@oxy.so/homiio-contracts/links';

export type { PublicCase, PublicCaseBatchResponse, ApiErrorCode } from '@oxy.so/homiio-contracts';

const BATCH_LIMIT: typeof ContractBatchLimit = 50;
// A Record keyed by the contract's union fails to compile when a value is added or removed.
const CASE_STATUSES: Record<PublicCase['status'], true> = {
  upcoming: true,
  stopped: true,
  postponed: true,
  executed: true,
  cancelled: true,
};
const ERROR_CODES: Record<ApiErrorCode, true> = {
  bad_request: true,
  unauthorized: true,
  forbidden: true,
  not_found: true,
  unknown_route: true,
  gone: true,
  conflict: true,
  validation_failed: true,
  rate_limited: true,
  internal_error: true,
  service_unavailable: true,
};
// `z.iso.datetime()`: UTC only, optional seconds and fraction.
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/;

type ErrorDetails = Record<string, string | number | boolean | null>;

export class HomiioApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'HomiioApiError';
  }
}

function invalid(): never {
  throw new TypeError('Invalid Homiio response');
}
function record(value: unknown, keys: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const present = Object.keys(value);
  if (present.some((key) => !keys.includes(key) && !optional.includes(key))) invalid();
  if (keys.some((key) => !(key in value))) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, min = 0, max = Number.POSITIVE_INFINITY): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) invalid();
  return value;
}
const isCaseId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= CASE_ID_MIN_LENGTH &&
  value.length <= CASE_ID_MAX_LENGTH;
function caseId(value: unknown): string {
  if (!isCaseId(value)) invalid();
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > BATCH_LIMIT) invalid();
  return value;
}

function publicCase(value: unknown): PublicCase {
  const item = record(value, ['id', 'title', 'area', 'scheduledAt', 'status', 'url']);
  const area = record(item.area, ['label', 'precision']);
  if (area.precision !== 'area') invalid();
  const scheduledAt = text(item.scheduledAt);
  if (!ISO_DATETIME.test(scheduledAt) || Number.isNaN(Date.parse(scheduledAt))) invalid();
  const status = text(item.status);
  if (!Object.hasOwn(CASE_STATUSES, status)) invalid();
  const url = text(item.url);
  try {
    new URL(url);
  } catch {
    invalid();
  }
  return {
    id: caseId(item.id),
    title: text(item.title, 1),
    area: { label: text(area.label, 1), precision: 'area' },
    scheduledAt,
    status: status as PublicCase['status'],
    url,
  };
}

function batchResponse(value: unknown): PublicCaseBatchResponse {
  const body = record(value, ['items', 'unavailableIds']);
  return {
    items: list(body.items).map(publicCase),
    unavailableIds: list(body.unavailableIds).map(caseId),
  };
}

function apiError(status: number, value: unknown): HomiioApiError {
  const { error } = record(value, ['error']);
  const body = record(error, ['code', 'message'], ['details']);
  const code = text(body.code);
  if (!Object.hasOwn(ERROR_CODES, code)) invalid();
  let details: ErrorDetails | undefined;
  if (body.details !== undefined) {
    const raw = body.details;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
    const entries = Object.entries(raw);
    if (entries.some(([, v]) => v !== null && !['string', 'number', 'boolean'].includes(typeof v)))
      invalid();
    details = Object.fromEntries(entries) as ErrorDetails;
  }
  return new HomiioApiError(status, code as ApiErrorCode, text(body.message), details);
}

export class HomiioClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  constructor(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.homiio.com/api/v1').replace(/\/$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  async getPublicCases(
    ids: readonly string[],
    options: { signal?: AbortSignal } = {},
  ): Promise<PublicCaseBatchResponse> {
    if (!ids.length) return { items: [], unavailableIds: [] };
    if (!ids.every(isCaseId)) throw new TypeError('Case IDs must be 1 to 200 characters');
    const uniqueIds = [...new Set(ids)];
    // Consumers may resolve a viewport larger than one batch without issuing one request per card.
    const batches = [];
    for (let offset = 0; offset < uniqueIds.length; offset += BATCH_LIMIT) {
      batches.push(uniqueIds.slice(offset, offset + BATCH_LIMIT));
    }
    const results = await Promise.all(
      batches.map(async (batch) => {
        const response = await this.fetcher(`${this.baseUrl}/cases/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: batch }),
          signal: options.signal,
          cache: 'no-store',
        });
        const json: unknown = await response.json();
        if (!response.ok) throw apiError(response.status, json);
        const result = batchResponse(json);
        const returned = [...result.items.map((item) => item.id), ...result.unavailableIds];
        if (
          returned.length !== batch.length ||
          new Set(returned).size !== batch.length ||
          returned.some((id) => !batch.includes(id))
        )
          throw new Error('Invalid Homiio batch response');
        return result;
      }),
    );
    return {
      items: results.flatMap((result) => result.items),
      unavailableIds: results.flatMap((result) => result.unavailableIds),
    };
  }
}
