/**
 * AgentCtaBanner — compact "become an agent" CTA card.
 *
 * Matches `HostCtaBanner` density (photo, bottom-left scrim, short headline +
 * one-liner + Bloom Button) and adds an optional trust line under the button.
 * Used on `/agent` and as a home-page pair with the host CTA.
 *
 * Like `HostCtaBanner`, the banner itself is NOT pressable — only the Bloom
 * Button is the tap target — so web never renders a nested `<button>`.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMediaQuery } from 'react-responsive';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import {
  BANNER_FILL_MIN_HEIGHT,
  radius,
  resolvePagePadding,
  spacing,
  tracker,
} from '@/constants/styles';
import { ZoomableImage } from '@/components/ui/ZoomableImage';

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
  // Flatter than classic 16:9 so stacked/full-width cards stay compact.
  const aspectRatio = isWide ? 2.6 : 2.1;

  return (
    <View style={fill ? styles.fillWrap : { paddingHorizontal: horizontalPadding }}>
      <View
        style={[
          styles.banner,
          fill ? styles.bannerFill : { aspectRatio },
        ]}
      >
        {/* The photo zooms inside the banner's rounded mask on hover; the banner
            never moves. Scrim + copy are siblings, so they stay put. */}
        <ZoomableImage style={styles.bannerMedia}>
          <Image
            source={{ uri: imageUrl }}
            style={styles.bannerImage}
            contentFit="cover"
            transition={250}
            cachePolicy="memory-disk"
          />
        </ZoomableImage>
        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 1 }}
          end={{ x: 0.85, y: 0 }}
          style={[styles.bannerScrim, { pointerEvents: 'none' }]}
        />
        <View style={[styles.copy, { padding: isWide ? spacing.xl : spacing.lg }]}>
          <BloomText
            style={[
              styles.title,
              { fontSize: isWide ? 22 : 18, lineHeight: isWide ? 28 : 24 },
            ]}
            numberOfLines={2}
          >
            {title}
          </BloomText>
          <BloomText style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </BloomText>
          <View style={styles.buttonWrap}>
            <Button variant="inverse" size="medium" onPress={onPress}>
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
  },
  // Grid mode: no intrinsic aspect ratio — fill the column height (the taller
  // sibling defines it via row `alignItems: 'stretch'`) with a sensible floor
  // so a half-width column never collapses. The image stays `contentFit:
  // 'cover'` and absolutely fills, so it covers cleanly at any box shape.
  bannerFill: {
    flex: 1,
    minHeight: BANNER_FILL_MIN_HEIGHT,
  },
  // The masked zoom wrapper fills the banner so the photo scales inside the
  // rounded corners; the scrim and copy sit above it as siblings.
  bannerMedia: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
    gap: spacing.xs,
  },
  title: {
    color: colors.white,
    fontWeight: '600',
    letterSpacing: tracker.tight,
    maxWidth: 420,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '400',
    lineHeight: 18,
    maxWidth: 400,
  },
  buttonWrap: {
    marginTop: spacing.sm,
  },
  trustLine: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: spacing.xs,
  },
});

export default AgentCtaBanner;
