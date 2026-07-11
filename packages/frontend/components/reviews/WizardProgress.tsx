/**
 * WizardProgress — the persistent bottom bar for the write-review wizard: a
 * step-dot row + "Step X of N" counter above a Back / Next (or Submit on the
 * last step) button row. The wizard's step content scrolls above it.
 *
 * Uses Bloom `Button` for the nav actions (owns its own press state); the dots
 * are plain Views. `nextDisabled` gates a hard-required step from advancing.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';

interface WizardProgressProps {
  /** Zero-based current step index. */
  step: number;
  /** Total number of steps. */
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  isFirst: boolean;
  isLast: boolean;
  /** Disables Next/Submit while a hard-required step is incomplete. */
  nextDisabled: boolean;
  submitting: boolean;
}

export const WizardProgress: React.FC<WizardProgressProps> = ({
  step,
  totalSteps,
  onBack,
  onNext,
  onSubmit,
  isFirst,
  isLast,
  nextDisabled,
  submitting,
}) => {
  const { t } = useTranslation();

  return (
    <View style={styles.bar}>
      <View style={styles.dotsRow}>
        {Array.from({ length: totalSteps }).map((_, index) => (
          <View
            key={index}
            style={[styles.dot, index <= step ? styles.dotActive : null]}
          />
        ))}
      </View>
      <View style={styles.footerRow}>
        <BloomText style={styles.counter}>
          {t('reviews.write.stepCounter', { current: step + 1, total: totalSteps })}
        </BloomText>
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="medium"
            onPress={onBack}
            disabled={isFirst || submitting}
          >
            {t('common.back')}
          </Button>
          <Button
            variant="primary"
            size="medium"
            onPress={isLast ? onSubmit : onNext}
            disabled={nextDisabled || submitting}
            loading={isLast && submitting}
          >
            {isLast ? t('reviews.write.submit') : t('common.next')}
          </Button>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
    backgroundColor: colors.background,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dot: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
  },
  dotActive: {
    backgroundColor: colors.primaryColor,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  counter: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});

export default WizardProgress;
