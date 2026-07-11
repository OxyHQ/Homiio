/**
 * Calendar-style date block for an eviction case: the day big, the month above,
 * the time below. Presentational only (no hooks beyond `useTranslation`'s locale
 * read via the caller), so it drops into the board card and the detail hero.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { formatEvictionDateParts } from './evictionUtils';

interface EvictionDateBlockProps {
  scheduledAt: string;
  locale: string;
  /** Larger variant for the detail hero. */
  size?: 'compact' | 'large';
}

export const EvictionDateBlock: React.FC<EvictionDateBlockProps> = ({
  scheduledAt,
  locale,
  size = 'compact',
}) => {
  const parts = formatEvictionDateParts(scheduledAt, locale);
  const large = size === 'large';

  return (
    <View style={[styles.block, large ? styles.blockLarge : styles.blockCompact]}>
      <BloomText style={styles.month}>{parts.month.toUpperCase()}</BloomText>
      <BloomText style={[styles.day, large ? styles.dayLarge : null]}>{parts.day}</BloomText>
      <BloomText style={styles.time}>{parts.time}</BloomText>
    </View>
  );
};

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.mutedSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  blockCompact: {
    width: 60,
    paddingVertical: spacing.sm,
  },
  blockLarge: {
    width: 76,
    paddingVertical: spacing.md,
  },
  month: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.danger,
  },
  day: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    lineHeight: 26,
  },
  dayLarge: {
    fontSize: 28,
    lineHeight: 32,
  },
  time: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});

export default EvictionDateBlock;
