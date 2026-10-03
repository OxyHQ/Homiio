import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { useOxy } from '@oxy.so/services';
import type { LinkedHttpClient, ResponseTransport } from '@oxy.so/core';
import { API_URL } from '@/config';
import { createSindiLinkedFetch } from './sindiLinkedFetch';

/** One linked authority boundary for JSON, multipart and streaming Sindi calls. */
export function useSindiAuthenticatedFetch(): typeof globalThis.fetch {
  const { oxyServices, activeSessionId } = useOxy();
  const resource = useRef<{ owner: typeof oxyServices; sessionId: typeof activeSessionId; linked: LinkedHttpClient } | null>(null);
  useEffect(() => {
    const current = { owner: oxyServices, sessionId: activeSessionId, linked: oxyServices.createLinkedClient({ baseURL: API_URL }) };
    resource.current = current;
    return () => {
      if (resource.current === current) resource.current = null;
      current.linked.dispose();
    };
  }, [oxyServices, activeSessionId]);
  return useCallback<typeof globalThis.fetch>((input, init) => {
    const current = resource.current;
    if (!current || current.owner !== oxyServices || current.sessionId !== activeSessionId) {
      return Promise.reject(new Error('Sindi transport is not mounted'));
    }
    return createSindiLinkedFetch(current.linked.client,
      Platform.OS === 'web' ? globalThis.fetch : expoFetch as ResponseTransport)(input, init);
    // Session changes also identify a new stream owner to the conversation hook.
  }, [oxyServices, activeSessionId]);
}
