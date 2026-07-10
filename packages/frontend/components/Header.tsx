import React, { useEffect, ReactNode } from 'react';
import { StyleSheet, View, ViewStyle, Platform, Pressable } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
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
  style?: ViewStyle;
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

  return (
    <View
      style={[
        styles.topRow,
        { minHeight: 60 + insets.top },
        Platform.OS === 'web' ? { top: framed ? PANEL_TOP_INSET : 0 } : null,
      ]}
    >
      {/* Animated Background */}
      <Animated.View
        style={[
          styles.backgroundOverlay,
          {
            backgroundColor: colors.primaryLight,
            borderBottomWidth: 0.01,
            borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
          },
          backgroundStyle,
        ]}
      />

      {/* Header Content - Always Visible */}
      <View style={[styles.contentContainer, { paddingTop: insets.top }]}>
        <View style={styles.leftContainer}>
          {options?.showBackButton && canGoBack && (
            <Pressable onPress={() => router.back()} style={styles.backButton}>
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
                    options?.subtitle ? { fontSize: 14 } : null,
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
          <View style={styles.centerContainer}>
            {options?.title ? (
              <ThemedText
                style={[
                  styles.topRowText,
                  options?.subtitle ? { fontSize: 14 } : null,
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
        <View style={styles.rightContainer}>
          {options?.rightComponents?.map((component, index) => (
            <React.Fragment key={index}>{component}</React.Fragment>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingBottom: 10,
  },
  topRow: {
    ...Platform.select({
      web: {
        position: 'sticky',
        top: 0,
        zIndex: 1000,
      },
      default: {
        position: 'relative',
        zIndex: 100,
      },
    }),
  } as ViewStyle,
  backgroundOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    ...Platform.select({
      web: {
        backdropFilter: 'blur(10px)',
      },
    }),
  },
  contentContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingTop: Platform.select({
      web: 5,
      default: 12,
    }),
    paddingBottom: Platform.select({
      web: 5,
      default: 4,
    }),
    position: 'relative',
    elevation: 5,
    ...Platform.select({
      web: {
        minHeight: 60,
      },
    }),
  },
  topRowText: {
    fontSize: 20,
    color: colors.COLOR_BLACK,
    fontWeight: '800',
    paddingStart: 1,
  },
  subtitleText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '400',
  },
  startContainer: {
    borderRadius: 100,
    padding: 10,
  },
  backButton: {
    marginRight: 10,
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    gap: 10,
  },
  stickyHeader: {
    borderTopEndRadius: 0,
    borderTopStartRadius: 0,
  },
});
