import React, { useCallback, useEffect, useRef } from 'react';
import {
  Platform,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { END_REACHED_THRESHOLD } from '@/hooks/useInfiniteScroll';

const IS_WEB = Platform.OS === 'web';

interface PageScrollViewProps {
  children: React.ReactNode;
  /**
   * The screen's scroll position, driven by the SOLE scroll owner: the document
   * on web (mirrored from `window.scrollY`) and the screen's own
   * `Animated.ScrollView` on native. Screens read it for parallax / sticky-header
   * animations. A local fallback is used when a screen does not need to read it.
   */
  scrollY?: SharedValue<number>;
  className?: string;
  contentClassName?: string;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Native-only — ignored on web where the document is the scroll owner. */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  showsVerticalScrollIndicator?: boolean;
  /**
   * NATIVE-only infinite-scroll trigger. Fired (guarded, once per approach) when
   * the native `Animated.ScrollView` scrolls past {@link onEndReachedThreshold}
   * of its content. On web the document is the scroll owner, so a screen pairs
   * this with a `<LoadMoreSentinel>` at the feed's end and the sentinel drives
   * web pagination instead. The consumer's own
   * `if (hasNextPage && !isFetchingNextPage) fetchNextPage()` guard keeps this
   * idempotent.
   */
  onEndReached?: () => void;
  /** Fraction of content height past which `onEndReached` fires (0–1). */
  onEndReachedThreshold?: number;
}

/**
 * One scroll owner per screen.
 *
 * WEB: the DOCUMENT scrolls (the shell renders no page-level `ScrollView`), so
 * this renders a plain flow `View` and mirrors `window.scrollY` into `scrollY`.
 * Rendering a real `ScrollView` here would create a second, competing scroll
 * container whose `onScroll` never fires once the document owns the scroll.
 *
 * NATIVE: the screen's `Animated.ScrollView` is the sole scroll owner and writes
 * `scrollY` from its own `onScroll` on the UI thread.
 */
export function PageScrollView({
  children,
  scrollY,
  className,
  contentClassName,
  style,
  contentContainerStyle,
  refreshControl,
  showsVerticalScrollIndicator,
  onEndReached,
  onEndReachedThreshold = END_REACHED_THRESHOLD,
}: PageScrollViewProps) {
  const fallbackScrollY = useSharedValue(0);
  const value = scrollY ?? fallbackScrollY;

  // Keep the latest `onEndReached` without regenerating the worklet handler.
  const onEndReachedRef = useRef(onEndReached);
  onEndReachedRef.current = onEndReached;
  const fireEndReached = useCallback(() => {
    onEndReachedRef.current?.();
  }, []);
  const endEnabled = onEndReached != null;
  // Re-arm on the UI thread once scrolled back above the threshold, so the burst
  // of worklet `onScroll` events near the bottom hops to JS at most once per
  // approach.
  const endArmed = useSharedValue(true);

  const scrollHandler = useAnimatedScrollHandler(
    {
      onScroll: (event) => {
        value.value = event.contentOffset.y;
        if (!endEnabled) return;
        const { contentOffset, layoutMeasurement, contentSize } = event;
        if (contentSize.height <= 0) return;
        const reachedEnd =
          contentOffset.y + layoutMeasurement.height >=
          contentSize.height * onEndReachedThreshold;
        if (!reachedEnd) {
          endArmed.value = true;
          return;
        }
        if (endArmed.value) {
          endArmed.value = false;
          runOnJS(fireEndReached)();
        }
      },
    },
    [value, endArmed, endEnabled, onEndReachedThreshold, fireEndReached],
  );

  useEffect(() => {
    if (!IS_WEB) return;
    const handleScroll = () => {
      value.value = window.scrollY;
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [value]);

  if (IS_WEB) {
    return (
      <View className={className ?? 'flex-1'} style={style}>
        <View className={contentClassName} style={contentContainerStyle}>
          {children}
        </View>
      </View>
    );
  }

  return (
    <Animated.ScrollView
      className={className ?? 'flex-1'}
      style={style}
      contentContainerStyle={contentContainerStyle}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
    >
      {children}
    </Animated.ScrollView>
  );
}
