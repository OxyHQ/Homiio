import React, { useEffect, useMemo, useRef, useState, memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AccessibilityRole, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SindiIcon } from '@/assets/icons';
import { colors } from '@/styles/colors';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';

export interface SindiHeroProps {
  title: string;
  subtitle: string;
  onNewConversation: () => void;
  onSearchHomes: () => void;
  /** Static placeholder string shown when not animating */
  placeholder?: string;
  /** Optional list of rotating suggestion prompts */
  rotatingSuggestions?: string[];
  /** Milliseconds each suggestion stays fully visible */
  rotateInterval?: number;
  /** Called when user taps the suggestion chip */
  onSuggestionSelect?: (prompt: string) => void;
  /** Disable width animation (e.g. reduced motion) */
  reduceMotion?: boolean;
}

// Animated rotating suggestion text (crossfade + upward slide) -------------
const RotatingSuggestions: React.FC<{ current: string; next: string; anim: any }> = ({ current, next, anim }) => {
  const currentStyle = useAnimatedStyle(() => ({
    opacity: 1 - anim.value,
    transform: [
      { translateY: -6 * anim.value }, // slide current upward as it fades out
    ],
  }));
  const nextStyle = useAnimatedStyle(() => ({
    opacity: anim.value,
    transform: [
      { translateY: 6 * (1 - anim.value) }, // next starts slightly below then settles
    ],
  }));
  return (
    <View style={styles.suggestionViewport} accessibilityRole={'text' as AccessibilityRole}>
      <Animated.Text numberOfLines={1} style={[styles.heroPromptPlaceholder, styles.absoluteFill, currentStyle]}>{current}</Animated.Text>
      <Animated.Text numberOfLines={1} style={[styles.heroPromptPlaceholder, styles.absoluteFill, nextStyle]}>{next}</Animated.Text>
    </View>
  );
};

