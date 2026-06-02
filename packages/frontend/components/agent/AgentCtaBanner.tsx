/**
 * AgentCtaBanner — full-bleed "become an agent" closing banner.
 *
 * Reuses the `HostCtaBanner` visual language (full-width photo, bottom-left
 * gradient scrim, 2-line headline + one-liner + Bloom Button overlaid on the
 * image) and adds a small trust line beneath the button ("No license needed.
 * Work from your phone."). Used both as the final beat on the `/agent` screen
 * and as an extra section on the home page alongside the host CTA.
 *
 * Like `HostCtaBanner`, the banner itself is NOT pressable — only the Bloom
 * Button is the tap target — so web never renders a nested `<button>`.
 */
import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMediaQuery } from 'react-responsive';

import { Button } from '@oxyhq/bloom/button';
import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import {
  BANNER_FILL_MIN_HEIGHT,
  cardShadow,
  radius,
  resolvePagePadding,
  spacing,
  tracker,
} from '@/constants/styles';

interface AgentCtaBannerProps {
  title: string;
  subtitle: string;
  ctaLabel: string;
  onPress: () => void;
  /** Small reassurance line under the button (e.g. "No license needed."). */
  trustLine?: string;
  /** Override the default banner photo if a caller needs a different image. */
  imageUrl?: string;
  /**
   * Grid mode. When true the banner drops its intrinsic `aspectRatio` and its
   * own horizontal page padding, and instead fills the parent column
   * (`flex: 1` + a shared `BANNER_FILL_MIN_HEIGHT`) so two banners placed in a
   * `flexDirection: 'row'` (`alignItems: 'stretch'`) read as an equal-height
   * grid. The parent owns the outer page padding and the inter-column gutter.
   * Defaults to false — the standalone full-width banner behaviour everywhere
   * else (home-narrow stack, `/agent`).
   */
  fill?: boolean;
}

/**
 * Default banner photo — a welcoming home exterior (Unsplash open library,
 * cached by `expo-image`). Reads as "turn the homes around you into income".
 */
const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1600&q=80';

export function AgentCtaBanner({
  title,
  subtitle,
  ctaLabel,
  onPress,
  trustLine,
  imageUrl = DEFAULT_IMAGE,
  fill = false,
}: AgentCtaBannerProps) {
  const isWide = useMediaQuery({ minWidth: 768 });
  // In grid (`fill`) mode the parent supplies the outer page padding and the
  // gutter, so the banner must not re-add its own horizontal page padding.
  const horizontalPadding = fill ? 0 : resolvePagePadding(isWide);
  const aspectRatio = isWide ? 21 / 9 : 16 / 9;
  const [hovered, setHovered] = useState(false);
  const isWeb = Platform.OS === 'web';

  const hoverHandlers = isWeb
    ? {
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
      }
    : {};

  return (
    <View style={fill ? styles.fillWrap : { paddingHorizontal: horizontalPadding }}>
      <View
        {...hoverHandlers}
        style={[
          styles.banner,
          fill ? styles.bannerFill : { aspectRatio },
          hovered && isWeb ? styles.bannerHover : null,
        ]}
      >
        <Image
          source={{ uri: imageUrl }}
          style={styles.bannerImage}
          contentFit="cover"
          transition={250}
          cachePolicy="memory-disk"
        />
        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 1 }}
          end={{ x: 0.85, y: 0 }}
          style={[styles.bannerScrim, { pointerEvents: 'none' }]}
        />
        <View style={[styles.copy, { padding: isWide ? spacing['4xl'] : spacing['2xl'] }]}>
          <H1 style={[styles.title, { fontSize: isWide ? 36 : 26, lineHeight: isWide ? 42 : 32 }]}>
            {title}
          </H1>
          <BloomText style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </BloomText>
          <View style={styles.buttonWrap}>
            <Button variant="inverse" size="large" onPress={onPress}>
              {ctaLabel}
            </Button>
          </View>
          {trustLine ? (
            <BloomText style={styles.trustLine}>{trustLine}</BloomText>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Grid-mode outer wrapper: fill the parent column so `flex: 1` propagates to
  // the banner and `alignItems: 'stretch'` (row default) equalises height.
  fillWrap: {
    flex: 1,
  },
  banner: {
    width: '100%',
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    ...cardShadow.md,
  },
  // Grid mode: no intrinsic aspect ratio — fill the column height (the taller
  // sibling defines it via row `alignItems: 'stretch'`) with a sensible floor
  // so a half-width column never collapses. The image stays `contentFit:
  // 'cover'` and absolutely fills, so it covers cleanly at any box shape.
  bannerFill: {
    flex: 1,
    minHeight: BANNER_FILL_MIN_HEIGHT,
  },
  bannerHover: {
    transform: [{ scale: 1.005 }],
  },
  bannerImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  bannerScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  copy: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    color: colors.white,
    fontWeight: '700',
    letterSpacing: tracker.tight,
    maxWidth: 520,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.92)',
    fontWeight: '400',
    lineHeight: 22,
    maxWidth: 480,
  },
  buttonWrap: {
    marginTop: spacing.md,
  },
  trustLine: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: spacing.sm,
  },
});

export default AgentCtaBanner;
