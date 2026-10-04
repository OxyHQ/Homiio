import type { LinkedHttpClient, ResponseRequest, ResponseTransport } from '@oxy.so/core';
import { responseRequiresSindiConsent, SindiConsentRequiredError } from './sindiConsent';

/** The caller chooses web fetch or Expo fetch; the SDK owns bearer and replay. */
export function createSindiLinkedFetch(client: LinkedHttpClient['client'], transport: ResponseTransport): typeof globalThis.fetch {
  return async (input, init = {}) => {
    const source = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    const url = source ? source.url : String(input);
    const method = (init.method ?? source?.method ?? 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Unsupported Sindi request method');
    const body = init.body === undefined ? source?.body : init.body;
    const headers = new Headers(source?.headers);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    if (typeof FormData !== 'undefined' && body instanceof FormData) headers.delete('Content-Type');
    else if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await client.requestAuthenticatedResponse({
      method: method as ResponseRequest['method'], url, body: body ?? undefined, headers,
      signal: init.signal ?? source?.signal, fetch: transport,
    });
    if (await responseRequiresSindiConsent(response)) throw new SindiConsentRequiredError();
    return response;
  };
}
