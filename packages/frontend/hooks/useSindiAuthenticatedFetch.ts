import { useCallback } from 'react';
import { Platform } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { useOxy } from '@oxyhq/services';
import { logger } from '@/utils/logger';

/** Shape compatible with the AI SDK / conversation store fetchers. */
type ConversationFetch = typeof globalThis.fetch;

/**
 * Builds the authenticated fetch used by every Sindi surface (the `/sindi`
 * index, the `/sindi/[conversationId]` route, and the docked `SindiPanel`).
 *
 * Single source of truth so the three hosts stay byte-identical:
 *   - Bearer token resolved from the active Oxy access token.
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
        try {
          let accessToken = oxyServices.getAccessToken();
          if (!accessToken) {
            const refreshed = await oxyServices.refreshTokenViaCookie();
            if (refreshed?.accessToken) {
              oxyServices.setTokens(refreshed.accessToken);
              accessToken = refreshed.accessToken;
            }
          }
          if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
          }
        } catch (error) {
          logger.error('Failed to get authentication token:', error);
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
