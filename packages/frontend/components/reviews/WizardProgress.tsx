/**
 * WizardProgress — the persistent bottom bar for the write-review wizard: a
 * progress track with the "Step X of N" counter above a Back / Next (or Submit
 * on the last step) button row. The wizard's step content scrolls above it.
 *
 * Bloom has no wizard-progress family (its `stepper` is a − value + counter, not
 * a step indicator), so the progress look is COMPOSED: Bloom `StatBar`
 * draws the labelled track (its label is the step counter) and a Bloom `Badge`
 * carries the percentage; the nav actions are Bloom `Button`s.
 * `nextDisabled` gates a hard-required step from advancing.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Badge } from '@oxy.so/bloom/badge';
import { Button } from '@oxy.so/bloom/button';
import { RiArrowLeftLine, RiArrowRightLine, RiCheckLine } from '@oxy.so/bloom/icons';
import { StatBar } from '@oxy.so/bloom/stat-bar';

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
  const current = Math.min(step + 1, totalSteps);
  const percent = totalSteps > 0 ? Math.round((current / totalSteps) * 100) : 0;

  return (
    <View className="gap-3 border-t border-border bg-background px-4 py-3">
      <StatBar
        label={t('reviews.write.stepCounter', { current, total: totalSteps })}
        value={current}
        max={totalSteps}
        height={4}
        icon={<Badge content={`${percent}%`} size="small" variant="subtle" color="primary" />}
      />
      <View className="flex-row items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="medium"
          leadingIcon={RiArrowLeftLine}
          onPress={onBack}
          disabled={isFirst || submitting}
        >
          {t('common.back')}
        </Button>
        <Button
          variant="primary"
          size="medium"
          trailingIcon={isLast ? RiCheckLine : RiArrowRightLine}
          onPress={isLast ? onSubmit : onNext}
          disabled={nextDisabled || submitting}
          loading={isLast && submitting}
        >
          {isLast ? t('reviews.write.submit') : t('common.next')}
        </Button>
      </View>
    </View>
  );
};

export default WizardProgress;
