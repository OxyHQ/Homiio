import type { LinkedHttpClient, OxyServices, ResponseRequest } from '@oxy.so/core';
import { API_URL } from '@/config';

const API_CONFIG = { baseURL: API_URL };

// Preserve the existing public generics used by the app's domain callers.
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}
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

let boundOxy: OxyServices | null = null;
let linked: { oxy: OxyServices; handle: LinkedHttpClient } | null = null;
export function bindApiToOxy(oxy: OxyServices): void {
  boundOxy = oxy;
}
const getClient = (): LinkedHttpClient['client'] => {
  if (!boundOxy) throw new ApiError('The Homiio API was called before OxyProvider mounted');
  if (!linked || linked.oxy !== boundOxy) {
    linked?.handle.dispose();
    linked = {
      oxy: boundOxy,
      handle: boundOxy.createLinkedClient({ baseURL: API_CONFIG.baseURL }),
    };
  }
  return linked.handle.client;
};
const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; status?: unknown; response?: unknown };
    return new ApiError(
      typeof e.message === 'string' ? e.message : 'Request failed',
      typeof e.status === 'number' ? e.status : undefined,
      e.response,
    );
  }
  return new ApiError('Request failed');
};
type Options = { requireAuth?: boolean; params?: Record<string, any> };

/** Preserve the complete wire envelope; the linked SDK owns session authority. */
async function request<T>(
  method: ResponseRequest['method'],
  endpoint: string,
  body?: unknown,
  options?: Options,
): Promise<{ data: T }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options?.params ?? {})) {
    if (value !== null && value !== undefined) query.append(key, String(value));
  }
  const suffix = query.toString();
  const url = suffix ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}${suffix}` : endpoint;
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  const controller = new AbortController();
  // Preserve the linked client's prior default deadline, including body reads.
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const client = getClient();
    const config: ResponseRequest = {
      method,
      url,
      signal: controller.signal,
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
      ...(multipart ? {} : { headers: { 'Content-Type': 'application/json' } }),
    };
    // Public endpoints really are mounted ahead of backend auth. An explicit
    // requireAuth opts into the required wrapper; omitted/false remains public-capable.
    const response = await (options?.requireAuth
      ? client.requestAuthenticatedResponse(config)
      : client.requestResponse(config));
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) throw new ApiError('Invalid JSON response', response.status);
      }
    }
    if (!response.ok) {
      const value = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      const message =
        typeof value?.message === 'string'
          ? value.message
          : typeof value?.error === 'string'
            ? value.error
            : `Request failed with status ${response.status}`;
      throw new ApiError(message, response.status, data);
    }
    return { data: data as T };
  } catch (error) {
    throw toApiError(error);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T = any>(endpoint: string, options?: Options) =>
    request<T>('GET', endpoint, undefined, options),
  post: <T = any>(endpoint: string, body?: any, options?: Options) =>
    request<T>('POST', endpoint, body, options),
  put: <T = any>(endpoint: string, body?: any, options?: Options) =>
    request<T>('PUT', endpoint, body, options),
  patch: <T = any>(endpoint: string, body?: any, options?: Options) =>
    request<T>('PATCH', endpoint, body, options),
  delete: <T = any>(endpoint: string, options?: Options) =>
    request<T>('DELETE', endpoint, undefined, options),
};
export { API_CONFIG };
export default api;
