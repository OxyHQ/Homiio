/**
 * AgentHero — full-bleed hero for the "Earn with Homiio" screen.
 *
 * Mirrors the home hero language (a Barcelona-flavored full-bleed photo, a
 * bottom-up gradient scrim for legibility, a large H1 + supporting line) and
 * ends in a single Bloom primary Button CTA. The CTA copy/handler is state-driven by the
 * screen (sign-in / start earning / share link), so this component is purely
 * presentational: it owns no partner state and just renders the title, subtitle,
 * an optional trust line, and the primary action.
 */
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { Button } from '@oxy.so/bloom/button';
import { H1, Text as BloomText } from '@oxy.so/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing, tracker } from '@/constants/styles';

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
  return (
    <View className="min-h-[520px] md:min-h-[480px] xl:min-h-[560px]" style={styles.hero}>
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
        className="items-start px-4 pt-10 pb-10 md:items-center md:px-8 md:pb-14"
        style={styles.content}
      >
        <H1
          className="text-left text-[34px] leading-[40px] md:text-center md:text-[42px] md:leading-[48px] xl:text-[52px] xl:leading-[58px]"
          style={styles.title}
        >
          {title}
        </H1>
        <BloomText className="text-left md:text-center" style={styles.subtitle}>
          {subtitle}
        </BloomText>

        <Button
          size="lg"
          onPress={onPressCta}
          loading={ctaLoading}
          disabled={ctaLoading}
          accessibilityLabel={ctaLabel}
          tone="accent"
          appearance="solid"
        >
          {ctaLabel}
        </Button>

        {trustLine ? (
          <BloomText className="text-left md:text-center" style={styles.trustLine}>
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
  trustLine: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginTop: spacing.lg,
    maxWidth: 420,
  },
});
