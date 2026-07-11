/**
 * StepHeader — the title + optional subtitle block shared by every wizard step.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { H2, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

interface StepHeaderProps {
  title: string;
  subtitle?: string;
}

export const StepHeader: React.FC<StepHeaderProps> = ({ title, subtitle }) => (
  <View style={styles.container}>
    <H2 style={styles.title}>{title}</H2>
    {subtitle ? <BloomText style={styles.subtitle}>{subtitle}</BloomText> : null}
  </View>
);

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
});

export default StepHeader;
