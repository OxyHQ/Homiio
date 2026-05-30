import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
  UIManager,
  Image,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/styles/colors';
import { Button } from '@oxyhq/bloom/button';

// Apple-style colors
const APPLE_CARD_BACKGROUND = '#ffffff';
const APPLE_TEXT_PRIMARY = '#1f2937';
const APPLE_TEXT_SECONDARY = '#6b7280';
const MINIMAL_BORDER = '#e5e7eb';

interface SindiExplanationBottomSheetProps {
  onClose: () => void;
}

const TOTAL_STEPS = 5;

export function SindiExplanationBottomSheet({ onClose }: SindiExplanationBottomSheetProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [layoutWidth, setLayoutWidth] = useState(Dimensions.get('window').width);
  // dynamic height
  const [containerHeight, setContainerHeight] = useState<number>(0);
  // Per-step measured heights live on a SharedValue (not a plain ref) so the
  // scroll worklet can read them on the UI thread by reference. Reading a plain
  // JS ref/array inside a worklet would capture and freeze it, breaking the
  // worklet runtime (see reanimated serializable freezing in dev).
  const heights = useSharedValue<number[]>(Array(TOTAL_STEPS).fill(0));
  const navVisibility = useSharedValue(1); // 1 visible, 0 hidden
  const navContentHeight = useSharedValue(0); // measured height of nav for collapse

  const scrollX = useSharedValue(0);
  const slideUp = useSharedValue(40);
  const sheetOpacity = useSharedValue(0);
  const heightAnim = useSharedValue(0);
  const isScrollingRef = useRef(false);
  const scrollRef = useRef<Animated.ScrollView>(null);

  // Enable LayoutAnimation on Android
  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    slideUp.value = withSpring(0, { damping: 14, stiffness: 140, mass: 0.7 });
    sheetOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
  }, [slideUp, sheetOpacity]);

  const handleSkip = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleStart = useCallback(() => {
    onClose();
  }, [onClose]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      if (w && Math.abs(w - layoutWidth) > 1) setLayoutWidth(w);
    },
    [layoutWidth],
  );

  const handleStepChange = useCallback((nearest: number) => {
    setCurrentStep((prev) => (prev === nearest ? prev : nearest));
  }, []);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const offsetX = event.contentOffset.x;
      scrollX.value = offsetX;
      if (layoutWidth > 0) {
        const rawIndex = offsetX / layoutWidth;
        const base = Math.floor(rawIndex);
        const progress = rawIndex - base;
        const stepHeights = heights.value;
        const h1 = stepHeights[base];
        const h2 = stepHeights[Math.min(base + 1, TOTAL_STEPS - 1)];
        if (h1 && h2) {
          heightAnim.value = h1 + (h2 - h1) * progress;
        } else if (h1) {
          heightAnim.value = h1;
        }
        const nearest = Math.round(offsetX / layoutWidth);
        if (nearest >= 0 && nearest < TOTAL_STEPS) {
          runOnJS(handleStepChange)(nearest);
        }
        const fadeStart = TOTAL_STEPS - 2; // start fading on second-to-last step
        const progressToLast = rawIndex - fadeStart; // 0 -> begin fade
        if (progressToLast <= 0) {
          navVisibility.value = 1;
        } else {
          navVisibility.value = 1 - Math.min(1, progressToLast);
        }
      }
    },
  });

  // Animate container height when current step height updates outside active swipe
  useEffect(() => {
    if (isScrollingRef.current) return;
    if (!containerHeight) return;
    heightAnim.value = withTiming(containerHeight, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
  }, [containerHeight, heightAnim]);

  // Reset cached heights when width changes (e.g., orientation)
  useEffect(() => {
    heights.value = Array(TOTAL_STEPS).fill(0);
    setContainerHeight(0);
    heightAnim.value = 0;
  }, [layoutWidth, heightAnim, heights]);

  const handleScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / Math.max(1, layoutWidth));
      if (index !== currentStep) {
        setCurrentStep(index);
        const h = heights.value[index] || containerHeight;
        setContainerHeight(h);
      }
      // ensure final snap animation to exact measured height
      const hFinal = heights.value[index] || containerHeight;
      heightAnim.value = withTiming(
        hFinal,
        { duration: 160, easing: Easing.out(Easing.quad) },
        () => {
          isScrollingRef.current = false;
        },
      );
    },
    [layoutWidth, currentStep, heightAnim, containerHeight, heights],
  );

  const handlePrevious = useCallback(() => {
    if (!scrollRef.current) return;
    const target = Math.max(0, currentStep - 1);
    if (target !== currentStep) {
      setCurrentStep(target);
      const h = heights.value[target] || containerHeight;
      setContainerHeight(h);
    }
    scrollRef.current.scrollTo({ x: target * layoutWidth, animated: true });
  }, [currentStep, layoutWidth, containerHeight, heights]);

  const handleNext = useCallback(() => {
    if (currentStep >= TOTAL_STEPS - 1) {
      handleStart();
      return;
    }
    if (!scrollRef.current) return;
    const target = Math.min(TOTAL_STEPS - 1, currentStep + 1);
    if (target !== currentStep) {
      setCurrentStep(target);
      const h = heights.value[target] || containerHeight;
      setContainerHeight(h);
    }
    scrollRef.current.scrollTo({ x: target * layoutWidth, animated: true });
  }, [currentStep, layoutWidth, handleStart, containerHeight, heights]);

  // animated style for bottom nav: fade + translate + height collapse using measured height
  const bottomNavAnimatedStyle = useAnimatedStyle(() => {
    const v = navVisibility.value; // 1 -> shown
    const h = navContentHeight.value;
    return {
      opacity: v,
      transform: [{ translateY: (1 - v) * 12 }],
      height: h === 0 ? undefined : h * v,
      paddingTop: h === 0 ? 12 : 12 * v,
      paddingBottom: h === 0 ? 12 : 12 * v,
      marginTop: v === 0 ? 0 : undefined,
      overflow: 'hidden',
    };
  });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideUp.value }],
    opacity: sheetOpacity.value,
  }));

  const heightContainerStyle = useAnimatedStyle(() => ({
    width: '100%',
    height: heightAnim.value,
    overflow: 'hidden',
  }));

  const onPageLayout = useCallback(
    (index: number, h: number) => {
      if (!h) return;
      if (heights.value[index] === h) return;
      // Assign a fresh array rather than mutating the existing one in place:
      // the array is shared with the UI thread, and in-place mutation of a
      // value already passed to a worklet is unsupported.
      const next = heights.value.slice();
      next[index] = h;
      heights.value = next;
      if (index === 0 && !containerHeight) {
        setContainerHeight(h);
        heightAnim.value = h;
      }
      if (index === currentStep) setContainerHeight(h);
    },
    [currentStep, containerHeight, heightAnim, heights],
  );

  const onNavLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (navContentHeight.value === 0) {
        navContentHeight.value = e.nativeEvent.layout.height;
      }
    },
    [navContentHeight],
  );

  return (
    <Animated.View onLayout={onLayout} style={[styles.container, sheetStyle]}>
      {/* Progress Indicator */}
      <View style={styles.progressContainer}>
        {Array.from({ length: TOTAL_STEPS }).map((_, index) => (
          <ProgressDot
            key={index}
            index={index}
            scrollX={scrollX}
            layoutWidth={layoutWidth}
          />
        ))}
      </View>

      {/* Content: horizontal swipeable story (animated height per step) */}
      <Animated.View style={heightContainerStyle}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => {
            isScrollingRef.current = true;
          }}
          style={styles.content}
          contentContainerStyle={[
            styles.hScrollContainer,
            { width: layoutWidth * TOTAL_STEPS },
          ]}
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
        >
          {/* Step 1 — Identity */}
          <StoryPage
            index={0}
            scrollX={scrollX}
            layoutWidth={layoutWidth}
            onLayout={(e) => onPageLayout(0, e.nativeEvent.layout.height)}
          >
            <StepCard>
              <Text style={[styles.stepTitle, { fontSize: 34 }]}>
                Hi, welcome to Sindi!
              </Text>
              <Text style={styles.stepDescription}>
                Sindi is your AI ally for tenant rights.
              </Text>
              <Image
                source={require('@/assets/images/illustrations/welcome.png')}
                style={styles.heroImage}
              />
            </StepCard>
          </StoryPage>

          {/* Step 2 — The pain (dark) */}
          <StoryPage
            index={1}
            scrollX={scrollX}
            layoutWidth={layoutWidth}
            onLayout={(e) => onPageLayout(1, e.nativeEvent.layout.height)}
          >
            <StepCard>
              <Image
                source={require('@/assets/images/illustrations/sign-contract.png')}
                style={styles.heroImage}
              />
              <Text style={styles.stepTitle}>Renting can feel unfair.</Text>
              <Text style={styles.stepDescription}>
                Hidden clauses, confusing contracts, landlords with tricks…
              </Text>
            </StepCard>
          </StoryPage>

          {/* Step 3 — The promise */}
          <StoryPage
            index={2}
            scrollX={scrollX}
            layoutWidth={layoutWidth}
            onLayout={(e) => onPageLayout(2, e.nativeEvent.layout.height)}
          >
            <StepCard>
              <Image
                source={require('@/assets/images/illustrations/relax.png')}
                style={styles.heroImage}
              />
              <Text style={styles.stepTitle}>We’ve got your back.</Text>
              <Text style={styles.stepDescription}>
                We scan your contract, explain your rights, and spot abuses.
              </Text>
            </StepCard>
          </StoryPage>

          {/* Step 4 — The process */}
          <StoryPage
            index={3}
            scrollX={scrollX}
            layoutWidth={layoutWidth}
            onLayout={(e) => onPageLayout(3, e.nativeEvent.layout.height)}
          >
            <StepCard>
              <ProcessVisual />
            </StepCard>
          </StoryPage>

          {/* Step 5 — The invitation */}
          <StoryPage
            index={4}
            scrollX={scrollX}
            layoutWidth={layoutWidth}
            onLayout={(e) => onPageLayout(4, e.nativeEvent.layout.height)}
          >
            <StepCard>
              <Text style={styles.stepTitle}>Ready to stand stronger?</Text>
              <Text style={styles.stepDescription}>
                Start your first conversation with Sindi.
              </Text>
              <View style={styles.inviteButtons}>
                <Button onPress={handleStart}>Start with Sindi</Button>
                <Button
                  onPress={handlePrevious}
                  variant="ghost"
                  style={{ backgroundColor: 'transparent' }}
                  textStyle={{ color: APPLE_TEXT_SECONDARY }}
                >
                  Previous
                </Button>
              </View>
              {/* Confetti removed */}
            </StepCard>
          </StoryPage>
        </Animated.ScrollView>
      </Animated.View>
      {/* Bottom navigation */}
      <Animated.View
        style={[styles.bottomNav, bottomNavAnimatedStyle]}
        pointerEvents={currentStep === TOTAL_STEPS - 1 ? 'none' : 'auto'}
        onLayout={onNavLayout}
      >
        <Button
          onPress={currentStep === 0 ? handleSkip : handlePrevious}
          variant="secondary"
          style={{ flex: 1, backgroundColor: APPLE_CARD_BACKGROUND }}
          textStyle={{ color: APPLE_TEXT_PRIMARY }}
        >
          {currentStep === 0 ? 'Skip' : 'Previous'}
        </Button>
        <Button
          onPress={handleNext}
          style={{ flex: 1, backgroundColor: colors.primaryColor }}
          textStyle={{ color: '#fff' }}
        >
          {currentStep === TOTAL_STEPS - 1 ? 'Start' : 'Next'}
        </Button>
      </Animated.View>
    </Animated.View>
  );
}

