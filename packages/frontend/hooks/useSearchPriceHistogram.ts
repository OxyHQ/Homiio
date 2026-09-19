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
 *
 * ## The scope names the currency; this hook does not
 *
 * ADR 0004 §6.5 forbids mixing currencies inside one statistic, so the endpoint
 * answers in exactly one — the one it is ASKED for, or, when it is asked for
 * none, the scope's own most common. This hook deliberately asks for none.
 * Sending `EUR` (which it used to) is what made the bars vanish entirely in
 * every area that prices in something else: the server answered `null` rather
 * than mixing, and a filter with no bars looked like an area with no listings.
 * The currency comes BACK instead, and the caller labels the bars with it.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { OfferingType, parseListingCurrency, type ListingCurrency } from '@homiio/shared-types';
import type { SearchQuery } from '@/components/search/types';
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
    otherCurrencyCount?: number;
    buckets: Array<{ from: number; to: number; count: number }>;
  } | null;
}

/** The distribution a price control can draw, and what it has to say about it. */
export interface SearchPriceHistogram {
  /** One count per bar, over `0`..`track.max`. */
  counts: number[];
  /**
   * The currency these counts are in — the scope's own, not the app's.
   *
   * Narrowed to {@link ListingCurrency} rather than a bare string because the
   * price FILTER now takes it (see `components/search/types.ts`), and a code
   * the price columns cannot hold would narrow a search to nothing. A response
   * carrying one is treated as no histogram at all: that is a server
   * disagreeing with the client about the vocabulary, and drawing bars labelled
   * in a currency no listing is priced in is worse than drawing none.
   */
  currency: ListingCurrency;
  /**
   * Priced listings in the same scope carrying a DIFFERENT currency. They are
   * not in `counts` and must not be converted into it; the control says so
   * rather than quietly under-reporting the area.
   */
  otherCurrencyCount: number;
}

/**
 * The span the buckets cover, and the whole of what the request says about
 * price. Exported so a test can assert what is NOT in it.
 */
export function priceHistogramSpan(track: PriceTrack): Record<string, number> {
  return {
    histogramMin: 0,
    histogramMax: track.max,
    histogramBuckets: PRICE_HISTOGRAM_BUCKETS,
  };
}

export interface UseSearchPriceHistogramOptions {
  /** Hold the request (e.g. while the price control is not on screen). */
  enabled?: boolean;
}

export function useSearchPriceHistogram(
  query: SearchQuery,
  track: PriceTrack,
  { enabled = true }: UseSearchPriceHistogramOptions = {},
): SearchPriceHistogram | undefined {
  // `priceTrackFor` hands back one of three module-level constants, so the
  // track's identity is stable and this memo really is per-offering.
  const span = useMemo(() => priceHistogramSpan(track), [track]);
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
    const currency = parseListingCurrency(histogram.currency);
    if (!currency) return undefined;
    const counts = histogram.buckets.map((bucket) => bucket.count);
    if (!counts.some((count) => count > 0)) return undefined;
    return {
      counts,
      currency,
      otherCurrencyCount: histogram.otherCurrencyCount ?? 0,
    };
  }, [runnable, data, track.max]);
}
