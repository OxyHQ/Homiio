import React, { useEffect, ReactNode } from 'react';
import { View, Platform, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';
import { colors } from '@/styles/colors';
import { colorChannels } from '@/styles/shadows';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PANEL_TOP_INSET } from '@oxyhq/bloom/content-panel';
import { ThemedText } from './ThemedText';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';

/**
 * Header drop shadow, expressed as an animated `boxShadow`: the blur/offset are
 * fixed and the alpha is interpolated with scroll (see `backgroundStyle`). The
 * `"r, g, b"` channels are derived from the theme color once so the worklet only
 * has to interpolate the alpha — no hardcoded color literal.
 */
const HEADER_SHADOW_CHANNELS = colorChannels(colors.COLOR_BLACK);
const HEADER_SHADOW_OFFSET_Y = 2;
const HEADER_SHADOW_BLUR = 3;
/** Resting shadow alpha when the header background is fully shown. */
const HEADER_SHADOW_MAX_OPACITY = 0.1;

interface Props {
  options?: {
    title?: string;
    titlePosition?: 'left' | 'center';
    subtitle?: string;
    showBackButton?: boolean;
    leftComponents?: ReactNode[];
    rightComponents?: ReactNode[];
    transparent?: boolean;
    scrollThreshold?: number;
  };
  scrollY?: SharedValue<number>;
}

export const Header: React.FC<Props> = ({ options, scrollY: externalScrollY }) => {
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  // Derived directly from the router rather than synced via an effect — this is
  // a pure read of navigation state and avoids cascading renders.
  const canGoBack = router.canGoBack();
  const insets = useSafeAreaInsets();
  const isScreenNotMobile = useIsScreenNotMobile();
  const internalScrollY = useSharedValue(0);
  const scrollY = externalScrollY ?? internalScrollY;

  // On web the DOCUMENT is the scroll owner and the shell frames content in a
  // rounded `ContentPanel` at `PANEL_TOP_INSET` (8px) on wide screens, so a
  // sticky header must pin at that inset (not top:0, where the panel's bleed
  // mask would clip it); it pins flush on narrow/full-bleed web.
  const framed = Platform.OS === 'web' && isScreenNotMobile;

  const titlePosition = options?.titlePosition || 'left';
  const isTransparent = options?.transparent || false;
  const scrollThreshold = options?.scrollThreshold || 20;

  useEffect(() => {
    if (Platform.OS !== 'web' || externalScrollY) return;
    const handleScroll = () => {
      scrollY.value = window.scrollY;
    };
    handleScroll();
    document.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      document.removeEventListener('scroll', handleScroll);
    };
  }, [scrollY, externalScrollY]);

  const backgroundStyle = useAnimatedStyle(() => {
    if (!isTransparent) {
      return {
        opacity: 1,
        boxShadow: `0px ${HEADER_SHADOW_OFFSET_Y}px ${HEADER_SHADOW_BLUR}px rgba(${HEADER_SHADOW_CHANNELS}, ${HEADER_SHADOW_MAX_OPACITY})`,
        elevation: 3,
      };
    }
    const progress = interpolate(
      scrollY.value,
      [0, scrollThreshold],
      [0, 1],
      'clamp',
    );
    const shadowAlpha = interpolate(
      scrollY.value,
      [0, scrollThreshold],
      [0, HEADER_SHADOW_MAX_OPACITY],
      'clamp',
    );
    return {
      opacity: progress,
      boxShadow: `0px ${HEADER_SHADOW_OFFSET_Y}px ${HEADER_SHADOW_BLUR}px rgba(${HEADER_SHADOW_CHANNELS}, ${shadowAlpha})`,
      elevation: interpolate(
        scrollY.value,
        [0, scrollThreshold],
        [0, 3],
        'clamp',
      ),
    };
  });

  // Sticky / relative chrome + dynamic inset height stay as style= (web sticky
  // + PANEL_TOP_INSET / safe-area are numeric and platform-split).
  const topRowStyle = {
    minHeight: 60 + insets.top,
    ...Platform.select({
      web: {
        position: 'sticky',
        top: framed ? PANEL_TOP_INSET : 0,
        zIndex: 1000,
      },
      default: {
        position: 'relative',
        zIndex: 100,
      },
    }),
  } as ViewStyle;

  return (
    <View style={topRowStyle}>
      {/* Animated Background */}
      <Animated.View
        className="absolute inset-0"
        style={[
          {
            // Match ContentPanel `bg-card` — not page `background` / pure white.
            backgroundColor: themeColors.card,
            borderBottomWidth: 0.01,
            borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
            ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)' } : null),
          },
          backgroundStyle,
        ]}
      />

      {/* Header Content - Always Visible */}
      <View
        className={
          Platform.OS === 'web'
            ? 'relative min-h-[60px] flex-1 flex-row items-center justify-between px-[15px] pb-[5px]'
            : 'relative flex-1 flex-row items-center justify-between px-[15px] pb-1'
        }
        style={{ paddingTop: insets.top + (Platform.OS === 'web' ? 5 : 12) }}
      >
        <View className="flex-1 flex-row items-center gap-2.5">
          {options?.showBackButton && canGoBack && (
            <Pressable onPress={() => router.back()} className="mr-2.5">
              <Ionicons name="arrow-back" size={24} color={colors.COLOR_BLACK} />
            </Pressable>
          )}
          {options?.leftComponents?.map((component, index) => (
            <React.Fragment key={index}>{component}</React.Fragment>
          ))}
          {titlePosition === 'left' && (
            <View>
              {options?.title ? (
                <ThemedText
                  style={[
                    styles.topRowText,
                    options?.subtitle ? styles.topRowTextWithSubtitle : null,
                  ]}
                >
                  {options.title}
                </ThemedText>
              ) : null}
              {options?.subtitle ? (
                <ThemedText style={styles.subtitleText}>{options.subtitle}</ThemedText>
              ) : null}
            </View>
          )}
        </View>
        {titlePosition === 'center' && (
          <View className="flex-1 items-center">
            {options?.title ? (
              <ThemedText
                style={[
                  styles.topRowText,
                  options?.subtitle ? styles.topRowTextWithSubtitle : null,
                ]}
              >
                {options.title}
              </ThemedText>
            ) : null}
            {options?.subtitle ? (
              <ThemedText style={styles.subtitleText}>{options.subtitle}</ThemedText>
            ) : null}
          </View>
        )}
        <View className="flex-1 flex-row items-center justify-end gap-2.5">
          {options?.rightComponents?.map((component, index) => (
            <React.Fragment key={index}>{component}</React.Fragment>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  topRowText: {
    paddingLeft: 1,
    fontSize: 20,
    color: colors.COLOR_BLACK,
    fontWeight: '800',
  },
  topRowTextWithSubtitle: {
    fontSize: 14,
  },
  subtitleText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '400',
  },
});