interface ProgressDotProps {
  index: number;
  scrollX: ReturnType<typeof useSharedValue<number>>;
  layoutWidth: number;
}

function ProgressDot({ index, scrollX, layoutWidth }: ProgressDotProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * layoutWidth,
      index * layoutWidth,
      (index + 1) * layoutWidth,
    ];
    const width = interpolate(scrollX.value, inputRange, [8, 24, 8], 'clamp');
    const backgroundColor = interpolateColor(
      scrollX.value,
      inputRange,
      [MINIMAL_BORDER, colors.primaryColor, MINIMAL_BORDER],
    );
    return { width, backgroundColor };
  });

  return <Animated.View style={[styles.progressDot, animatedStyle]} />;
}

interface StoryPageProps {
  index: number;
  scrollX: ReturnType<typeof useSharedValue<number>>;
  layoutWidth: number;
  onLayout: (e: LayoutChangeEvent) => void;
  children: React.ReactNode;
}

function StoryPage({
  index,
  scrollX,
  layoutWidth,
  onLayout,
  children,
}: StoryPageProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * layoutWidth,
      index * layoutWidth,
      (index + 1) * layoutWidth,
    ];
    const opacity = interpolate(scrollX.value, inputRange, [0, 1, 0]);
    const translateX = interpolate(scrollX.value, inputRange, [40, 0, -40]);
    return { opacity, transform: [{ translateX }] };
  });

  return (
    <Animated.View
      style={[styles.page, { width: layoutWidth }, animatedStyle]}
      onLayout={onLayout}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    flex: 1,
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 2,
  },
  progressDot: {
    width: 4,
    height: 4,
    borderRadius: 4,
    backgroundColor: MINIMAL_BORDER,
    marginHorizontal: 1,
  },
  content: {
    paddingHorizontal: 0,
  },
  hScrollContainer: {
    paddingBottom: 20,
    flexDirection: 'row',
  },
  page: {
    paddingHorizontal: 0,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: APPLE_TEXT_PRIMARY,
    textAlign: 'center',
  },
  stepDescription: {
    fontSize: 16,
    color: APPLE_TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  darkTitle: { color: '#f9fafb' },
  darkDescription: { color: '#cbd5e1' },
  stepContent: {
    marginHorizontal: 20,
    paddingVertical: 28,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  stepContentDark: {
    backgroundColor: '#0f172a',
    borderRadius: 28,
    paddingVertical: 32,
    paddingHorizontal: 12,
  },
  processRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  processItem: {
    flex: 1,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
    borderRadius: 100,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 6,
  },
  processLabel: {
    fontSize: 13,
    color: APPLE_TEXT_PRIMARY,
    textAlign: 'center',
  },
  inviteButtons: {
    width: '100%',
    gap: 10,
    marginTop: 8,
    paddingHorizontal: 8,
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  navButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  prevButton: {
    backgroundColor: APPLE_CARD_BACKGROUND,
    borderWidth: 1,
    borderColor: MINIMAL_BORDER,
  },
  nextButton: {
    backgroundColor: colors.primaryColor,
  },
  navDisabled: {
    opacity: 0.6,
  },
  prevText: {
    fontSize: 16,
    color: APPLE_TEXT_PRIMARY,
    fontWeight: '600',
  },
  nextText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '700',
  },
  heroImage: {
    width: '100%',
    height: 150,
    resizeMode: 'contain',
  },
});

