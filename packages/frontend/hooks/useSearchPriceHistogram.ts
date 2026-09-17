/**
 * useSearchPriceHistogram — the bars under a search's price slider.
 *
 * Reads `GET /api/properties/search/price-histogram` with the SAME scope and
 * filters the search sends (`buildPriceHistogramParams`), bucketed over the
 * slider's own track so each bar sits over the prices it counts: Bloom's
 * `PriceHistogram` splits `min`..`max` evenly, and this asks the server to split
 * `0`..`track.max` into the same number of buckets. The server's edge buckets
 * are open-ended, which is what a track whose top means "no maximum" draws.
 *
 * Returns the bucket counts, or `undefined` while loading, on error, when the
 * scope cannot be searched, when the place did not resolve, or when nothing in
 * scope is priced — the slider then renders with no bars rather than with a
 * distribution that describes somewhere else (ADR 0002 §4.3).
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { OfferingType } from '@homiio/shared-types';
import { SEARCH_PRICE_CURRENCY, type SearchQuery } from '@/components/search/types';
import type { PriceTrack } from '@/components/search/steps/PriceStep';
import { api } from '@/utils/api';

import {
  buildPriceHistogramParams,
  isUnscopeableLocation,
  priceHistogramQueryKey,
} from './usePropertySearch';

const ENDPOINT = '/api/properties/search/price-histogram';

/** Bars across the track: enough to show a shape, few enough to stay legible on a phone. */
export const PRICE_HISTOGRAM_BUCKETS = 32;

const STALE_TIME_MS = 1000 * 60;

interface PriceHistogramResponse {
  location?: { status?: string };
  priceHistogram: {
    currency: string;
    min: number;
    max: number;
    count: number;
    buckets: Array<{ from: number; to: number; count: number }>;
  } | null;
}

export interface UseSearchPriceHistogramOptions {
  /** Hold the request (e.g. while the price control is not on screen). */
  enabled?: boolean;
}

export function useSearchPriceHistogram(
  query: SearchQuery,
  track: PriceTrack,
  { enabled = true }: UseSearchPriceHistogramOptions = {},
): number[] | undefined {
  const span = useMemo(
    () => ({
      histogramMin: 0,
      histogramMax: track.max,
      histogramBuckets: PRICE_HISTOGRAM_BUCKETS,
      currency: SEARCH_PRICE_CURRENCY,
    }),
    [track.max],
  );
  const params = useMemo(() => ({ ...buildPriceHistogramParams(query), ...span }), [query, span]);
  const queryKey = useMemo(() => priceHistogramQueryKey(query, span), [query, span]);

  const runnable =
    enabled && query.offering !== OfferingType.EXCHANGE && !isUnscopeableLocation(query.location);

  const { data } = useQuery({
    queryKey,
    enabled: runnable,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<PriceHistogramResponse> => {
      const response = await api.get<PriceHistogramResponse>(ENDPOINT, { params, requireAuth: false });
      return response.data;
    },
  });

  return useMemo(() => {
    if (!runnable || !data || data.location?.status === 'unresolved') return undefined;
    const histogram = data.priceHistogram;
    // Only a histogram over exactly the slider's span can be drawn under it.
    if (!histogram || histogram.min !== 0 || histogram.max !== track.max) return undefined;
    const counts = histogram.buckets.map((bucket) => bucket.count);
    return counts.some((count) => count > 0) ? counts : undefined;
  }, [runnable, data, track.max]);
}
