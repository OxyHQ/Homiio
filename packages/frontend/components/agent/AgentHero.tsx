/**
 * AgentHero — full-bleed hero for the "Earn with Homiio" screen.
 *
 * Mirrors the home hero language (a Barcelona-flavored full-bleed photo, a
 * bottom-up gradient scrim for legibility, a large H1 + supporting line) and
 * ends in a single gold pill CTA. The CTA copy/handler is state-driven by the
 * screen (sign-in / start earning / share link), so this component is purely
 * presentational: it owns no partner state and just renders the title, subtitle,
 * an optional trust line, and the primary action.
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMediaQuery } from 'react-responsive';

import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { radius, resolvePagePadding, spacing, tracker } from '@/constants/styles';

/**
 * Aspirational hero photo. Reuses the Unsplash open library (no API key, cached
 * aggressively by `expo-image`) like the rest of Homiio's merchandising photos —
 * a bright living room that reads as "a home you could bring to Homiio".
 */
const HERO_IMAGE =
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1600&q=80';

interface AgentHeroProps {
  title: string;
  subtitle: string;
  ctaLabel: string;
  onPressCta: () => void;
  /** Small reassurance line under the CTA (e.g. "No license needed."). */
  trustLine?: string;
  /** Disables the CTA while a join/sign-in request is in flight. */
  ctaLoading?: boolean;
}

export const AgentHero: React.FC<AgentHeroProps> = ({
  title,
  subtitle,
  ctaLabel,
  onPressCta,
  trustLine,
  ctaLoading = false,
}) => {
  const isWide = useMediaQuery({ minWidth: 768 });
  const isXL = useMediaQuery({ minWidth: 1280 });
  const insets = useSafeAreaInsets();
  const horizontalPadding = resolvePagePadding(isWide);
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isWeb = Platform.OS === 'web';

  return (
    <View style={[styles.hero, { minHeight: isXL ? 560 : isWide ? 480 : 520 }]}>
      <Image
        source={{ uri: HERO_IMAGE }}
        style={styles.image}
        contentFit="cover"
        transition={250}
        cachePolicy="memory-disk"
      />
      <LinearGradient
        colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.15)']}
        start={{ x: 0, y: 1 }}
        end={{ x: 0.6, y: 0 }}
        style={[styles.scrim, { pointerEvents: 'none' }]}
      />
      <View
        style={[
          styles.content,
          {
            paddingHorizontal: horizontalPadding,
            paddingTop: insets.top + spacing['4xl'],
            paddingBottom: isWide ? spacing['5xl'] : spacing['4xl'],
            alignItems: isWide ? 'center' : 'flex-start',
          },
        ]}
      >
        <H1
          style={[
            styles.title,
            {
              fontSize: isXL ? 52 : isWide ? 42 : 34,
              lineHeight: isXL ? 58 : isWide ? 48 : 40,
              textAlign: isWide ? 'center' : 'left',
            },
          ]}
        >
          {title}
        </H1>
        <BloomText
          style={[styles.subtitle, { textAlign: isWide ? 'center' : 'left' }]}
        >
          {subtitle}
        </BloomText>

        <Pressable
          onPress={onPressCta}
          disabled={ctaLoading}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          accessibilityState={{ disabled: ctaLoading }}
          style={[
            styles.cta,
            (pressed || (hovered && isWeb)) && styles.ctaActive,
            ctaLoading && styles.ctaDisabled,
          ]}
        >
          <BloomText style={styles.ctaLabel}>{ctaLabel}</BloomText>
        </Pressable>

        {trustLine ? (
          <BloomText
            style={[styles.trustLine, { textAlign: isWide ? 'center' : 'left' }]}
          >
            {trustLine}
          </BloomText>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  content: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
  },
  title: {
    color: colors.white,
    fontWeight: '700',
    letterSpacing: tracker.tight,
    maxWidth: 640,
    marginBottom: spacing.md,
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 26,
    color: 'rgba(255,255,255,0.92)',
    maxWidth: 520,
    marginBottom: spacing['2xl'],
  },
  cta: {
    backgroundColor: colors.primaryColor,
    borderRadius: radius.pill,
    paddingHorizontal: spacing['3xl'],
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaActive: {
    opacity: 0.9,
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primaryForeground,
    letterSpacing: tracker.wide,
  },
  trustLine: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginTop: spacing.lg,
    maxWidth: 420,
  },
});

export default AgentHero;
