import React, { useEffect, useState, ReactNode } from 'react';
import { View, Platform, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';
import { colorChannels } from '@/styles/shadows';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PANEL_TOP_INSET } from '@oxyhq/bloom/content-panel';
import { barBackIconSize, barContent, barIconButton, barIconButtonPressed, spacing } from '@/constants/styles';
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
  const [backPressed, setBackPressed] = useState(false);

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

  // Title + optional subtitle, via Bloom `Text`. Shared by the left and center
  // title positions; each line truncates so a long title never shoves the
  // actions off-screen (the enclosing block is `flex:1, minWidth:0`).
  const titleNode = (
    <>
      {options?.title ? (
        <BloomText
          numberOfLines={1}
          className={
            options?.subtitle
              ? 'text-sm font-extrabold text-foreground'
              : 'text-xl font-extrabold text-foreground'
          }
        >
          {options.title}
        </BloomText>
      ) : null}
      {options?.subtitle ? (
        <BloomText numberOfLines={1} className="text-sm font-normal text-muted-foreground">
          {options.subtitle}
        </BloomText>
      ) : null}
    </>
  );

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

      {/* Header Content — clamped + centered (the "gold" bar recipe). The
          background above spans full width; this row aligns to
          `contentClamp.page` so titles/actions line up on wide web. */}
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + (Platform.OS === 'web' ? spacing.xs : spacing.md) },
        ]}
      >
        <View style={styles.leftSlot}>
          {options?.showBackButton && canGoBack && (
            <Pressable
              onPress={() => router.back()}
              onPressIn={() => setBackPressed(true)}
              onPressOut={() => setBackPressed(false)}
              accessibilityRole="button"
              style={[barIconButton, backPressed && barIconButtonPressed]}
            >
              <Ionicons name="arrow-back" size={barBackIconSize} color={colors.COLOR_BLACK} />
            </Pressable>
          )}
          {options?.leftComponents?.map((component, index) => (
            <React.Fragment key={index}>{component}</React.Fragment>
          ))}
          {titlePosition === 'left' && (
            <View style={styles.titleBlock}>{titleNode}</View>
          )}
        </View>
        {titlePosition === 'center' && (
          <View style={styles.centerSlot}>{titleNode}</View>
        )}
        <View style={styles.rightSlot}>
          {options?.rightComponents?.map((component, index) => (
            <React.Fragment key={index}>{component}</React.Fragment>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Clamped, centered content row — the shared bar layout. `minHeight` keeps the
  // bar tall enough for the circular icon buttons.
  content: {
    ...barContent,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  leftSlot: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  centerSlot: {
    flex: 1,
    alignItems: 'center',
  },
  rightSlot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  // Truncating title/subtitle block — `flex:1, minWidth:0` lets a long title
  // ellipsize inside the row instead of pushing the actions off-screen.
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
});
