/**
 * useInfiniteScroll — the NATIVE half of Homiio's Mention-style infinite-scroll
 * primitive.
 *
 * Pages no longer own a vertical scroll view: Bloom's `AppShell` scrolls the
 * document on web and its own container on native, and a page paginates with a
 * {@link LoadMoreSentinel} at the list's end (an `IntersectionObserver` on web).
 * This hook is for the surfaces that legitimately keep their OWN `ScrollView`
 * (e.g. the explore results list beside the pinned map): it returns an
 * `onScroll` handler the `ScrollView` spreads onto its own `onScroll`, detecting
 * that it is near the bottom and calling `onEndReached`, so no surface
 * re-derives the distance math.
 *
 * The guarded `loadMore` (`if (hasNextPage && !isFetchingNextPage) fetchNextPage()`)
 * lives in each consumer, matching Mention's `handleLoadMore`; this hook only
 * decides WHEN the end is reached.
 */
import { useCallback, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/**
 * Fraction of the scroll extent past which the surface is treated as "at the
 * end". `0.7` pre-fetches the next page while ~30% of the current content is
 * still below the fold, so paging feels seamless rather than hitting a hard
 * bottom.
 */
const END_REACHED_THRESHOLD = 0.7;

interface UseInfiniteScrollOptions {
  /** Guarded next-page loader — invoked once each time the end is approached. */
  onEndReached: () => void;
  /** Only fire while there is more to load (no next page ⇒ no trigger). */
  enabled: boolean;
  /** Fraction of the content height past which the end is reached (0–1). */
  threshold?: number;
}

interface UseInfiniteScrollResult {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

export function useInfiniteScroll({
  onEndReached,
  enabled,
  threshold = END_REACHED_THRESHOLD,
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  // Re-arm only after the user scrolls back above the threshold, so the burst of
  // `onScroll` events fired while lingering near the bottom triggers `onEndReached`
  // at most once per approach (the consumer's own guard is the second line of
  // defence, but this keeps us from spamming it every frame).
  const armedRef = useRef(true);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      if (contentSize.height <= 0) return;
      const reachedEnd =
        contentOffset.y + layoutMeasurement.height >= contentSize.height * threshold;
      if (!reachedEnd) {
        armedRef.current = true;
        return;
      }
      if (enabled && armedRef.current) {
        armedRef.current = false;
        onEndReached();
      }
    },
    [enabled, threshold, onEndReached],
  );

  return { onScroll };
}