// Process visual with three pictograms
function ProcessVisual() {
  const scale1 = useSharedValue(0.8);
  const scale2 = useSharedValue(0.8);
  const scale3 = useSharedValue(0.8);

  useEffect(() => {
    scale1.value = withSpring(1, { damping: 10 });
    const t2 = setTimeout(() => {
      scale2.value = withSpring(1, { damping: 10 });
    }, 120);
    const t3 = setTimeout(() => {
      scale3.value = withSpring(1, { damping: 10 });
    }, 240);
    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [scale1, scale2, scale3]);

  const style1 = useAnimatedStyle(() => ({ transform: [{ scale: scale1.value }] }));
  const style2 = useAnimatedStyle(() => ({ transform: [{ scale: scale2.value }] }));
  const style3 = useAnimatedStyle(() => ({ transform: [{ scale: scale3.value }] }));

  return (
    <View style={{ width: '100%', gap: 12 }}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text style={styles.stepTitle}>How it works</Text>
      </View>
      <View style={styles.processRow}>
        <Animated.View style={[styles.processItem, style1]}>
          <Text style={{ fontSize: 34, lineHeight: 38 }}>📄</Text>
          <Text style={styles.processLabel}>Upload contract</Text>
        </Animated.View>
        <Animated.View style={[styles.processItem, style2]}>
          <Text style={{ fontSize: 34, lineHeight: 38 }}>💬</Text>
          <Text style={styles.processLabel}>Sindi explains</Text>
        </Animated.View>
        <Animated.View style={[styles.processItem, style3]}>
          <Text style={{ fontSize: 34, lineHeight: 38 }}>💪</Text>
          <Text style={styles.processLabel}>You act</Text>
        </Animated.View>
      </View>
    </View>
  );
}

// Plain step wrapper (card chrome removed)
function StepCard({
  children,
  dark,
  onLayout,
}: {
  children: React.ReactNode;
  dark?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const y = useSharedValue(10);
  const opacity = useSharedValue(0);

  useEffect(() => {
    y.value = withSpring(0, { damping: 12 });
    opacity.value = withTiming(1, { duration: 220 });
  }, [y, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: opacity.value,
    width: '100%',
  }));

  return (
    <Animated.View onLayout={onLayout} style={animatedStyle}>
      <View style={[styles.stepContent, dark && styles.stepContentDark]}>
        {children}
      </View>
    </Animated.View>
  );
}
