import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { useOxy } from '@oxy.so/services';
import type { LinkedHttpClient, ResponseTransport } from '@oxy.so/core';
import { API_URL } from '@/config';
import { createSindiLinkedFetch } from './sindiLinkedFetch';

/** One linked authority boundary for JSON, multipart and streaming Sindi calls. */
export function useSindiAuthenticatedFetch(): typeof globalThis.fetch {
  const { oxyServices, activeSessionId } = useOxy();
  // A pure identity per committed owner transition also fences A → B → A.
  // The memo allocates no linked client or subscription during render.
  const generation = useMemo(
    () => ({ owner: oxyServices, sessionId: activeSessionId }),
    [oxyServices, activeSessionId],
  );
  const resource = useRef<{ generation: object; linked: LinkedHttpClient } | null>(null);
  useEffect(() => {
    const current = { generation, linked: oxyServices.createLinkedClient({ baseURL: API_URL }) };
    resource.current = current;
    return () => {
      if (resource.current === current) resource.current = null;
      current.linked.dispose();
    };
  }, [oxyServices, generation]);
  return useCallback<typeof globalThis.fetch>(
    (input, init) => {
      const current = resource.current;
      if (!current || current.generation !== generation) {
        return Promise.reject(new Error('Sindi transport is not mounted'));
      }
      return createSindiLinkedFetch(
        current.linked.client,
        Platform.OS === 'web' ? globalThis.fetch : (expoFetch as ResponseTransport),
      )(input, init);
      // Session changes also identify a new stream owner to the conversation hook.
    },
    [generation],
  );
}
