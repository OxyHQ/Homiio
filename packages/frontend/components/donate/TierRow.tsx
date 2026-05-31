/**
 * TierRow — a single, flat, selectable donation tier row for the donate
 * screen. Replaces the old bordered "tier card" (heart icon + price + benefit
 * checklist + per-card button) with one selectable line in a radio group, so
 * the screen reads flat (Airbnb-2026) and a SINGLE primary CTA drives checkout.
 *
 * Layout: a Bloom `RadioIndicator` on the left, the tier title + subtitle in
 * the middle, and the amount (+ optional period) on the right. The selected row
 * gets a soft primary tint + primary border; unselected rows get a hairline
 * border. No shadow — these sit flat on the page background.
 *
 * NativeWind v4 swallows the `Pressable` function-form `style`, so the
 * pressed/selected visuals are driven by static style arrays + `onPressIn` /
 * `onPressOut` state (per the project's NativeWind gotcha).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { RadioIndicator } from '@oxyhq/bloom/radio-indicator';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

interface TierRowProps {
  title: string;
  subtitle: string;
  amount: number;
  currency: string;
  /** e.g. "/mo" — shown only for recurring tiers. */
  periodLabel?: string;
  selected: boolean;
  onSelect: () => void;
}

export const TierRow: React.FC<TierRowProps> = ({
  title,
  subtitle,
  amount,
  currency,
  periodLabel,
  selected,
  onSelect,
}) => {
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      onPress={onSelect}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}, ${currency}${amount}${periodLabel ?? ''}`}
      style={[
        styles.row,
        selected ? styles.rowSelected : styles.rowUnselected,
        pressed && !selected && styles.rowPressed,
      ]}
    >
      <RadioIndicator selected={selected} />

      <View style={styles.copy}>
        <BloomText style={styles.title}>{title}</BloomText>
        <BloomText style={styles.subtitle}>{subtitle}</BloomText>
      </View>

      <View style={styles.priceWrap}>
        <BloomText style={styles.amount}>
          {currency}
          {amount}
        </BloomText>
        {periodLabel ? <BloomText style={styles.period}>{periodLabel}</BloomText> : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  rowUnselected: {
    backgroundColor: colors.background,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
  },
  rowSelected: {
    backgroundColor: colors.infoSubtle,
    borderColor: colors.primaryColor,
  },
  rowPressed: {
    backgroundColor: colors.mutedSubtle,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  priceWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  amount: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  period: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
});