const SindiHeroComponent: React.FC<SindiHeroProps> = ({
  title,
  subtitle,
  onNewConversation,
  onSearchHomes,
  placeholder = 'Ask about rent limits, deposits, or your rights...',
  rotatingSuggestions = [],
  rotateInterval = 4000,
  onSuggestionSelect,
  reduceMotion = false,
}) => {
  const suggestionsEnabled = rotatingSuggestions.length > 0;
  // Simpler: fixed width based on longest text length heuristic
  const longest = useMemo(() => {
    const arr = suggestionsEnabled ? rotatingSuggestions : [placeholder];
    return arr.reduce((a, b) => (b.length > a.length ? b : a), placeholder);
  }, [suggestionsEnabled, rotatingSuggestions, placeholder]);
  const chipWidthPx = Math.min(340, Math.max(200, longest.length * 7.2 + 70));
  const [index, setIndex] = useState(0);
  const fade = useSharedValue(0); // 0 = showing current, 1 = transition to next
  const transitionDuration = 650;
  const cycleRef = useRef<NodeJS.Timeout | null>(null);
  const chipChange = useSharedValue(0); // animates whole chip per suggestion change

  const currentSuggestion = useMemo(() => (
    suggestionsEnabled ? rotatingSuggestions[index] : placeholder
  ), [suggestionsEnabled, rotatingSuggestions, index, placeholder]);

  const nextSuggestion = useMemo(() => (
    suggestionsEnabled ? rotatingSuggestions[(index + 1) % rotatingSuggestions.length] : placeholder
  ), [suggestionsEnabled, rotatingSuggestions, index, placeholder]);

  const advance = useCallback(() => {
    if (!suggestionsEnabled) return;
    const nextIndex = (index + 1) % rotatingSuggestions.length;
    fade.value = 0;
    chipChange.value = 0;
    // Pre-kick chip animation
    chipChange.value = withTiming(1, { duration: transitionDuration, easing: Easing.out(Easing.cubic) });
    fade.value = withTiming(1, { duration: transitionDuration, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) {
        runOnJS(setIndex)(nextIndex);
        fade.value = 0; // reset for next cycle
        chipChange.value = 0; // reset for next cycle ready
      }
    });
  }, [suggestionsEnabled, index, rotatingSuggestions, fade, transitionDuration, chipChange]);

  useEffect(() => {
    if (!suggestionsEnabled) return;
    cycleRef.current = setInterval(() => { advance(); }, rotateInterval);
    return () => { if (cycleRef.current) clearInterval(cycleRef.current); };
  }, [suggestionsEnabled, rotateInterval, advance]);

  // Removed measurement logic for simplicity

  // Icon breathing / glow animation
  const glow = useSharedValue(0);
  useEffect(() => {
    glow.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [glow]);
  const glowStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + 0.04 * Math.sin(glow.value * Math.PI) },
    ],
    opacity: 0.7 + 0.3 * Math.sin(glow.value * Math.PI),
  }));

  const iconPulse = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + 0.03 * Math.sin(glow.value * Math.PI) },
    ],
  }));

  // Prompt chip glow animation (decoupled so timing can differ later)
  const chipGlow = useSharedValue(0);
  useEffect(() => {
    chipGlow.value = withRepeat(withTiming(1, { duration: 3800, easing: Easing.inOut(Easing.cubic) }), -1, true);
  }, [chipGlow]);
  // Independent slow rotation for aura (rotate up effect)
  const glowSpin = useSharedValue(0);
  useEffect(() => {
    glowSpin.value = withRepeat(withTiming(1, { duration: 8000, easing: Easing.linear }), -1, false);
  }, [glowSpin]);
  const chipGlowStyle = useAnimatedStyle(() => {
    const wave = Math.sin(chipGlow.value * Math.PI);
    return {
      shadowOpacity: 0.15 + 0.15 * wave,
      shadowRadius: 8 + 6 * wave,
      shadowColor: colors.primaryColor,
      transform: [
        { scale: 1 + 0.004 * wave },
      ],
      // Web-specific boxShadow (ignored on native)
      ...(Platform.OS === 'web' ? { boxShadow: `0 0 ${12 + 8 * wave}px rgba(0,0,0,0.08), 0 0 ${18 + 10 * wave}px rgba(37,99,235,${0.25 + 0.2 * wave})` } : {}),
    };
  });
  // Outer aura (soft expanding radial glow)
  const chipAuraStyle = useAnimatedStyle(() => {
    const wave = (Math.sin(chipGlow.value * Math.PI) + 1) / 2; // 0..1
    const rotate = glowSpin.value * 2 * Math.PI; // radians
    return {
      opacity: 0.25 + 0.25 * wave,
      transform: [
        { scale: 1.05 + 0.08 * wave },
        { rotate: `${rotate}rad` }, // slow continuous rotation
        { translateY: -2 * wave }, // subtle upward drift (slide up feel)
      ],
      backgroundColor: `rgba(37,99,235,${0.25 + 0.15 * wave})`,
    };
  });
  // Inner highlight sheen sweeping subtly
  const chipSheenStyle = useAnimatedStyle(() => {
    const wave = chipGlow.value % 1; // 0..1 loop
    const translate = (wave - 0.5) * 40; // -20..20
    return {
      opacity: 0.15,
      transform: [{ translateX: translate }],
    };
  });
  const chipChangeStyle = useAnimatedStyle(() => {
    const v = chipChange.value; // 0 ->1
    const easing = v < 0.5 ? v * 2 : 1 - (v - 0.5) * 2;
    return {
      transform: [
        { translateY: -2 * easing },
        { scale: 1 + 0.015 * easing },
      ],
      opacity: 0.97 + 0.03 * easing,
    };
  });
  const chipWidthStyle = { width: chipWidthPx } as const;
  const chipInnerGlowStyle = useAnimatedStyle(() => {
    const wave = Math.sin(chipGlow.value * Math.PI);
    return {
      opacity: 0.25 + 0.25 * wave,
      transform: [{ scale: 0.96 + 0.02 * wave }],
    };
  });

  return (
    <LinearGradient
      colors={[colors.primaryColor, colors.secondaryLight, colors.primaryLight]}
      locations={[0, 0.85, 1]}
      style={styles.heroSection}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <View style={styles.heroDecorLayer} pointerEvents="none" />
      <View style={styles.heroDecorBlur} pointerEvents="none" />
      <View style={styles.heroContent}>
        <Animated.View style={[styles.heroIconWrapper, iconPulse]}>
          <Animated.View style={[styles.heroIconGlow, glowStyle]} />
          <View style={styles.heroIconCircle}>
            <SindiIcon size={54} color={colors.secondaryColor} />
          </View>
        </Animated.View>
        <Text accessibilityRole={'header' as AccessibilityRole} style={styles.heroTitle}>{title}</Text>
        <Text accessibilityRole={'text' as AccessibilityRole} style={styles.heroSubtitle}>{subtitle}</Text>
        <View style={styles.heroBadgesRow}>
          <View style={styles.heroBadge}><Ionicons name="shield-checkmark" size={13} color={colors.primaryColor} /><Text style={styles.heroBadgeText}>Rights</Text></View>
          <View style={styles.heroBadge}><Ionicons name="home" size={13} color={colors.primaryColor} /><Text style={styles.heroBadgeText}>Housing</Text></View>
          <View style={styles.heroBadge}><Ionicons name="document-text" size={13} color={colors.primaryColor} /><Text style={styles.heroBadgeText}>Legal</Text></View>
        </View>
        <View style={styles.heroCTARow}>
          <TouchableOpacity
            accessibilityRole={'button'}
            accessibilityLabel="Start a new chat"
            style={styles.heroPrimaryBtn}
            activeOpacity={0.85}
            onPress={onNewConversation}
          >
            <Ionicons name="add" size={16} color="white" />
            <Text style={styles.heroPrimaryBtnText}>New Chat</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole={'button'}
            accessibilityLabel="Search homes"
            style={styles.heroSecondaryBtn}
            activeOpacity={0.85}
            onPress={onSearchHomes}
          >
            <Ionicons name="search" size={16} color={colors.primaryColor} />
            <Text style={styles.heroSecondaryBtnText}>Search Homes</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onSuggestionSelect && onSuggestionSelect(currentSuggestion)}
          accessibilityRole={'button'}
          accessibilityLabel={`Use suggestion: ${currentSuggestion}`}
        >
          <Animated.View style={[styles.heroPromptBarWrapper, chipGlowStyle, chipChangeStyle, chipWidthStyle]}>
            <Animated.View pointerEvents="none" style={[styles.chipAura, chipAuraStyle]} />
            <Animated.View pointerEvents="none" style={[styles.heroPromptBarGlow, chipInnerGlowStyle]} />
            <LinearGradient
              colors={['rgba(255,255,255,0.95)', 'rgba(255,255,255,0.80)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroPromptGradient}
            >
              <View style={styles.heroPromptBarContent}>
                <Ionicons name="sparkles" size={14} color={colors.primaryColor} />
                {suggestionsEnabled ? (
                  <RotatingSuggestions current={currentSuggestion} next={nextSuggestion} anim={fade} />
                ) : (
                  <Text numberOfLines={1} style={styles.heroPromptPlaceholder}>{currentSuggestion}</Text>
                )}
                <Animated.View pointerEvents="none" style={[styles.chipSheen, chipSheenStyle]} />
              </View>
            </LinearGradient>
          </Animated.View>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
};

export const SindiHero = memo(SindiHeroComponent);
SindiHero.displayName = 'SindiHero';

// Styles extracted from the original page (kept local to avoid duplication) ----
const styles = StyleSheet.create({
  heroSection: {
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    marginBottom: 16,
    marginHorizontal: -12,
    alignSelf: 'stretch',
    borderRadius: 0,
    overflow: 'hidden',
  },
  heroContent: {
    width: '100%',
    alignItems: 'center',
    maxWidth: 720,
  },
  heroIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    fontFamily: 'Phudu',
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    maxWidth: 520,
    lineHeight: 22,
    marginBottom: 18,
  },
  heroBadgesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
  },
  heroBadgeText: {
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryColor,
  },
  heroDecorLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.15,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  heroDecorBlur: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    top: -40,
    right: -60,
    backgroundColor: 'rgba(255,255,255,0.25)',
    opacity: 0.35,
  },
  heroIconWrapper: {
    marginBottom: 16,
  },
  heroIconGlow: {
    position: 'absolute',
    top: -15,
    left: -15,
    right: -15,
    bottom: -15,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  suggestionViewport: {
    flex: 1,
    height: 16,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  absoluteFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  heroCTARow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    marginBottom: 14,
  },
  heroPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  heroPrimaryBtnText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  heroSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 26,
  },
  heroSecondaryBtnText: {
    color: colors.primaryColor,
    fontSize: 13,
    fontWeight: '600',
  },
  heroPromptBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'stretch',
    marginTop: 4,
    gap: 8,
  },
  heroPromptBarWrapper: {
    alignSelf: 'center',
    marginTop: 4,
    borderRadius: 24,
    position: 'relative',
    shadowColor: colors.primaryColor,
  },
  heroPromptBarGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    backgroundColor: colors.primaryLight,
    filter: Platform.OS === 'web' ? 'blur(14px)' as any : undefined,
  },
  heroPromptGradient: {
    borderRadius: 24,
    paddingHorizontal: 0,
  },
  chipAura: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    filter: Platform.OS === 'web' ? 'blur(20px)' as any : undefined,
  },
  heroPromptBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    // Ensure text doesn't stretch chip taller
    minHeight: 36,
  },
  chipSheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.9)',
    opacity: 0.12,
    borderRadius: 24,
    filter: Platform.OS === 'web' ? 'blur(12px)' as any : undefined,
  },
  heroPromptPlaceholder: {
    flex: 1,
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    paddingRight: 4,
  },
});

export default SindiHero;
