/**
 * SectionEyebrow — small, uppercase, wide-tracked label that sits above a
 * section title. Used to add the "Recommended for you" / "Near Barcelona"
 * narrative layer above the H1/H2 title without competing with it.
 *
 * Visual: 11px, weight 600, uppercase, wide letter-spacing, muted color.
 * Centered on mobile (handled by parent), left-aligned by default.
 *
 * Usage:
 *   <SectionEyebrow>{t('home.recommended.eyebrow')}</SectionEyebrow>
 *   <H1>{t('home.recommended.title')}</H1>
 */
import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { tracker } from '@/constants/styles';

interface SectionEyebrowProps {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}

export const SectionEyebrow: React.FC<SectionEyebrowProps> = ({ children, style }) => (
  <BloomText style={[styles.eyebrow, style]}>{children}</BloomText>
);

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_4,
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
    marginBottom: 6,
  },
});

export default SectionEyebrow;
