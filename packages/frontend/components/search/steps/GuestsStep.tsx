/**
 * GuestsStep — vacation-only guest-count stepper.
 *
 * A single counter (0–MAX_GUESTS). Zero means "no guest filter" and is reported
 * upward as `undefined` so the collapsed pill shows the "Add guests"
 * placeholder. Long-term searches never mount this step (the panel omits it),
 * mirroring DatesStep — there is no guest control in long-term mode by design.
 */
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

/** Guest-count bounds for the stepper. Zero clears the filter (`undefined`). */
const MIN_GUESTS = 0;
const MAX_GUESTS = 16;

interface GuestsStepProps {
  value?: number;
  /** Reports the resolved count, or `undefined` when cleared to zero. */
  onChange: (guests: number | undefined) => void;
  /**
   * Compact mode for the wide centered dialog: the dialog header already names
   * the step ("Who"), so the step's internal heading is suppressed. The narrow
   * sheet leaves this `false` and keeps the per-step heading.
   */
  compact?: boolean;
}

export const GuestsStep: React.FC<GuestsStepProps> = ({ value, onChange, compact = false }) => {
  const { t } = useTranslation();
  const count = value ?? 0;

  const decrement = useCallback(() => {
    const next = Math.max(MIN_GUESTS, count - 1);
    onChange(next === 0 ? undefined : next);
  }, [count, onChange]);

  const increment = useCallback(() => {
    onChange(Math.min(MAX_GUESTS, count + 1));
  }, [count, onChange]);

  return (
    <View style={compact ? styles.containerCompact : styles.container}>
      {compact ? null : (
        <BloomText style={styles.heading}>{t('search.step.guests.title')}</BloomText>
      )}
      <View style={styles.row}>
        <BloomText style={styles.rowLabel}>{t('search.step.guests.label')}</BloomText>
        <View style={styles.controls}>
          <Button
            variant="icon"
            size="small"
            onPress={decrement}
            disabled={count <= MIN_GUESTS}
            accessibilityLabel={t('search.actions.decreaseGuests')}
          >
            {'−'}
          </Button>
          <BloomText style={styles.count}>{count}</BloomText>
          <Button
            variant="icon"
            size="small"
            onPress={increment}
            disabled={count >= MAX_GUESTS}
            accessibilityLabel={t('search.actions.increaseGuests')}
          >
            {'+'}
          </Button>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  // Compact drops the large heading (the dialog header names the step), so the
  // single counter row stands alone without an extra leading gap.
  containerCompact: {
    gap: spacing.sm,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  count: {
    minWidth: 24,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
});

export default GuestsStep;
