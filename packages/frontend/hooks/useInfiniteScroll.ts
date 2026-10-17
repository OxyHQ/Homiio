/**
 * useInfiniteScroll — end-of-list detection for a surface that owns its own
 * `ScrollView`, on every platform.
 *
 * Pages paginate through Bloom's `ScreenScrollView onEndReached`. This hook is
 * for the one surface that legitimately keeps its OWN scroller: the explore
 * results list, which scrolls beside the pinned map. It returns the three
 * handlers that `ScrollView` spreads on — `onScroll`, `onLayout` and
 * `onContentSizeChange` — and they work the same on native and on web, where
 * RN-Web's `ScrollView` is a scrolling element that reports all three.
 *
 * The scroll handler alone is not enough: content shorter than its viewport
 * never scrolls, so a first page that does not fill the list would never ask
 * for the second. The layout and content-size handlers run the same check, so
 * such a list keeps asking until it is full or there is nothing more.
 *
 * The guarded `loadMore` (`if (hasNextPage && !isFetchingNextPage) fetchNextPage()`)
 * lives in the consumer; this hook only decides WHEN the end is reached.
 */
import { useCallback, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/**
 * Fraction of the scroll extent past which the surface is treated as "at the
 * end". `0.7` pre-fetches the next page while ~30% of the current content is
 * still below the fold, so paging feels seamless rather than hitting a hard
 * bottom.
 */
const END_REACHED_THRESHOLD = 0.7;

/** `sentFor` while nothing has been reported since the reader left the end. */
const ARMED = -1;

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
  onLayout: (event: LayoutChangeEvent) => void;
  onContentSizeChange: (width: number, height: number) => void;
}

export function useInfiniteScroll({
  onEndReached,
  enabled,
  threshold = END_REACHED_THRESHOLD,
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const metrics = useRef({ offset: 0, viewport: 0, content: 0 });
  /**
   * The content height the end was last reported for, as `FlatList` keeps it:
   * one report per approach, re-armed when the reader scrolls back out, and
   * repeated while still at the end only once the content has changed height
   * (a page arrived and still did not fill the list).
   */
  const sentFor = useRef(ARMED);

  const check = useCallback(() => {
    const { offset, viewport, content } = metrics.current;
    if (content <= 0 || viewport <= 0) return;
    // As tall as its own content: the parent gave the scroll view no height, so
    // it scrolls nothing and every page would grow it to "the end" again —
    // asking on each one would page through the whole result set unbidden.
    if (Math.abs(viewport - content) < 1) return;
    if (offset + viewport < content * threshold) {
      sentFor.current = ARMED;
      return;
    }
    if (!enabled || sentFor.current === content) return;
    sentFor.current = content;
    onEndReached();
  }, [enabled, threshold, onEndReached]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      metrics.current = {
        offset: contentOffset.y,
        viewport: layoutMeasurement.height,
        content: contentSize.height,
      };
      check();
    },
    [check],
  );

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      metrics.current = { ...metrics.current, viewport: event.nativeEvent.layout.height };
      check();
    },
    [check],
  );

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      metrics.current = { ...metrics.current, content: height };
      check();
    },
    [check],
  );

  return { onScroll, onLayout, onContentSizeChange };
}
