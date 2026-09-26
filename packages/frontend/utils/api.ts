import type { LinkedHttpClient, OxyServices } from '@oxy.so/core';
import { API_URL } from '@/config';

/** The HTTP client exposed by a linked backend client (Homiio's own API). */
type LinkedClient = LinkedHttpClient['client'];

// API Configuration
const API_CONFIG = {
  baseURL: API_URL,
};

// `T = any` and `Record<string, any>` below preserve the pre-existing public
// contract that 40+ call sites depend on (no-type-arg reads, typed filter
// params). This adoption changes only the TRANSPORT (now the linked client),
// not the consumer-facing types. eslint-disable kept narrow to these public
// generics — no `any` is used in the request logic itself.
 
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

/**
 * Custom API Error class for handling API-specific errors.
 *
 * The linked client already extracts the structured `message`/`error` field
 * from the API's JSON error body and surfaces it as the thrown error's
 * `message`, plus a numeric `status`. We re-wrap that into the app's own
 * `ApiError` so call sites keep their existing `error.status` / `error.response`
 * contract.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public response?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The Homiio backend client, linked to the Oxy session.
 *
 * `createLinkedClient` returns an HTTP client whose base URL is Homiio's own API
 * (`api.homiio.com`) but whose bearer token is kept in lockstep with the Oxy
 * session that `OxyProvider` owns: it mirrors the session's access token,
 * delegates 401 refresh back to the session, and invalidates the session when a
 * refresh ultimately fails. This replaces the hand-rolled `Authorization:
 * Bearer` plumbing — apps must not manage tokens themselves.
 *
 * Bound to the provider's client by {@link bindApiToOxy} (called from the root
 * layout, inside `OxyProvider`) and created lazily on the first request, so the
 * module has no import-time side effects. GET caching stays OFF (the SDK can't
 * invalidate Homiio's own backend); React Query owns caching for these reads.
 */
let boundOxy: OxyServices | null = null;
let linked: { oxy: OxyServices; handle: LinkedHttpClient } | null = null;

/** Point the Homiio API client at the `OxyServices` that owns the session. Idempotent. */
export function bindApiToOxy(oxy: OxyServices): void {
  boundOxy = oxy;
}

const getClient = (): LinkedClient => {
  if (!boundOxy) {
    throw new ApiError('The Homiio API was called before OxyProvider mounted');
  }
  if (!linked || linked.oxy !== boundOxy) {
    linked?.handle.dispose();
    linked = { oxy: boundOxy, handle: boundOxy.createLinkedClient({ baseURL: API_CONFIG.baseURL }) };
  }
  return linked.handle.client;
};

/**
 * Normalize an error thrown by the linked client into an {@link ApiError}.
 * The linked client throws a plain `Error` carrying `status` + `response`; we
 * preserve both.
 */
const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; status?: unknown; response?: unknown };
    const message = typeof e.message === 'string' ? e.message : 'Request failed';
    const status = typeof e.status === 'number' ? e.status : undefined;
    return new ApiError(message, status, e.response);
  }
  return new ApiError('Request failed');
};

/**
 * Re-wrap the linked client's payload back into the Homiio `{ success, data, … }`
 * response envelope that every consumer reads (`response.data.data`,
 * `response.data.pagination`, `response.data.results`, `response.data.success`,
 * or `response.data` returned whole as an `ApiResponse<T>` / `*Response` type).
 *
 * Why this is needed: the linked client's `HttpService` AUTO-UNWRAPS the
 * standardized success envelope before resolving. Its rule is:
 *  - paginated bodies `{ data, pagination }` are returned UNCHANGED (envelope kept);
 *  - bodies with a `data` key but no `pagination` resolve to just `body.data`
 *    (envelope stripped — `success`/`message` are lost);
 *  - bodies with no `data` key (e.g. `{ success, message }`) are returned UNCHANGED.
 *
 * Homiio's ~45 consumers, however, expect `response.data` to be the FULL
 * envelope. So for the stripped case we reconstruct `{ success: true, data: payload }`,
 * and for the kept-envelope cases we pass the payload straight through.
 *
 * Distinguishing a kept envelope from stripped inner data is unambiguous here:
 * a kept envelope is the only object that carries `pagination`, or carries
 * `success` without a `data` key. Stripped inner data is a domain payload
 * (array, scalar, or a `*Response` object), which never has a bare top-level
 * `success` and only pairs `pagination` with its own non-envelope keys (e.g.
 * `{ city, properties, pagination }`). On any non-2xx the HttpService throws
 * before resolving, so the reconstructed `success: true` is always correct for a
 * resolved payload — consumers' `!response.data.success` guard only runs on the
 * success path.
 */
const normalizeEnvelope = <T>(payload: unknown): T => {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;
    const isKeptEnvelope =
      'pagination' in obj || ('success' in obj && !('data' in obj));
    if (isKeptEnvelope) {
      return payload as T;
    }
  }
  return { success: true, data: payload } as T;
};

/**
 * Standard REST API methods for consistent usage across the app.
 *
 * `requireAuth` is retained for source-compatibility but is effectively a no-op:
 * the linked client attaches the bearer token only when a session exists, so
 * public reads degrade to unauthenticated requests automatically.
 */
export const api = {
  /**
   * GET request
   */
  async get<T = any>(
    endpoint: string,
    options?: {
      params?: Record<string, any>;
      requireAuth?: boolean;
    },
  ): Promise<{ data: T }> {
    try {
      const payload = await getClient().get<unknown>(endpoint, { params: options?.params });
      return { data: normalizeEnvelope<T>(payload) };
    } catch (error) {
      throw toApiError(error);
    }
  },

  /**
   * POST request
   */
  async post<T = any>(
    endpoint: string,
    body?: any,
    _options?: {
      requireAuth?: boolean;
    },
  ): Promise<{ data: T }> {
    try {
      const payload = await getClient().post<unknown>(endpoint, body);
      return { data: normalizeEnvelope<T>(payload) };
    } catch (error) {
      throw toApiError(error);
    }
  },

  /**
   * PUT request
   */
  async put<T = any>(
    endpoint: string,
    body?: any,
    _options?: {
      requireAuth?: boolean;
    },
  ): Promise<{ data: T }> {
    try {
      const payload = await getClient().put<unknown>(endpoint, body);
      return { data: normalizeEnvelope<T>(payload) };
    } catch (error) {
      throw toApiError(error);
    }
  },

  /**
   * DELETE request
   */
  async delete<T = any>(
    endpoint: string,
    _options?: {
      requireAuth?: boolean;
    },
  ): Promise<{ data: T }> {
    try {
      const payload = await getClient().delete<unknown>(endpoint);
      return { data: normalizeEnvelope<T>(payload) };
    } catch (error) {
      throw toApiError(error);
    }
  },

  /**
   * PATCH request
   */
  async patch<T = any>(
    endpoint: string,
    body?: any,
    _options?: {
      requireAuth?: boolean;
    },
  ): Promise<{ data: T }> {
    try {
      const payload = await getClient().patch<unknown>(endpoint, body);
      return { data: normalizeEnvelope<T>(payload) };
    } catch (error) {
      throw toApiError(error);
    }
  },
};
 

// Export the API configuration for external use
export { API_CONFIG };

// Default export
export default api;
