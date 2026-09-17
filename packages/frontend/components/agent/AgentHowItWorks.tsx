/**
 * AgentHowItWorks — the three-beat "how you earn" explainer.
 *
 * Image-forward, flat (no card chrome): each step is a tall photo with a
 * numbered gold badge, a title and a one-line body. On wide screens the three
 * steps sit in a row; on a phone they stack. Section gutter is owned here (per
 * the home-screen "per-section gutter" rule) so the screen page container can
 * stay padding-free.
 */
import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from 'react-responsive';

import { Badge } from '@oxy.so/bloom/badge';
import { useTheme } from '@oxy.so/bloom/theme';
import { H1, Text as BloomText } from '@oxy.so/bloom/typography';

import { colors } from '@/styles/colors';
import { radius, resolvePagePadding, spacing, tracker } from '@/constants/styles';

interface Step {
  /** i18n suffix under `agent.how.steps.*`. */
  key: 'find' | 'list' | 'earn';
  imageUrl: string;
}

/**
 * Step photography (Unsplash open library, cached by `expo-image`). Chosen to
 * read as: spotting a place → publishing it → getting paid.
 */
const STEPS: readonly Step[] = [
  {
    key: 'find',
    imageUrl:
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=900&q=80',
  },
  {
    key: 'list',
    imageUrl:
      'https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=900&q=80',
  },
  {
    key: 'earn',
    imageUrl:
      'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=900&q=80',
  },
] as const;

interface StepCardProps {
  index: number;
  title: string;
  body: string;
  imageUrl: string;
  height: number;
}

const StepCard: React.FC<StepCardProps> = ({ index, title, body, imageUrl, height }) => {
  const theme = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.photoWrap, { height }]}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.photo}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
        />
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.25)']}
          locations={[0.5, 1]}
          style={[styles.photoScrim, { pointerEvents: 'none' }]}
        />
        <View style={styles.badge}>
          <Badge content={index} size="large" color="primary" variant="solid" />
        </View>
      </View>
      <BloomText variant="headline-bold" style={{ color: theme.colors.text }}>
        {title}
      </BloomText>
      <BloomText variant="body-regular" style={{ color: theme.colors.textSecondary }}>
        {body}
      </BloomText>
    </View>
  );
};

export const AgentHowItWorks: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isWide = useMediaQuery({ minWidth: 768 });
  const { width } = useWindowDimensions();
  const horizontalPadding = resolvePagePadding(isWide);
  const isWeb = Platform.OS === 'web';

  // Wide: three photos in a row read best a touch landscape; mobile stacks with
  // a taller photo per step. Both derive from the viewport so the photos scale
  // with the layout instead of a hardcoded pixel height.
  const photoHeight = isWide
    ? Math.round(Math.min(width, 1100) * 0.18)
    : Math.round(Math.min(width, 520) * 0.6);

  return (
    <View style={{ paddingHorizontal: horizontalPadding }}>
      <View style={styles.header}>
        <H1
          style={[
            styles.title,
            { color: theme.colors.text, textAlign: isWide ? 'center' : 'left' },
          ]}
        >
          {t('agent.how.title')}
        </H1>
      </View>
      <View
        style={[
          styles.steps,
          isWide ? styles.stepsRow : styles.stepsColumn,
          isWeb && isWide ? styles.stepsWebGap : null,
        ]}
      >
        {STEPS.map((step, stepIndex) => (
          <StepCard
            key={step.key}
            index={stepIndex + 1}
            title={t(`agent.how.steps.${step.key}.title`)}
            body={t(`agent.how.steps.${step.key}.body`)}
            imageUrl={step.imageUrl}
            height={photoHeight}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing['2xl'],
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: tracker.tight,
    lineHeight: 34,
  },
  steps: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
  },
  stepsRow: {
    flexDirection: 'row',
    gap: spacing['2xl'],
  },
  stepsColumn: {
    flexDirection: 'column',
    gap: spacing['3xl'],
  },
  stepsWebGap: {
    gap: spacing['3xl'],
  },
  step: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  photoWrap: {
    width: '100%',
    borderRadius: radius.photo,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    marginBottom: spacing.sm,
  },
  photo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  photoScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  badge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
  },
});

export default AgentHowItWorks;
