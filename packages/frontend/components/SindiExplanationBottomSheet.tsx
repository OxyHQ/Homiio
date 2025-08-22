import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, Animated, Easing, LayoutChangeEvent, NativeSyntheticEvent, NativeScrollEvent, Platform, UIManager, Image } from 'react-native';
import AnimatedRe, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import Button from '@/components/Button';

const IconComponent = Ionicons as any;

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
  const heightsRef = useRef<number[]>(Array(TOTAL_STEPS).fill(0));
  const navVisibility = useSharedValue(1); // 1 visible, 0 hidden
  const navContentHeight = useSharedValue(0); // measured height of nav for collapse

  const scrollX = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(40)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const heightAnim = useRef(new Animated.Value(0)).current;
  const isScrollingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  // Enable LayoutAnimation on Android
  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideUp, {
        toValue: 0,
        useNativeDriver: true,
        damping: 14,
        stiffness: 140,
        mass: 0.7,
      }),
      Animated.timing(sheetOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
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
    [layoutWidth]
  );

  const updateInterpolatedHeight = useCallback((offsetX: number) => {
    if (layoutWidth <= 0) return;
    const rawIndex = offsetX / layoutWidth;
    const base = Math.floor(rawIndex);
    const progress = rawIndex - base;
    const h1 = heightsRef.current[base];
    const h2 = heightsRef.current[Math.min(base + 1, TOTAL_STEPS - 1)];
    if (h1 && h2) {
      heightAnim.setValue(h1 + (h2 - h1) * progress);
    } else if (h1) {
      heightAnim.setValue(h1);
    }
  }, [layoutWidth, heightAnim]);

  const onScroll = useCallback((e: any) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    scrollX.setValue(offsetX);
    updateInterpolatedHeight(offsetX);
    if (layoutWidth > 0) {
      const nearest = Math.round(offsetX / layoutWidth);
      if (nearest !== currentStep && nearest >= 0 && nearest < TOTAL_STEPS) {
        setCurrentStep(nearest);
      }
    }
    // continuous nav visibility fade when approaching last step
    if (layoutWidth > 0) {
      const rawIndex = offsetX / layoutWidth;
      const fadeStart = TOTAL_STEPS - 2; // start fading on second-to-last step
      const progressToLast = rawIndex - fadeStart; // 0 -> begin fade
      if (progressToLast <= 0) {
        navVisibility.value = 1;
      } else {
        const v = 1 - Math.min(1, progressToLast); // linear fade over one step
        navVisibility.value = v;
      }
    }
  }, [scrollX, updateInterpolatedHeight, layoutWidth, currentStep, navVisibility]);

  // Animate container height when current step height updates outside active swipe
  useEffect(() => {
    if (isScrollingRef.current) return;
    if (!containerHeight) return;
    Animated.timing(heightAnim, {
      toValue: containerHeight,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [containerHeight, heightAnim]);

  // Reset cached heights when width changes (e.g., orientation)
  useEffect(() => {
    heightsRef.current = Array(TOTAL_STEPS).fill(0);
    setContainerHeight(0);
    heightAnim.setValue(0);
  }, [layoutWidth, heightAnim]);

  const handleScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / Math.max(1, layoutWidth));
      if (index !== currentStep) {
        setCurrentStep(index);
        const h = heightsRef.current[index] || containerHeight;
        setContainerHeight(h);
      }
      // ensure final snap animation to exact measured height
      const hFinal = heightsRef.current[index] || containerHeight;
      Animated.timing(heightAnim, {
        toValue: hFinal,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start(() => { isScrollingRef.current = false; });
    },
    [layoutWidth, currentStep, heightAnim, containerHeight]
  );

  const handlePrevious = useCallback(() => {
    if (!scrollRef.current) return;
    const target = Math.max(0, currentStep - 1);
    if (target !== currentStep) {
      setCurrentStep(target);
      const h = heightsRef.current[target] || containerHeight;
      setContainerHeight(h);
    }
    scrollRef.current.scrollTo({ x: target * layoutWidth, animated: true });
  }, [currentStep, layoutWidth, containerHeight]);

  const handleNext = useCallback(() => {
    if (currentStep >= TOTAL_STEPS - 1) {
      handleStart();
      return;
    }
    if (!scrollRef.current) return;
    const target = Math.min(TOTAL_STEPS - 1, currentStep + 1);
    if (target !== currentStep) {
      setCurrentStep(target);
      const h = heightsRef.current[target] || containerHeight;
      setContainerHeight(h);
    }
    scrollRef.current.scrollTo({ x: target * layoutWidth, animated: true });
  }, [currentStep, layoutWidth, handleStart, containerHeight]);

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

  const onPageLayout = useCallback((index: number, h: number) => {
    if (!h) return;
    if (heightsRef.current[index] === h) return;
    heightsRef.current[index] = h;
    if (index === 0 && !containerHeight) {
      setContainerHeight(h);
      heightAnim.setValue(h);
    }
    if (index === currentStep) setContainerHeight(h);
  }, [currentStep, containerHeight, heightAnim]);

  return (
    <Animated.View
      onLayout={onLayout}
      style={[
        styles.container,
        {
          transform: [{ translateY: slideUp }],
          opacity: sheetOpacity,
        },
      ]}
    >
      {/* Progress Indicator */}
      <View style={styles.progressContainer}>
        {Array.from({ length: TOTAL_STEPS }).map((_, index) => {
          const inputRange = [
            (index - 1) * layoutWidth,
            index * layoutWidth,
            (index + 1) * layoutWidth,
          ];
          const w = scrollX.interpolate({
            inputRange,
            outputRange: [8, 24, 8],
            extrapolate: 'clamp',
          });
          const bg = scrollX.interpolate({
            inputRange,
            outputRange: [MINIMAL_BORDER, colors.primaryColor, MINIMAL_BORDER],
            extrapolate: 'clamp',
          });
          return <Animated.View key={index} style={[styles.progressDot, { width: w, backgroundColor: bg }]} />;
        })}
      </View>

      {/* Content: horizontal swipeable story (animated height per step) */}
      <Animated.View style={{ width: '100%', height: heightAnim, overflow: 'hidden' }}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => { isScrollingRef.current = true; }}
          style={styles.content}
          contentContainerStyle={[styles.hScrollContainer, { width: layoutWidth * TOTAL_STEPS }]}
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
        >
          {/* Step 1 — Identity */}
          <Animated.View
            style={[
              styles.page,
              { width: layoutWidth },
              {
                opacity: scrollX.interpolate({
                  inputRange: [-1 * layoutWidth, 0 * layoutWidth, 1 * layoutWidth],
                  outputRange: [0, 1, 0],
                }),
                transform: [
                  {
                    translateX: scrollX.interpolate({
                      inputRange: [-1 * layoutWidth, 0 * layoutWidth, 1 * layoutWidth],
                      outputRange: [40, 0, -40],
                    }),
                  },
                ],
              },
            ]}
            onLayout={(e) => onPageLayout(0, e.nativeEvent.layout.height)}
          >
            <StepCard>
              <Text style={[styles.stepTitle, { fontSize: 34 }]}>Hi, welcome to Sindi!</Text>
              <Text style={styles.stepDescription}>Sindi is your AI ally for tenant rights.</Text>
              <Image source={require('@/assets/images/illustrations/welcome.png')} style={styles.heroImage} />
            </StepCard>
          </Animated.View>

          {/* Step 2 — The pain (dark) */}
          <Animated.View
            style={[
              styles.page,
              { width: layoutWidth },
              {
                opacity: scrollX.interpolate({
                  inputRange: [0 * layoutWidth, 1 * layoutWidth, 2 * layoutWidth],
                  outputRange: [0, 1, 0],
                }),
                transform: [
                  {
                    translateX: scrollX.interpolate({
                      inputRange: [0 * layoutWidth, 1 * layoutWidth, 2 * layoutWidth],
                      outputRange: [40, 0, -40],
                    }),
                  },
                ],
              },
            ]}
            onLayout={(e) => onPageLayout(1, e.nativeEvent.layout.height)}
          >
            <StepCard>
              <Image source={require('@/assets/images/illustrations/sign-contract.png')} style={styles.heroImage} />
              <Text style={styles.stepTitle}>Renting can feel unfair.</Text>
              <Text style={styles.stepDescription}>
                Hidden clauses, confusing contracts, landlords with tricks…
              </Text>
            </StepCard>
          </Animated.View>

          {/* Step 3 — The promise */}
          <Animated.View
            style={[
              styles.page,
              { width: layoutWidth },
              {
                opacity: scrollX.interpolate({
                  inputRange: [1 * layoutWidth, 2 * layoutWidth, 3 * layoutWidth],
                  outputRange: [0, 1, 0],
                }),
                transform: [
                  {
                    translateX: scrollX.interpolate({
                      inputRange: [1 * layoutWidth, 2 * layoutWidth, 3 * layoutWidth],
                      outputRange: [40, 0, -40],
                    }),
                  },
                ],
              },
            ]}
            onLayout={(e) => onPageLayout(2, e.nativeEvent.layout.height)}
          >
            <StepCard>
              <Image source={require('@/assets/images/illustrations/relax.png')} style={styles.heroImage} />
              <Text style={styles.stepTitle}>We’ve got your back.</Text>
              <Text style={styles.stepDescription}>
                We scan your contract, explain your rights, and spot abuses.
              </Text>
            </StepCard>
          </Animated.View>

          {/* Step 4 — The process */}
          <Animated.View
            style={[
              styles.page,
              { width: layoutWidth },
              {
                opacity: scrollX.interpolate({
                  inputRange: [2 * layoutWidth, 3 * layoutWidth, 4 * layoutWidth],
                  outputRange: [0, 1, 0],
                }),
                transform: [
                  {
                    translateX: scrollX.interpolate({
                      inputRange: [2 * layoutWidth, 3 * layoutWidth, 4 * layoutWidth],
                      outputRange: [40, 0, -40],
                    }),
                  },
                ],
              },
            ]}
            onLayout={(e) => onPageLayout(3, e.nativeEvent.layout.height)}
          >
            <StepCard>
              <ProcessVisual />
            </StepCard>
          </Animated.View>

          {/* Step 5 — The invitation */}
          <Animated.View
            style={[
              styles.page,
              { width: layoutWidth },
              {
                opacity: scrollX.interpolate({
                  inputRange: [3 * layoutWidth, 4 * layoutWidth, 5 * layoutWidth],
                  outputRange: [0, 1, 0],
                }),
                transform: [
                  {
                    translateX: scrollX.interpolate({
                      inputRange: [3 * layoutWidth, 4 * layoutWidth, 5 * layoutWidth],
                      outputRange: [40, 0, -40],
                    }),
                  },
                ],
              },
            ]}
            onLayout={(e) => onPageLayout(4, e.nativeEvent.layout.height)}
          >
            <StepCard>
              <Text style={styles.stepTitle}>Ready to stand stronger?</Text>
              <Text style={styles.stepDescription}>Start your first conversation with Sindi.</Text>
              <View style={styles.inviteButtons}>
                <Button onPress={handleStart}>
                  Start with Sindi
                </Button>
                <Button onPress={handlePrevious} backgroundColor="transparent" textColor={APPLE_TEXT_SECONDARY}>
                  Previous
                </Button>
              </View>
              {/* Confetti removed */}
            </StepCard>
          </Animated.View>
        </Animated.ScrollView>
      </Animated.View>
      {/* Bottom navigation */}
      <AnimatedRe.View
        style={[styles.bottomNav, bottomNavAnimatedStyle]}
        pointerEvents={currentStep === TOTAL_STEPS - 1 ? 'none' : 'auto'}
        onLayout={(e) => {
          if (navContentHeight.value === 0) {
            navContentHeight.value = e.nativeEvent.layout.height;
          }
        }}
      >
        <Button
          onPress={currentStep === 0 ? handleSkip : handlePrevious}
          backgroundColor={APPLE_CARD_BACKGROUND}
          textColor={APPLE_TEXT_PRIMARY}
          style={{ flex: 1 }}
        >
          {currentStep === 0 ? 'Skip' : 'Previous'}
        </Button>
        <Button
          onPress={handleNext}
          backgroundColor={colors.primaryColor}
          textColor={'#fff'}
          style={{ flex: 1 }}
        >
          {currentStep === TOTAL_STEPS - 1 ? 'Start' : 'Next'}
        </Button>
      </AnimatedRe.View>
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
    fontFamily: 'Phudu',
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
    fontFamily: 'Phudu',
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
  const scale1 = useRef(new Animated.Value(0.8)).current;
  const scale2 = useRef(new Animated.Value(0.8)).current;
  const scale3 = useRef(new Animated.Value(0.8)).current;
  useEffect(() => {
    Animated.stagger(
      120,
      [scale1, scale2, scale3].map((s) =>
        Animated.spring(s, { toValue: 1, useNativeDriver: true, damping: 10 })
      )
    ).start();
  }, [scale1, scale2, scale3]);
  return (
    <View style={{ width: '100%', gap: 12, }}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text style={styles.stepTitle}>How it works</Text>
      </View>
      <View style={styles.processRow}>
        <Animated.View style={[styles.processItem, { transform: [{ scale: scale1 }] }]}>
          <Text style={{ fontSize: 34, lineHeight: 38 }}>📄</Text>
          <Text style={styles.processLabel}>Upload contract</Text>
        </Animated.View>
        <Animated.View style={[styles.processItem, { transform: [{ scale: scale2 }] }]}>
          <Text style={{ fontSize: 34, lineHeight: 38 }}>💬</Text>
          <Text style={styles.processLabel}>Sindi explains</Text>
        </Animated.View>
        <Animated.View style={[styles.processItem, { transform: [{ scale: scale3 }] }]}>
          <Text style={{ fontSize: 34, lineHeight: 38 }}>💪</Text>
          <Text style={styles.processLabel}>You act</Text>
        </Animated.View>
      </View>
    </View>
  );
}

// Plain step wrapper (card chrome removed)
function StepCard({ children, dark, onLayout }: { children: React.ReactNode; dark?: boolean; onLayout?: (e: LayoutChangeEvent) => void }) {
  const y = useRef(new Animated.Value(10)).current;
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 12 }),
      Animated.timing(o, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [y, o]);
  return (
    <Animated.View
      onLayout={onLayout}
      style={{ transform: [{ translateY: y }], opacity: o, width: '100%' }}
    >
      <View style={[styles.stepContent, dark && styles.stepContentDark]}>{children}</View>
    </Animated.View>
  );
}