/**
 * HostCtaBanner — single end-of-page banner inviting hosts to list a
 * property. Full-width photo (21:9 on wide, 16:9 on mobile), gradient
 * scrim from bottom-left for legibility, a 2-line headline + supporting
 * one-liner + Bloom Button overlaid on top of the image.
 *
 * Sits as a closing visual beat on the home page (paired with AgentCtaBanner).
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

interface HostCtaBannerProps {
  title: string;
  subtitle: string;
  ctaLabel: string;
  imageUrl: string;
  onPress: () => void;
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

export function HostCtaBanner({
  title,
  subtitle,
  ctaLabel,
  imageUrl,
  onPress,
  fill = false,
}: HostCtaBannerProps) {
  const isWide = useMediaQuery({ minWidth: 768 });
  // In grid (`fill`) mode the parent supplies the outer page padding and the
  // gutter, so the banner must not re-add its own horizontal page padding.
  const horizontalPadding = fill ? 0 : resolvePagePadding(isWide);
  const aspectRatio = isWide ? 21 / 9 : 16 / 9;
  const [hovered, setHovered] = useState(false);
  const isWeb = Platform.OS === 'web';

  // The banner itself is NOT a pressable — only the Bloom Button below is the
  // tap target. Wrapping the whole banner in a Pressable while it also contains
  // a Button produces a nested <button> on web (invalid HTML + hydration error).
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
});
