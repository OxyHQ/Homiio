import React, { useEffect } from 'react';
import {
  Platform,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

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
}: PageScrollViewProps) {
  const fallbackScrollY = useSharedValue(0);
  const value = scrollY ?? fallbackScrollY;

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      value.value = event.contentOffset.y;
    },
  });

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
