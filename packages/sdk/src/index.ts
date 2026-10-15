import {
  apiErrorSchema,
  publicCaseBatchRequestSchema,
  publicCaseBatchResponseSchema,
  MAX_PUBLIC_CASE_BATCH,
  type ApiErrorCode,
  type PublicCaseBatchResponse,
} from '@oxy.so/homiio-contracts';
export {
  getHomiioCaseUrl,
  parseHomiioCaseUrl,
  getMentionShareUrl,
  MAX_PUBLIC_CASE_BATCH,
} from '@oxy.so/homiio-contracts';
export type { PublicCase, PublicCaseBatchResponse, ApiErrorCode } from '@oxy.so/homiio-contracts';

export class HomiioApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = 'HomiioApiError';
  }
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
    const uniqueIds = [...new Set(ids)];
    // Consumers may resolve a viewport larger than one batch without issuing one request per card.
    const batches = [];
    for (let offset = 0; offset < uniqueIds.length; offset += MAX_PUBLIC_CASE_BATCH) {
      batches.push(uniqueIds.slice(offset, offset + MAX_PUBLIC_CASE_BATCH));
    }
    const results = await Promise.all(
      batches.map(async (batch) => {
        const body = publicCaseBatchRequestSchema.parse({ ids: batch });
        const response = await this.fetcher(`${this.baseUrl}/cases/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: options.signal,
          cache: 'no-store',
        });
        const json: unknown = await response.json();
        if (!response.ok) {
          const { error } = apiErrorSchema.parse(json);
          throw new HomiioApiError(response.status, error.code, error.message, error.details);
        }
        const result = publicCaseBatchResponseSchema.parse(json);
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

export * from './team';
