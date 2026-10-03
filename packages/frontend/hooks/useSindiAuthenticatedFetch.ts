import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { useOxy } from '@oxy.so/services';
import type { ResponseTransport } from '@oxy.so/core';
import { API_URL } from '@/config';
import { createSindiLinkedFetch } from './sindiLinkedFetch';

/** One linked authority boundary for JSON, multipart and streaming Sindi calls. */
export function useSindiAuthenticatedFetch(): typeof globalThis.fetch {
  const { oxyServices } = useOxy();
  const linked = useMemo(() => oxyServices.createLinkedClient({ baseURL: API_URL }), [oxyServices]);
  useEffect(() => () => linked.dispose(), [linked]);
  return useMemo(() => createSindiLinkedFetch(linked.client,
    Platform.OS === 'web' ? globalThis.fetch : expoFetch as ResponseTransport), [linked]);
}
