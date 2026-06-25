import { useCallback } from 'react';
import { Platform } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { useOxy } from '@oxyhq/services';

/** Shape compatible with the AI SDK / conversation store fetchers. */
type ConversationFetch = typeof globalThis.fetch;

/**
 * Builds the authenticated fetch used by every Sindi surface (the `/sindi`
 * index, the `/sindi/[conversationId]` route, and the docked `SindiPanel`).
 *
 * Single source of truth so the three hosts stay byte-identical:
 *   - Bearer token read from the active Oxy access token. The SDK
 *     (`OxyProvider`) OWNS token lifecycle — cold-boot restore plus background
 *     refresh keep `getAccessToken()` live — so this hook does NOT re-implement
 *     refresh/retry plumbing. Sindi is a streaming endpoint, which the SDK's
 *     JSON-only HTTP client cannot proxy, so we keep a raw streaming fetch but
 *     let the SDK own auth.
 *   - On web we use the browser's native `fetch` to preserve `ReadableStream`
 *     streaming semantics; native uses `expo/fetch`.
 *   - Multipart (`FormData`) bodies strip the `Content-Type` header so fetch
 *     sets the boundary itself.
 *
 * Memoized on `oxyServices` + `activeSessionId` so it is referentially stable
 * across renders (callers pass it straight into React Query / `useChat`).
 */
export function useSindiAuthenticatedFetch(): ConversationFetch {
  const { oxyServices, activeSessionId } = useOxy();

  return useCallback<ConversationFetch>(
    async (input, init = {}) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string>) || {}),
      };

      if (oxyServices && activeSessionId) {
        const accessToken = oxyServices.getAccessToken();
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }
      }

      const { body, ...rest } = init;

      // Let fetch set the multipart boundary header automatically.
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        delete headers['Content-Type'];
      }

      const fetchOptions: RequestInit = {
        ...rest,
        headers,
        ...(body !== null ? { body } : {}),
      };

      const fetchImpl =
        Platform.OS === 'web'
          ? globalThis.fetch
          : (expoFetch as unknown as ConversationFetch);
      return fetchImpl(input, fetchOptions);
    },
    [oxyServices, activeSessionId],
  );
}
